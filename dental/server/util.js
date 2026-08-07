import { ErrorApp } from './http.js';

export function requerido(cuerpo, campos) {
  const faltan = campos.filter((c) => {
    const v = cuerpo[c];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (faltan.length) {
    throw new ErrorApp(400, `Faltan campos obligatorios: ${faltan.join(', ')}.`, { campos: faltan });
  }
}

export function texto(v, porDefecto = null) {
  if (v === undefined || v === null) return porDefecto;
  const s = String(v).trim();
  return s === '' ? porDefecto : s;
}

export function numero(v, porDefecto = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

export function entero(v, porDefecto = null) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : porDefecto;
}

export function booleano(v, porDefecto = false) {
  if (v === undefined || v === null || v === '') return porDefecto;
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'si';
}

/** Normaliza fecha/hora a 'YYYY-MM-DDTHH:MM' (hora local de la clínica). */
export function fechaHora(v, campo = 'fecha') {
  const s = texto(v);
  if (!s) throw new ErrorApp(400, `El campo ${campo} es obligatorio.`);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) throw new ErrorApp(400, `El campo ${campo} debe tener formato AAAA-MM-DDTHH:MM (recibido: "${s}").`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/** Normaliza a fecha 'YYYY-MM-DD'. */
export function soloFecha(v, porDefecto = null) {
  const s = texto(v);
  if (!s) return porDefecto;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new ErrorApp(400, `Fecha inválida: "${s}". Usa formato AAAA-MM-DD.`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function hoy() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** El doctor solo puede operar sobre lo suyo salvo que sea admin o recepción. */
export function verificarDoctorPropio(usuario, doctorId) {
  if (usuario.rol === 'doctor' && usuario.doctor_id && Number(doctorId) !== Number(usuario.doctor_id)) {
    throw new ErrorApp(403, 'Un doctor solo puede registrar información clínica de sus propias citas.');
  }
}
