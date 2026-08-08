/**
 * Recuerda los valores con los que se trabaja todos los días (consultorio,
 * cubículo y doctor habituales) para que agendar no obligue a repetirlos.
 *
 * Vive en el navegador de cada persona: la recepcionista de una sede no hereda
 * las preferencias de otra. Si el almacenamiento no está disponible (modo
 * privado, permisos), la app sigue funcionando sin recordar nada.
 */
const CLAVE = 'dentalgest_habituales';

export function habituales() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {};
  } catch {
    return {};
  }
}

export function recordarHabituales({ consultorio_id, cubiculo_id, doctor_id }) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ consultorio_id, cubiculo_id, doctor_id }));
  } catch { /* sin almacenamiento: simplemente no se recuerda */ }
}
