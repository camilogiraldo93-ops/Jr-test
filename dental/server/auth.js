import crypto from 'node:crypto';
import { uno, correr, ahora } from './db.js';

const DIAS_SESION = 7;

export function hashear(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verificarPassword(password, hash, salt) {
  const calculado = crypto.scryptSync(password, salt, 64);
  const guardado = Buffer.from(hash, 'hex');
  if (calculado.length !== guardado.length) return false;
  return crypto.timingSafeEqual(calculado, guardado);
}

export function crearUsuario({ nombre, email, password, rol, doctor_id = null }) {
  const { hash, salt } = hashear(password);
  const { ultimoId } = correr(
    `INSERT INTO usuarios (nombre, email, password_hash, salt, rol, doctor_id, creado_en)
     VALUES (?,?,?,?,?,?,?)`,
    [nombre, email.toLowerCase().trim(), hash, salt, rol, doctor_id, ahora()]
  );
  return uno('SELECT id, nombre, email, rol, doctor_id, activo FROM usuarios WHERE id = ?', [ultimoId]);
}

export function iniciarSesion(email, password) {
  const u = uno('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [String(email || '').toLowerCase().trim()]);
  if (!u) return null;
  if (!verificarPassword(String(password || ''), u.password_hash, u.salt)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 86400000).toISOString();
  correr('INSERT INTO sesiones (token, usuario_id, creada_en, expira_en) VALUES (?,?,?,?)',
    [token, u.id, ahora(), expira]);
  return { token, expira_en: expira, usuario: publico(u) };
}

export function cerrarSesion(token) {
  correr('DELETE FROM sesiones WHERE token = ?', [token]);
}

export function usuarioPorToken(token) {
  if (!token) return null;
  const s = uno('SELECT * FROM sesiones WHERE token = ?', [token]);
  if (!s) return null;
  if (new Date(s.expira_en).getTime() < Date.now()) {
    correr('DELETE FROM sesiones WHERE token = ?', [token]);
    return null;
  }
  const u = uno('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [s.usuario_id]);
  return u ? publico(u) : null;
}

export function publico(u) {
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, doctor_id: u.doctor_id };
}
