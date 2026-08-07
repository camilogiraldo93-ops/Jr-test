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
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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
