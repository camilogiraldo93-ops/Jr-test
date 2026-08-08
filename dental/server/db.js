import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(__dirname, '..');
export const DIR_DATOS = process.env.DENTAL_DATA_DIR || path.join(RAIZ, 'data');
export const DIR_UPLOADS = path.join(DIR_DATOS, 'uploads');

fs.mkdirSync(DIR_UPLOADS, { recursive: true });

const RUTA_DB = process.env.DENTAL_DB || path.join(DIR_DATOS, 'clinica.db');

export const db = new DatabaseSync(RUTA_DB);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const NOMBRE_TEMPORAL = 'pacientes_apellidos_obligatorios';

migrarConsentimientosV2();
repararReferenciasRotas();

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

migrarTratamientoPrevisto();
migrarApellidosOpcionales();

/**
 * Repara las bases dañadas por una versión anterior de `migrarApellidosOpcionales`.
 *
 * Esa versión renombraba `pacientes` a un nombre temporal y luego lo borraba.
 * Desde SQLite 3.25, `ALTER TABLE … RENAME` reescribe también las claves foráneas
 * de las tablas hijas para que apunten al nombre nuevo — apagar `foreign_keys` no
 * lo evita, hace falta `legacy_alter_table`. Resultado: siete tablas quedaban
 * apuntando a una tabla que ya no existía. Se podía leer todo pero no guardar
 * nada, y el fallo no aparecía hasta el primer intento de escritura.
 *
 * Aquí se corrige el texto del esquema, que es lo único que quedó mal: las filas
 * están intactas.
 */
function repararReferenciasRotas() {
  const rotas = db.prepare(
    `SELECT name FROM sqlite_master WHERE sql LIKE '%${NOMBRE_TEMPORAL}%' AND name != ?`).all(NOMBRE_TEMPORAL);
  if (!rotas.length) return;

  const version = db.prepare('PRAGMA schema_version').get().schema_version;
  db.exec('PRAGMA writable_schema = ON;');
  db.prepare(
    `UPDATE sqlite_master SET sql = replace(replace(sql, '"${NOMBRE_TEMPORAL}"', '"pacientes"'),
                                            '${NOMBRE_TEMPORAL}', 'pacientes')
     WHERE sql LIKE '%${NOMBRE_TEMPORAL}%'`).run();
  db.exec(`PRAGMA schema_version = ${version + 1};`);
  db.exec('PRAGMA writable_schema = OFF;');
  db.exec('VACUUM;');

  console.log(`Reparación aplicada: ${rotas.length} tabla(s) apuntaban a una tabla inexistente ` +
    `(${rotas.map((r) => r.name).join(', ')}). Las referencias vuelven a "pacientes".`);
}

/**
 * Los apellidos dejaron de ser obligatorios. SQLite no sabe quitar un NOT NULL
 * con ALTER, así que la tabla se reconstruye copiando todas las filas.
 *
 * `legacy_alter_table` es imprescindible: sin él, el RENAME reescribe las claves
 * foráneas de citas, tratamientos, cargos, pagos, consentimientos, recordatorios
 * y odontograma para que apunten al nombre temporal, y al soltarlo la base queda
 * sin poder escribir. `foreign_keys = OFF` evita el borrado en cascada, que es un
 * problema distinto; hacen falta los dos.
 */
