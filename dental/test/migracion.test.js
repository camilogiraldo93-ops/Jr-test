/**
 * Migraciones del arranque.
 *
 * Estas pruebas escriben DESPUÉS de migrar. Una migración puede dejar la base
 * perfectamente legible —los conteos cuadran, no hay filas huérfanas— y aun así
 * incapaz de guardar nada, que fue exactamente lo que pasó al hacer opcionales
 * los apellidos. Leer no basta como comprobación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Crea una base con el esquema anterior: apellidos obligatorios y una cita. */
function baseAnterior(dir) {
  const ruta = path.join(dir, 'clinica.db');
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL, apellidos TEXT NOT NULL, cedula TEXT UNIQUE, telefono TEXT,
      creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL);
    CREATE TABLE consultorios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL);
    CREATE TABLE cubiculos (id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL);
    CREATE TABLE doctores (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL);
    CREATE TABLE citas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
      cubiculo_id INTEGER NOT NULL REFERENCES cubiculos(id) ON DELETE CASCADE,
      doctor_id INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
      paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
      inicio TEXT NOT NULL, fin TEXT NOT NULL, motivo TEXT, notas TEXT,
      estado TEXT NOT NULL DEFAULT 'agendada',
      cita_origen_id INTEGER REFERENCES citas(id) ON DELETE SET NULL,
      creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);`);
  const t = '2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO pacientes (nombre,apellidos,creado_en,actualizado_en) VALUES (?,?,?,?)')
    .run('Ana', 'Pérez', t, t);
  db.prepare('INSERT INTO consultorios (nombre,creado_en) VALUES (?,?)').run('Sede 1', t);
  db.prepare('INSERT INTO cubiculos (consultorio_id,nombre,creado_en) VALUES (1,?,?)').run('Cubículo 1', t);
  db.prepare('INSERT INTO doctores (nombre,creado_en) VALUES (?,?)').run('Dra. Vera', t);
  db.prepare(`INSERT INTO citas (consultorio_id,cubiculo_id,doctor_id,paciente_id,inicio,fin,creada_en,actualizada_en)
              VALUES (1,1,1,1,?,?,?,?)`).run('2026-01-02T09:00', '2026-01-02T09:30', t, t);
  db.close();
  return ruta;
}

/** Arranca el servidor una vez (que es quien aplica las migraciones) y lo para. */
function aplicarMigraciones(dir, ruta) {
  const r = spawnSync(process.execPath, ['--no-warnings', '-e',
    "import('./server/db.js').then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })"],
  { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, DENTAL_DATA_DIR: dir, DENTAL_DB: ruta } });
  assert.equal(r.status, 0, `las migraciones fallaron:\n${r.stderr}`);
  return r.stdout;
}

test('Migración: tras hacer opcionales los apellidos, la base sigue escribiendo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dental-mig-'));
  const ruta = baseAnterior(dir);

  const salida = aplicarMigraciones(dir, ruta);
  assert.match(salida, /apellidos del paciente ya no son obligatorios/);

  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');

  // Las filas siguen ahí.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pacientes').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM citas').get().n, 1);

  // Ninguna tabla apunta a una tabla que no existe.
  for (const t of ['citas', 'tratamientos', 'cargos', 'pagos', 'consentimientos', 'recordatorios', 'odontograma']) {
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t)?.sql || '';
    assert.ok(!/apellidos_obligatorios/.test(sql), `${t} quedó apuntando a la tabla temporal`);
  }
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);

  // Y —lo que de verdad importa— se puede GUARDAR.
  const t = '2026-02-01T00:00:00.000Z';
  db.prepare(`INSERT INTO citas (consultorio_id,cubiculo_id,doctor_id,paciente_id,inicio,fin,creada_en,actualizada_en)
              VALUES (1,1,1,1,?,?,?,?)`).run('2026-02-02T10:00', '2026-02-02T10:30', t, t);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM citas').get().n, 2);

  // Y crear un paciente sin apellidos, que es para lo que se hizo la migración.
  db.prepare('INSERT INTO pacientes (nombre,telefono,creado_en,actualizado_en) VALUES (?,?,?,?)')
    .run('Rosa', '099-555-7788', t, t);
  assert.equal(db.prepare("SELECT apellidos FROM pacientes WHERE nombre = 'Rosa'").get().apellidos, null);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Reparación: una base ya dañada por la migración anterior vuelve a escribir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dental-rep-'));
  const ruta = baseAnterior(dir);

  // Se reproduce el daño exacto que causaba la versión anterior: el RENAME
  // reescribía las claves foráneas de las hijas y luego se borraba la tabla.
  const rota = new DatabaseSync(ruta);
  rota.exec('PRAGMA foreign_keys = OFF;');
  rota.exec('ALTER TABLE pacientes RENAME TO pacientes_apellidos_obligatorios;');
  rota.exec(`CREATE TABLE pacientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, apellidos TEXT,
    cedula TEXT UNIQUE, telefono TEXT, creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL);`);
  rota.exec('INSERT INTO pacientes SELECT * FROM pacientes_apellidos_obligatorios;');
  rota.exec('DROP TABLE pacientes_apellidos_obligatorios;');
  assert.match(rota.prepare("SELECT sql FROM sqlite_master WHERE name='citas'").get().sql,
    /apellidos_obligatorios/, 'la base de partida debe estar dañada');
  rota.close();

  const salida = aplicarMigraciones(dir, ruta);
  assert.match(salida, /Reparación aplicada/);

  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  assert.ok(!/apellidos_obligatorios/.test(
    db.prepare("SELECT sql FROM sqlite_master WHERE name='citas'").get().sql));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pacientes').get().n, 1, 'no se perdió ningún paciente');

  const t = '2026-03-01T00:00:00.000Z';
  db.prepare(`INSERT INTO citas (consultorio_id,cubiculo_id,doctor_id,paciente_id,inicio,fin,creada_en,actualizada_en)
              VALUES (1,1,1,1,?,?,?,?)`).run('2026-03-02T11:00', '2026-03-02T11:30', t, t);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM citas').get().n, 2, 'la base volvió a aceptar escrituras');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
