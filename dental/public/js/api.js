const CLAVE_TOKEN = 'dentalgest_token';

export const sesion = {
  get token() { return localStorage.getItem(CLAVE_TOKEN); },
  set token(v) { v ? localStorage.setItem(CLAVE_TOKEN, v) : localStorage.removeItem(CLAVE_TOKEN); },
  usuario: null,
  // Ajustes del consultorio; se cargan al abrir la sesión.
  ajustes: null,
};

/** Error del API con el mensaje en español que devuelve el servidor. */
export class ErrorApi extends Error {
  constructor(estado, mensaje, detalle) {
    super(mensaje);
    this.estado = estado;
    this.detalle = detalle;
  }
}

async function peticion(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, headers: {} };
  if (sesion.token) opciones.headers['Authorization'] = `Bearer ${sesion.token}`;
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  let res;
  try {
    res = await fetch(ruta, opciones);
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el consultorio. Revisa el internet y vuelve a intentarlo.');
  }
  let datos = null;
  const texto = await res.text();
  if (texto) {
    try { datos = JSON.parse(texto); } catch { datos = null; }
  }
  if (!res.ok) {
    throw new ErrorApi(res.status, datos?.error || `Error ${res.status}`, datos?.detalle);
  }
  return datos;
}

const qs = (params = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, v);
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

/** URL de una imagen del expediente. Único punto que conoce dónde viven los archivos. */
export function urlFoto(foto) {
  return `/uploads/${foto.archivo}`;
}

export const api = {
  // Autenticación
  login: (email, password) => peticion('POST', '/api/auth/login', { email, password }),
  logout: () => peticion('POST', '/api/auth/logout'),
  yo: () => peticion('GET', '/api/auth/yo'),
  usuarios: () => peticion('GET', '/api/usuarios'),
  crearUsuario: (d) => peticion('POST', '/api/usuarios', d),

  // Estructura de la clínica
  consultorios: () => peticion('GET', '/api/consultorios'),
  crearConsultorio: (d) => peticion('POST', '/api/consultorios', d),
  actualizarConsultorio: (id, d) => peticion('PUT', `/api/consultorios/${id}`, d),
  cubiculos: (p) => peticion('GET', `/api/cubiculos${qs(p)}`),
  crearCubiculo: (d) => peticion('POST', '/api/cubiculos', d),
  doctores: () => peticion('GET', '/api/doctores'),
  crearDoctor: (d) => peticion('POST', '/api/doctores', d),
  actualizarDoctor: (id, d) => peticion('PUT', `/api/doctores/${id}`, d),
  catalogo: () => peticion('GET', '/api/catalogo'),
  crearCatalogo: (d) => peticion('POST', '/api/catalogo', d),

  // Pacientes
  pacientes: (q) => peticion('GET', `/api/pacientes${qs({ q })}`),
  paciente: (id) => peticion('GET', `/api/pacientes/${id}`),
  crearPaciente: (d) => peticion('POST', '/api/pacientes', d),
  actualizarPaciente: (id, d) => peticion('PUT', `/api/pacientes/${id}`, d),
  expediente: (id) => peticion('GET', `/api/pacientes/${id}/expediente`),
  odontograma: (id) => peticion('GET', `/api/pacientes/${id}/odontograma`),
  guardarDiente: (id, d) => peticion('POST', `/api/pacientes/${id}/odontograma`, d),

  // Citas y agenda
  citas: (p) => peticion('GET', `/api/citas${qs(p)}`),
  cita: (id) => peticion('GET', `/api/citas/${id}`),
  crearCita: (d) => peticion('POST', '/api/citas', d),
  actualizarCita: (id, d) => peticion('PUT', `/api/citas/${id}`, d),
  cambiarEstadoCita: (id, estado) => peticion('PATCH', `/api/citas/${id}/estado`, { estado }),
  verificarDisponibilidad: (d) => peticion('POST', '/api/citas/verificar', d),
  agenda: (p) => peticion('GET', `/api/agenda${qs(p)}`),

  // Clínico
  crearTratamiento: (citaId, d) => peticion('POST', `/api/citas/${citaId}/tratamientos`, d),
  subirFoto: (citaId, d) => peticion('POST', `/api/citas/${citaId}/fotos`, d),
  crearRecordatorio: (citaId, d) => peticion('POST', `/api/citas/${citaId}/recordatorios`, d),
  recordatorios: (p) => peticion('GET', `/api/recordatorios${qs(p)}`),
  actualizarRecordatorio: (id, d) => peticion('PATCH', `/api/recordatorios/${id}`, d),
  consentimientos: (p) => peticion('GET', `/api/consentimientos${qs(p)}`),
  consentimiento: (id) => peticion('GET', `/api/consentimientos/${id}`),
  crearConsentimiento: (d) => peticion('POST', '/api/consentimientos', d),
  actualizarConsentimiento: (id, d) => peticion('PUT', `/api/consentimientos/${id}`, d),
  generarConsentimiento: (tratamientoId, d = {}) => peticion('POST', `/api/tratamientos/${tratamientoId}/consentimiento`, d),
  firmarConsentimiento: (id, d) => peticion('POST', `/api/consentimientos/${id}/firmar`, d),
  anularConsentimiento: (id, d) => peticion('POST', `/api/consentimientos/${id}/anular`, d),

  // Contabilidad
  cargos: (p) => peticion('GET', `/api/cargos${qs(p)}`),
  crearCargo: (d) => peticion('POST', '/api/cargos', d),
  pagos: (p) => peticion('GET', `/api/pagos${qs(p)}`),
  crearPago: (d) => peticion('POST', '/api/pagos', d),
  gastos: (p) => peticion('GET', `/api/gastos${qs(p)}`),
  crearGasto: (d) => peticion('POST', '/api/gastos', d),
  estadoCuenta: (id) => peticion('GET', `/api/pacientes/${id}/estado-cuenta`),
  balance: (p) => peticion('GET', `/api/contabilidad/balance${qs(p)}`),
  resumen: () => peticion('GET', '/api/resumen'),

  // Ajustes del consultorio
  ajustes: () => peticion('GET', '/api/ajustes'),
  guardarAjustes: (d) => peticion('PUT', '/api/ajustes', d),
};