function migrarApellidosOpcionales() {
  const col = db.prepare('PRAGMA table_info(pacientes)').all().find((c) => c.name === 'apellidos');
  if (!col || !col.notnull) return;

  const columnas = db.prepare('PRAGMA table_info(pacientes)').all().map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA legacy_alter_table = ON;');
  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE pacientes RENAME TO ${NOMBRE_TEMPORAL};`);
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    db.exec(`INSERT INTO pacientes (${columnas}) SELECT ${columnas} FROM ${NOMBRE_TEMPORAL};`);
    db.exec(`DROP TABLE ${NOMBRE_TEMPORAL};`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF;');
    db.exec('PRAGMA foreign_keys = ON;');
  }

  // Se comprueba que la base quedó escribible de verdad, no solo legible.
  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) {
    throw new Error(`La migración de apellidos dejó ${problemas.length} referencia(s) rota(s).`);
  }
  console.log('Migración aplicada: los apellidos del paciente ya no son obligatorios.');
}

/**
 * La cita pasó a llevar el tratamiento previsto del catálogo. `CREATE TABLE IF
 * NOT EXISTS` no toca las tablas ya creadas, así que la columna se añade aquí.
 */
function migrarTratamientoPrevisto() {
  const columnas = db.prepare('PRAGMA table_info(citas)').all().map((c) => c.name);
  if (columnas.includes('catalogo_id')) return;
  db.exec('ALTER TABLE citas ADD COLUMN catalogo_id INTEGER REFERENCES catalogo_tratamientos(id) ON DELETE SET NULL;');
  console.log('Migración aplicada: las citas admiten un tratamiento previsto del catálogo.');
}

/**
 * El consentimiento informado pasó de "un texto con una firma" a un documento
 * con instantánea de datos, representante legal, dos firmas y anulación trazable.
 * Las bases creadas con el esquema anterior se convierten conservando sus registros.
 */
function migrarConsentimientosV2() {
  const existe = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='consentimientos'").get();
  if (!existe) return;
  const columnas = db.prepare('PRAGMA table_info(consentimientos)').all().map((c) => c.name);
  if (!columnas.includes('riesgos')) return; // ya está en la versión nueva

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('ALTER TABLE consentimientos RENAME TO consentimientos_v1;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  db.exec(`
    INSERT INTO consentimientos (
      id, paciente_id, doctor_id, cita_id, tratamiento_id,
      tratamiento, observaciones,
      paciente_nombre, doctor_nombre,
      fecha, hora,
      firma_paciente, firma_paciente_nombre, firma_paciente_en,
      estado, firmado_en, creado_en)
    SELECT
      id, paciente_id, doctor_id, cita_id, tratamiento_id,
      titulo,
      NULLIF(TRIM(ifnull(descripcion,'') || CASE WHEN riesgos IS NOT NULL THEN char(10) || riesgos ELSE '' END), ''),
      nombre_paciente, nombre_doctor,
      substr(ifnull(firmado_en, creado_en), 1, 10),
      substr(ifnull(firmado_en, creado_en), 12, 5),
      CASE WHEN firma_tipo = 'trazo' THEN firma_data ELSE NULL END,
      firmante, firmado_en,
      CASE estado WHEN 'rechazado' THEN 'anulado' ELSE estado END,
      firmado_en, creado_en
    FROM consentimientos_v1;`);
  db.exec('DROP TABLE consentimientos_v1;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('Migración aplicada: consentimientos actualizados al formato con doble firma.');
}

/** Ejecuta una consulta y devuelve todas las filas como objetos planos. */
export function todos(sql, params = []) {
  return db.prepare(sql).all(...params).map(planar);
}

/** Ejecuta una consulta y devuelve la primera fila (o null). */
export function uno(sql, params = []) {
  const fila = db.prepare(sql).get(...params);
  return fila ? planar(fila) : null;
}

/** Ejecuta una sentencia de escritura. Devuelve { cambios, ultimoId }. */
export function correr(sql, params = []) {
  const r = db.prepare(sql).run(...params);
  return { cambios: Number(r.changes), ultimoId: Number(r.lastInsertRowid) };
}

/** Ejecuta fn dentro de una transacción. */
export function transaccion(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// node:sqlite devuelve objetos con prototipo nulo; los normalizamos.
function planar(fila) {
  return { ...fila };
}

export function ahora() {
  return new Date().toISOString();
}

export const RUTA_DB_ACTUAL = RUTA_DB;
