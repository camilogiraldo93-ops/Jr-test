/**
 * Sustituto de `public/js/api.js` para la demo navegable.
 *
 * Implementa la MISMA superficie que el cliente real, pero resolviendo todo dentro
 * del navegador contra un almacén en memoria que se persiste en localStorage. Las
 * reglas de negocio (conflictos de agenda, permisos por rol, estados del
 * consentimiento, bloqueo del cierre de cita) están portadas desde
 * `server/routes/*.js`; si allí cambian, hay que reflejarlo aquí.
 *
 * Los datos iniciales se generan con el mismo `seed.js` de la aplicación, así que
 * la demo arranca exactamente con el consultorio de ejemplo documentado.
 */

const CLAVE_ALMACEN = 'dentalgest_demo_datos';
const CLAVE_SESION = 'dentalgest_demo_sesion';

export class ErrorApi extends Error {
  constructor(estado, mensaje, detalle) {
    super(mensaje);
    this.estado = estado;
    this.detalle = detalle;
  }
}

/* --------------------------- Almacenamiento local ------------------------- */

// Si el navegador bloquea localStorage (modo incógnito estricto), la demo sigue
// funcionando en memoria durante la sesión.
const deposito = (() => {
  try {
    localStorage.setItem('__prueba__', '1');
    localStorage.removeItem('__prueba__');
    return localStorage;
  } catch {
    const mapa = new Map();
    return {
      getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
      setItem: (k, v) => mapa.set(k, v),
      removeItem: (k) => mapa.delete(k),
    };
  }
})();

let bd = null;

function clonar(v) {
  return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function guardar() {
  try {
    deposito.setItem(CLAVE_ALMACEN, JSON.stringify(bd));
  } catch {
    // Si no cabe (muchas imágenes), la demo continúa solo en memoria.
  }
}

/** Reinicia la demo con los datos de ejemplo originales. */
export function reiniciarDemo() {
  bd = desplazarFechas(clonar(window.__SEMILLA_DENTALGEST__));
  guardar();
}

function cargar() {
  const guardado = deposito.getItem(CLAVE_ALMACEN);
  if (guardado) {
    try {
      const datos = JSON.parse(guardado);
      if (datos && datos.version === window.__SEMILLA_DENTALGEST__.version) {
        bd = datos;
        return;
      }
    } catch { /* datos corruptos: se regeneran */ }
  }
  reiniciarDemo();
}

/**
 * La semilla se genera al construir la demo, así que sus fechas envejecen.
 * Se desplazan todas para que la agenda siga teniendo sentido el día que se abra.
 */
function desplazarFechas(datos) {
  const base = new Date(`${datos.fecha_base}T12:00:00`);
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  const dias = Math.round((hoy - base) / 86400000);
  if (!dias) return datos;

  const mover = (valor) => {
    if (typeof valor !== 'string') return valor;
    const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    if (!m) return valor;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
    if (Number.isNaN(d.getTime())) return valor;
    d.setDate(d.getDate() + dias);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${m[4]}`;
  };

  const CAMPOS_FECHA = {
    citas: ['inicio', 'fin', 'creada_en', 'actualizada_en'],
    tratamientos: ['fecha', 'creado_en'],
    cargos: ['fecha', 'creado_en'],
    pagos: ['fecha', 'creado_en'],
    gastos: ['fecha', 'creado_en'],
    recordatorios: ['fecha_objetivo', 'creado_en', 'actualizado_en'],
    consentimientos: ['fecha', 'creado_en', 'firmado_en', 'firma_paciente_en', 'firma_doctor_en', 'anulado_en'],
    fotos: ['creada_en'],
    odontograma: ['actualizado_en'],
  };
  for (const [tabla, campos] of Object.entries(CAMPOS_FECHA)) {
    for (const fila of datos[tabla] || []) {
      for (const campo of campos) if (fila[campo]) fila[campo] = mover(fila[campo]);
    }
  }
  datos.fecha_base = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return datos;
}

/* -------------------------------- Utilidades ------------------------------ */

const tabla = (n) => (bd[n] ||= []);
const buscar = (n, id) => tabla(n).find((x) => Number(x.id) === Number(id)) || null;
const siguienteId = (n) => tabla(n).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

function insertar(n, fila) {
  const nueva = { ...fila, id: siguienteId(n) };
  tabla(n).push(nueva);
  guardar();
  return nueva;
}

const ahora = () => new Date().toISOString();
const hoyIso = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const texto = (v, pd = null) => {
  if (v === undefined || v === null) return pd;
  const s = String(v).trim();
  return s === '' ? pd : s;
};
const entero = (v, pd = null) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : pd;
};
const numero = (v, pd = 0) => (Number.isFinite(Number(v)) ? Number(v) : pd);

function requerido(cuerpo, campos) {
  const faltan = campos.filter((c) => {
    const v = cuerpo?.[c];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (faltan.length) {
    throw new ErrorApi(400, `Faltan campos obligatorios: ${faltan.join(', ')}.`, { campos: faltan });
  }
}

function edad(fechaNacimiento) {
  const f = texto(fechaNacimiento);
  if (!f) return null;
  const n = new Date(`${f.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(n.getTime())) return null;
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) a--;
  return a;
}

/* ---------------------------------- Sesión -------------------------------- */

export const sesion = {
  get token() { return deposito.getItem(CLAVE_SESION); },
  set token(v) { v ? deposito.setItem(CLAVE_SESION, v) : deposito.removeItem(CLAVE_SESION); },
  usuario: null,
};

function usuarioActual() {
  const t = sesion.token;
  if (!t) throw new ErrorApi(401, 'Sesión no válida o expirada. Inicia sesión de nuevo.');
  const u = tabla('usuarios').find((x) => `demo-${x.id}` === t);
  if (!u) throw new ErrorApi(401, 'Sesión no válida o expirada. Inicia sesión de nuevo.');
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, doctor_id: u.doctor_id };
}

function exigirRol(...roles) {
  const u = usuarioActual();
  if (!roles.includes(u.rol)) {
    throw new ErrorApi(403, `Tu rol (${u.rol}) no tiene permiso para esta acción.`);
  }
  return u;
}

function verificarDoctorPropio(u, doctorId) {
  if (u.rol === 'doctor' && u.doctor_id && Number(doctorId) !== Number(u.doctor_id)) {
    throw new ErrorApi(403, 'Un doctor solo puede registrar información clínica de sus propias citas.');
  }
}

/* --------------------------- Enriquecido de filas ------------------------- */

const ACENTOS = [['á','a'],['é','e'],['í','i'],['ó','o'],['ú','u'],['ü','u'],['ñ','n']];

/** Quita las tildes: quien busca al teléfono escribe «lucia», no «Lucía». */
function sinTildes(t) {
  return ACENTOS.reduce((s2, [con, sin]) => s2.split(con).join(sin), String(t || '').toLowerCase());
}

/** «María González» / «Rosa» cuando no hay apellidos, sin dejar «Rosa null». */
function nombreCompleto(nombre, apellidos) {
  return [nombre, apellidos].filter(Boolean).join(' ');
}

function conNombres(c) {
  const p = buscar('pacientes', c.paciente_id) || {};
  const d = buscar('doctores', c.doctor_id) || {};
  const cu = buscar('cubiculos', c.cubiculo_id) || {};
  const co = buscar('consultorios', c.consultorio_id) || {};
  const cat = c.catalogo_id ? buscar('catalogo_tratamientos', c.catalogo_id) : null;
  return {
    ...c,
    paciente_nombre: p.nombre, paciente_apellidos: p.apellidos,
    paciente_telefono: p.telefono, paciente_cedula: p.cedula,
    doctor_nombre: d.nombre, doctor_color: d.color,
    cubiculo_nombre: cu.nombre, consultorio_nombre: co.nombre,
    catalogo_nombre: cat?.nombre ?? null, catalogo_precio: cat?.precio_base ?? null,
    catalogo_duracion_min: cat?.duracion_min ?? null,
    catalogo_requiere_consentimiento: cat?.requiere_consentimiento ?? null,
  };
}

/** Tratamiento previsto de una cita: '' y null significan "sin definir". */
function tratamientoPrevisto(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const cat = buscar('catalogo_tratamientos', valor);
  if (!cat) throw new ErrorApi(404, 'El tratamiento del catálogo indicado no existe.');
  if (!cat.activo) throw new ErrorApi(400, `El tratamiento "${cat.nombre}" está desactivado en el catálogo.`);
  return cat;
}

/* ---------------------------- Reglas de la agenda ------------------------- */

const ESTADOS_BLOQUEANTES = ['agendada', 'confirmada', 'en_curso', 'completada'];
const TRANSICIONES = {
  agendada: ['confirmada', 'en_curso', 'cancelada', 'no_asistio'],
  confirmada: ['en_curso', 'completada', 'cancelada', 'no_asistio'],
  en_curso: ['completada', 'cancelada'],
  completada: [],
  cancelada: ['agendada'],
  no_asistio: ['agendada'],
};

function buscarConflictos({ cubiculo_id, doctor_id, inicio, fin, excluir_id = null }) {
  return tabla('citas')
    .filter((c) => ESTADOS_BLOQUEANTES.includes(c.estado))
    .filter((c) => Number(c.cubiculo_id) === Number(cubiculo_id) || Number(c.doctor_id) === Number(doctor_id))
    .filter((c) => c.inicio < fin && c.fin > inicio)
    .filter((c) => excluir_id === null || Number(c.id) !== Number(excluir_id))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((c) => {
      const e = conNombres(c);
      const mismoCub = Number(c.cubiculo_id) === Number(cubiculo_id);
      const mismoDoc = Number(c.doctor_id) === Number(doctor_id);
      return {
        cita_id: c.id,
        motivo: mismoCub && mismoDoc ? 'cubiculo_y_doctor' : mismoCub ? 'cubiculo' : 'doctor',
        inicio: c.inicio, fin: c.fin,
        doctor: e.doctor_nombre, cubiculo: e.cubiculo_nombre, consultorio: e.consultorio_nombre,
        paciente: `${e.paciente_nombre} ${e.paciente_apellidos}`, estado: c.estado,
      };
    });
}

function explicarConflictos(conflictos) {
  return conflictos.map((c) => {
    const quien = c.motivo === 'cubiculo' ? `el cubículo "${c.cubiculo}"`
      : c.motivo === 'doctor' ? c.doctor
      : `el cubículo "${c.cubiculo}" y ${c.doctor}`;
    const verbo = c.motivo === 'cubiculo_y_doctor' ? 'están' : 'está';
    return `Esa hora ya está ocupada: ${quien} ${verbo} con ${c.paciente} ` +
           `de ${c.inicio.slice(11)} a ${c.fin.slice(11)}. Elige otra hora o el primer hueco libre ` +
           `después de las ${c.fin.slice(11)} (cita #${c.cita_id}).`;
  }).join(' ');
}

function validarEstructura({ consultorio_id, cubiculo_id, doctor_id, paciente_id }) {
  if (!buscar('consultorios', consultorio_id)) throw new ErrorApi(404, 'El consultorio indicado no existe.');
  const cu = buscar('cubiculos', cubiculo_id);
  if (!cu) throw new ErrorApi(404, 'El cubículo indicado no existe.');
  if (Number(cu.consultorio_id) !== Number(consultorio_id)) {
    throw new ErrorApi(400, `El cubículo "${cu.nombre}" no pertenece al consultorio seleccionado.`);
  }
  if (!buscar('doctores', doctor_id)) throw new ErrorApi(404, 'El doctor indicado no existe.');
  if (!buscar('pacientes', paciente_id)) throw new ErrorApi(404, 'El paciente indicado no existe.');
  const asignado = tabla('doctor_consultorio').some(
    (x) => Number(x.doctor_id) === Number(doctor_id) && Number(x.consultorio_id) === Number(consultorio_id));
  if (!asignado) {
    throw new ErrorApi(400, 'El doctor no está asignado a ese consultorio. Asígnalo primero en Configuración.');
  }
}

function fechaHora(v, campo) {
  const s = texto(v);
  if (!s) throw new ErrorApi(400, `El campo ${campo} es obligatorio.`);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) throw new ErrorApi(400, `El campo ${campo} debe tener formato AAAA-MM-DDTHH:MM (recibido: "${s}").`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/* ------------------------------ Consentimientos --------------------------- */

function crearConsentimientoInterno({
  paciente_id, doctor_id, consultorio_id = null, cita_id = null, tratamiento_id = null,
  catalogo_id = null, tratamiento, observaciones = null, creado_por = null, reemplaza_a = null,
}) {
  const pac = buscar('pacientes', paciente_id);
  if (!pac) throw new ErrorApi(404, 'Paciente no encontrado.');
  const doc = buscar('doctores', doctor_id);
  if (!doc) throw new ErrorApi(404, 'Doctor no encontrado.');
  const con = consultorio_id ? buscar('consultorios', consultorio_id) : null;

  const a = edad(pac.fecha_nacimiento);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');

  return insertar('consentimientos', {
    paciente_id, doctor_id, consultorio_id, cita_id, tratamiento_id, catalogo_id,
    tratamiento: texto(tratamiento), observaciones: texto(observaciones),
    paciente_nombre: nombreCompleto(pac.nombre, pac.apellidos),
    paciente_cedula: pac.cedula, paciente_fecha_nacimiento: pac.fecha_nacimiento,
    es_menor: a !== null && a < 18 ? 1 : 0,
    doctor_nombre: doc.nombre, doctor_especialidad: doc.especialidad,
    consultorio_nombre: con?.nombre ?? null, consultorio_direccion: con?.direccion ?? null,
    consultorio_telefono: con?.telefono ?? null, consultorio_ciudad: con?.ciudad ?? null,
    fecha: hoyIso(), hora: `${p(d.getHours())}:${p(d.getMinutes())}`,
    representante_nombre: null, representante_cedula: null, representante_parentesco: null,
    firma_paciente: null, firma_paciente_nombre: null, firma_paciente_en: null,
    firma_doctor: null, firma_doctor_en: null,
    estado: 'pendiente', firmado_en: null,
    anulado_en: null, anulado_motivo: null, anulado_por: null,
    reemplaza_a, reemplazado_por: null,
    creado_por, creado_en: ahora(),
  });
}

function consentimientoConCita(c) {
  const cita = c.cita_id ? buscar('citas', c.cita_id) : null;
  return { ...c, cita_inicio: cita?.inicio ?? null, cita_motivo: cita?.motivo ?? null };
}

function validarFirma(valor, quien) {
  const s = texto(valor);
  if (!s) throw new ErrorApi(400, `Falta la firma ${quien}. Debe trazarse en pantalla.`);
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(s)) {
    throw new ErrorApi(400, `La firma ${quien} no tiene un formato de imagen válido.`);
  }
  return s;
}

/* ------------------------------ Ámbito por rol ---------------------------- */

function pacientesDelDoctor(u) {
  const ids = new Set();
  for (const c of tabla('citas')) if (Number(c.doctor_id) === Number(u.doctor_id)) ids.add(c.paciente_id);
  for (const t of tabla('tratamientos')) if (Number(t.doctor_id) === Number(u.doctor_id)) ids.add(t.paciente_id);
  return ids;
}

function puedeVerPaciente(u, pacienteId) {
  if (u.rol !== 'doctor' || !u.doctor_id) return true;
  return pacientesDelDoctor(u).has(Number(pacienteId));
}

/* ----------------------------- Estado de cuenta --------------------------- */

function cargosDe(filtro) {
  return tabla('cargos').filter(filtro).map((c) => {
    const pagado = tabla('pagos')
      .filter((p) => Number(p.cargo_id) === Number(c.id))
      .reduce((s, p) => s + p.monto, 0);
    const pac = buscar('pacientes', c.paciente_id) || {};
    return {
      ...c, pagado: redondear(pagado), saldo: redondear(c.monto - pagado),
      paciente_nombre: pac.nombre, paciente_apellidos: pac.apellidos,
    };
  }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id);
}

/* ----------------------------------- API ---------------------------------- */

export function urlFoto(foto) {
  // En la demo las imágenes viajan dentro del propio documento.
  return foto.archivo;
}

const CREDENCIALES = {
  'admin@clinica.com': 'admin123',
  'recepcion@clinica.com': 'recepcion123',
  'ana.morales@clinica.com': 'doctor123',
  'luis.cabrera@clinica.com': 'doctor123',
  'sofia.herrera@clinica.com': 'doctor123',
};

export const api = {
  /* ------------------------------ Autenticación --------------------------- */
  async login(email, password) {
    const correo = String(email || '').toLowerCase().trim();
    const u = tabla('usuarios').find((x) => x.email === correo && x.activo);
    if (!u || CREDENCIALES[correo] !== String(password)) {
      throw new ErrorApi(401, 'Correo o contraseña incorrectos.');
    }
    const usuario = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, doctor_id: u.doctor_id };
    return { token: `demo-${u.id}`, expira_en: null, usuario };
  },
  async logout() { return { ok: true }; },
  async yo() { return usuarioActual(); },

  async usuarios() {
    exigirRol('admin');
    return clonar(tabla('usuarios').map(({ password_hash, salt, ...u }) => u));
  },
  async crearUsuario(d) {
    exigirRol('admin');
    requerido(d, ['nombre', 'email', 'password', 'rol']);
    if (tabla('usuarios').some((u) => u.email === String(d.email).toLowerCase().trim())) {
      throw new ErrorApi(409, 'Ya existe un usuario con ese correo.');
    }
    if (String(d.password).length < 6) throw new ErrorApi(400, 'La contraseña debe tener al menos 6 caracteres.');
    const nuevo = insertar('usuarios', {
      nombre: texto(d.nombre), email: String(d.email).toLowerCase().trim(),
      rol: d.rol, doctor_id: d.doctor_id ?? null, activo: 1, creado_en: ahora(),
    });
    CREDENCIALES[nuevo.email] = String(d.password);
    return clonar(nuevo);
  },

  /* --------------------------- Estructura clínica ------------------------- */
  async consultorios() {
    usuarioActual();
    return clonar(tabla('consultorios')
      .slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((c) => ({
        ...c,
        cubiculos: tabla('cubiculos').filter((x) => Number(x.consultorio_id) === Number(c.id))
          .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        doctores: tabla('doctor_consultorio')
          .filter((x) => Number(x.consultorio_id) === Number(c.id))
          .map((x) => buscar('doctores', x.doctor_id)).filter(Boolean),
      })));
  },
  async crearConsultorio(d) {
    exigirRol('admin');
    requerido(d, ['nombre']);
    return clonar(insertar('consultorios', {
      nombre: texto(d.nombre), direccion: texto(d.direccion), telefono: texto(d.telefono),
      ciudad: texto(d.ciudad), activo: 1, creado_en: ahora(),
    }));
  },
  async actualizarConsultorio(id, d) {
    exigirRol('admin');
    const c = buscar('consultorios', id);
    if (!c) throw new ErrorApi(404, 'Consultorio no encontrado.');
    Object.assign(c, {
      nombre: texto(d.nombre, c.nombre), direccion: texto(d.direccion, c.direccion),
      telefono: texto(d.telefono, c.telefono), ciudad: texto(d.ciudad, c.ciudad),
    });
    guardar();
    return clonar(c);
  },
  async cubiculos(p = {}) {
    usuarioActual();
    let lista = tabla('cubiculos');
    if (p.consultorio_id) lista = lista.filter((c) => Number(c.consultorio_id) === Number(p.consultorio_id));
    return clonar(lista.map((c) => ({
      ...c, consultorio_nombre: buscar('consultorios', c.consultorio_id)?.nombre,
    })));
  },
  async crearCubiculo(d) {
    exigirRol('admin');
    requerido(d, ['consultorio_id', 'nombre']);
    if (!buscar('consultorios', d.consultorio_id)) throw new ErrorApi(404, 'El consultorio indicado no existe.');
    return clonar(insertar('cubiculos', {
      consultorio_id: entero(d.consultorio_id), nombre: texto(d.nombre),
      descripcion: texto(d.descripcion), activo: 1, creado_en: ahora(),
    }));
  },
  async doctores() {
    usuarioActual();
    return clonar(tabla('doctores')
      .slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((d) => ({
        ...d,
        consultorios: tabla('doctor_consultorio').filter((x) => Number(x.doctor_id) === Number(d.id))
          .map((x) => buscar('consultorios', x.consultorio_id)).filter(Boolean)
          .map((c) => ({ id: c.id, nombre: c.nombre })),
        cubiculos: tabla('doctor_cubiculo').filter((x) => Number(x.doctor_id) === Number(d.id))
          .map((x) => buscar('cubiculos', x.cubiculo_id)).filter(Boolean)
          .map((c) => ({ id: c.id, nombre: c.nombre, consultorio_id: c.consultorio_id })),
      })));
  },
  async crearDoctor(d) {
    exigirRol('admin');
    requerido(d, ['nombre']);
    if (d.cedula && tabla('doctores').some((x) => x.cedula === texto(d.cedula))) {
      throw new ErrorApi(409, 'Ya existe un doctor con esa cédula.');
    }
    const doctor = insertar('doctores', {
      nombre: texto(d.nombre), cedula: texto(d.cedula), especialidad: texto(d.especialidad),
      telefono: texto(d.telefono), email: texto(d.email), color: texto(d.color, '#0ea5e9'),
      activo: 1, creado_en: ahora(),
    });
    asignarDoctor(doctor.id, d.consultorios, d.cubiculos);
    return (await this.doctores()).find((x) => x.id === doctor.id);
  },
  async actualizarDoctor(id, d) {
    exigirRol('admin');
    const doc = buscar('doctores', id);
    if (!doc) throw new ErrorApi(404, 'Doctor no encontrado.');
    Object.assign(doc, {
      nombre: texto(d.nombre, doc.nombre), cedula: texto(d.cedula, doc.cedula),
      especialidad: texto(d.especialidad, doc.especialidad), telefono: texto(d.telefono, doc.telefono),
      email: texto(d.email, doc.email), color: texto(d.color, doc.color),
    });
    if (d.consultorios || d.cubiculos) asignarDoctor(doc.id, d.consultorios, d.cubiculos);
    guardar();
    return (await this.doctores()).find((x) => x.id === doc.id);
  },
  async catalogo() {
    usuarioActual();
    return clonar(tabla('catalogo_tratamientos').filter((c) => c.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre)));
  },
  async crearCatalogo(d) {
    exigirRol('admin');
    requerido(d, ['nombre']);
    return clonar(insertar('catalogo_tratamientos', {
      nombre: texto(d.nombre), descripcion: texto(d.descripcion),
      precio_base: numero(d.precio_base), duracion_min: entero(d.duracion_min, 30),
      requiere_consentimiento: d.requiere_consentimiento ? 1 : 0,
      riesgos: texto(d.riesgos), alternativas: texto(d.alternativas), activo: 1,
    }));
  },

  /* -------------------------------- Pacientes ----------------------------- */
  async pacientes(q) {
    const u = usuarioActual();
    let lista = tabla('pacientes');
    if (u.rol === 'doctor' && u.doctor_id) {
      const permitidos = pacientesDelDoctor(u);
      lista = lista.filter((p) => permitidos.has(p.id));
    }
    const busqueda = texto(q);
    if (busqueda) {
      const b = sinTildes(busqueda);
      lista = lista.filter((p) =>
        sinTildes(nombreCompleto(p.nombre, p.apellidos)).includes(b) ||
        sinTildes(p.cedula || '').includes(b) ||
        (p.telefono || '').includes(busqueda));
    }
    return clonar(lista.slice().sort((a, b) =>
      String(a.apellidos || '').localeCompare(String(b.apellidos || '')) ||
      a.nombre.localeCompare(b.nombre)));
  },
  async paciente(id) {
    const u = usuarioActual();
    const p = buscar('pacientes', id);
    if (!p) throw new ErrorApi(404, 'Paciente no encontrado.');
    if (!puedeVerPaciente(u, p.id)) throw new ErrorApi(403, 'Este paciente no está en tu lista de atención.');
    return clonar(p);
  },
  async crearPaciente(d) {
    exigirRol('admin', 'recepcion', 'doctor');
    // Basta el nombre: quien llama a veces no deja el apellido.
    requerido(d, ['nombre']);
    const cedula = texto(d.cedula);
    if (cedula && tabla('pacientes').some((p) => p.cedula === cedula)) {
      throw new ErrorApi(409, `Ya existe un paciente con la cédula ${cedula}.`);
    }
    const t = ahora();
    return clonar(insertar('pacientes', {
      nombre: texto(d.nombre), apellidos: texto(d.apellidos), cedula,
      telefono: texto(d.telefono), email: texto(d.email),
      fecha_nacimiento: texto(d.fecha_nacimiento), sexo: texto(d.sexo),
      direccion: texto(d.direccion), ocupacion: texto(d.ocupacion),
      contacto_emergencia: texto(d.contacto_emergencia), telefono_emergencia: texto(d.telefono_emergencia),
      alergias: texto(d.alergias), medicamentos: texto(d.medicamentos),
      antecedentes_medicos: texto(d.antecedentes_medicos),
      antecedentes_odontologicos: texto(d.antecedentes_odontologicos),
      motivo_consulta: texto(d.motivo_consulta), notas: texto(d.notas),
      creado_en: t, actualizado_en: t,
    }));
  },
  async actualizarPaciente(id, d) {
    exigirRol('admin', 'recepcion', 'doctor');
    const p = buscar('pacientes', id);
    if (!p) throw new ErrorApi(404, 'Paciente no encontrado.');
    const cedula = texto(d.cedula, p.cedula);
    if (cedula && cedula !== p.cedula && tabla('pacientes').some((x) => x.cedula === cedula)) {
      throw new ErrorApi(409, `Ya existe otro paciente con la cédula ${cedula}.`);
    }
    for (const c of ['nombre', 'apellidos', 'telefono', 'email', 'fecha_nacimiento', 'sexo', 'direccion',
      'ocupacion', 'contacto_emergencia', 'telefono_emergencia', 'alergias', 'medicamentos',
      'antecedentes_medicos', 'antecedentes_odontologicos', 'motivo_consulta', 'notas']) {
      p[c] = texto(d[c], p[c]);
    }
    p.cedula = cedula;
    p.actualizado_en = ahora();
    guardar();
    return clonar(p);
  },
  async odontograma(id) {
    usuarioActual();
    return clonar(tabla('odontograma').filter((o) => Number(o.paciente_id) === Number(id))
      .sort((a, b) => a.diente.localeCompare(b.diente)));
  },
  async guardarDiente(id, d) {
    exigirRol('admin', 'doctor');
    if (!buscar('pacientes', id)) throw new ErrorApi(404, 'Paciente no encontrado.');
    requerido(d, ['diente', 'estado']);
    const cara = texto(d.cara, 'general');
    let reg = tabla('odontograma').find((o) =>
      Number(o.paciente_id) === Number(id) && o.diente === texto(d.diente) && o.cara === cara);
    if (reg) {
      Object.assign(reg, { estado: d.estado, nota: texto(d.nota), actualizado_en: ahora() });
      guardar();
    } else {
      reg = insertar('odontograma', {
        paciente_id: entero(id), diente: texto(d.diente), cara, estado: d.estado,
        nota: texto(d.nota), tratamiento_id: d.tratamiento_id ?? null, actualizado_en: ahora(),
      });
    }
    return clonar(reg);
  },

  async expediente(id) {
    const u = usuarioActual();
    const p = buscar('pacientes', id);
    if (!p) throw new ErrorApi(404, 'Paciente no encontrado.');
    if (!puedeVerPaciente(u, p.id)) throw new ErrorApi(403, 'Este paciente no está en tu lista de atención.');

    const citas = tabla('citas').filter((c) => Number(c.paciente_id) === Number(id))
      .map(conNombres).sort((a, b) => b.inicio.localeCompare(a.inicio));
    const tratamientos = tabla('tratamientos').filter((t) => Number(t.paciente_id) === Number(id))
      .map((t) => ({
        ...t,
        doctor_nombre: buscar('doctores', t.doctor_id)?.nombre,
        cubiculo_nombre: buscar('cubiculos', t.cubiculo_id)?.nombre,
        consultorio_nombre: buscar('consultorios', t.consultorio_id)?.nombre,
      }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id);
    const fotos = tabla('fotos').filter((f) => Number(f.paciente_id) === Number(id))
      .sort((a, b) => (b.creada_en || '').localeCompare(a.creada_en || ''));
    const recordatorios = tabla('recordatorios').filter((r) => Number(r.paciente_id) === Number(id))
      .sort((a, b) => a.estado.localeCompare(b.estado) ||
        (a.fecha_objetivo || '9999-12-31').localeCompare(b.fecha_objetivo || '9999-12-31'));
    const consentimientos = tabla('consentimientos').filter((c) => Number(c.paciente_id) === Number(id))
      .map(consentimientoConCita)
      .sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || ''));
    const odontograma = tabla('odontograma').filter((o) => Number(o.paciente_id) === Number(id))
      .sort((a, b) => a.diente.localeCompare(b.diente));

    const cargos = cargosDe((c) => Number(c.paciente_id) === Number(id));
    const pagos = tabla('pagos').filter((x) => Number(x.paciente_id) === Number(id))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id);
    const totalCargos = redondear(cargos.reduce((s, c) => s + c.monto, 0));
    const totalPagos = redondear(pagos.reduce((s, c) => s + c.monto, 0));

    const cronologia = [
      ...citas.map((c) => ({
        tipo: 'cita', fecha: c.inicio, titulo: c.motivo || 'Cita odontológica',
        detalle: `Estado: ${c.estado}`, doctor: c.doctor_nombre,
        lugar: `${c.consultorio_nombre} · ${c.cubiculo_nombre}`, ref_id: c.id,
      })),
      ...tratamientos.map((t) => ({
        tipo: 'tratamiento', fecha: t.fecha, titulo: t.nombre,
        detalle: t.notas_clinicas || t.descripcion || '', doctor: t.doctor_nombre,
        lugar: `${t.consultorio_nombre} · ${t.cubiculo_nombre}`, ref_id: t.id,
      })),
      ...consentimientos.map((c) => ({
        tipo: 'consentimiento', fecha: c.firmado_en || c.creado_en, titulo: `Consentimiento: ${c.tratamiento}`,
        detalle: c.estado === 'firmado' ? `Firmado por ${c.firma_paciente_nombre || c.paciente_nombre}`
          : c.estado === 'anulado' ? `Anulado: ${c.anulado_motivo || 'sin motivo'}` : 'Pendiente de firma',
        doctor: c.doctor_nombre, lugar: '', ref_id: c.id,
      })),
      ...fotos.map((f) => ({
        tipo: 'foto', fecha: f.creada_en, titulo: `Imagen: ${f.nombre}`,
        detalle: f.tipo, doctor: '', lugar: '', ref_id: f.id,
      })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    const ahoraCorto = new Date().toISOString().slice(0, 16);
    const proximaCita = citas
      .filter((c) => ['agendada', 'confirmada'].includes(c.estado) && c.inicio >= ahoraCorto)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))[0] || null;

    return clonar({
      paciente: p, citas, tratamientos, fotos, recordatorios, consentimientos, odontograma,
      cronologia, proxima_cita: proximaCita,
      estado_cuenta: {
        cargos, pagos, total_cargos: totalCargos, total_pagos: totalPagos,
        saldo: redondear(totalCargos - totalPagos),
      },
    });
  },

  /* ---------------------------------- Citas ------------------------------- */
  async citas(p = {}) {
    const u = usuarioActual();
    let lista = tabla('citas');
    if (u.rol === 'doctor' && u.doctor_id) lista = lista.filter((c) => Number(c.doctor_id) === Number(u.doctor_id));
    for (const clave of ['consultorio_id', 'cubiculo_id', 'doctor_id', 'paciente_id', 'estado']) {
      if (p[clave]) lista = lista.filter((c) => String(c[clave]) === String(p[clave]));
    }
    if (p.desde) lista = lista.filter((c) => c.inicio >= `${p.desde}T00:00`);
    if (p.hasta) lista = lista.filter((c) => c.inicio <= `${p.hasta}T23:59`);
    return clonar(lista.map(conNombres).sort((a, b) => a.inicio.localeCompare(b.inicio)));
  },
  async cita(id) {
    const u = usuarioActual();
    const c = buscar('citas', id);
    if (!c) throw new ErrorApi(404, 'Cita no encontrada.');
    if (u.rol === 'doctor' && u.doctor_id && Number(c.doctor_id) !== Number(u.doctor_id)) {
      throw new ErrorApi(403, 'Esta cita pertenece a otro doctor.');
    }
    return clonar({
      ...conNombres(c),
      tratamientos: tabla('tratamientos').filter((t) => Number(t.cita_id) === Number(id)),
      fotos: tabla('fotos').filter((f) => Number(f.cita_id) === Number(id)),
      recordatorios: tabla('recordatorios').filter((r) => Number(r.cita_id) === Number(id)),
      consentimientos: tabla('consentimientos').filter((x) => Number(x.cita_id) === Number(id)),
      cargos: tabla('cargos').filter((x) => Number(x.cita_id) === Number(id)),
      cita_seguimiento: tabla('citas').filter((x) => Number(x.cita_origen_id) === Number(id)).map(conNombres),
    });
  },
  async verificarDisponibilidad(d) {
    usuarioActual();
    requerido(d, ['cubiculo_id', 'doctor_id', 'inicio', 'fin']);
    const inicio = fechaHora(d.inicio, 'inicio');
    const fin = fechaHora(d.fin, 'fin');
    if (fin <= inicio) throw new ErrorApi(400, 'La hora de fin debe ser posterior a la hora de inicio.');
    const conflictos = buscarConflictos({
      cubiculo_id: entero(d.cubiculo_id), doctor_id: entero(d.doctor_id),
      inicio, fin, excluir_id: d.excluir_id ? entero(d.excluir_id) : null,
    });
    return {
      disponible: conflictos.length === 0, conflictos,
      mensaje: conflictos.length ? explicarConflictos(conflictos) : 'Horario disponible.',
    };
  },
  async crearCita(d) {
    exigirRol('admin', 'recepcion', 'doctor');
    requerido(d, ['consultorio_id', 'cubiculo_id', 'doctor_id', 'paciente_id', 'inicio', 'fin']);
    const datos = {
      consultorio_id: entero(d.consultorio_id), cubiculo_id: entero(d.cubiculo_id),
      doctor_id: entero(d.doctor_id), paciente_id: entero(d.paciente_id),
    };
    validarEstructura(datos);
    const inicio = fechaHora(d.inicio, 'inicio');
    const fin = fechaHora(d.fin, 'fin');
    if (fin <= inicio) throw new ErrorApi(400, 'La hora de fin debe ser posterior a la hora de inicio.');
    const conflictos = buscarConflictos({ ...datos, inicio, fin });
    if (conflictos.length) throw new ErrorApi(409, explicarConflictos(conflictos), { conflictos });
    const cat = tratamientoPrevisto(d.catalogo_id);
    const t = ahora();
    const nueva = insertar('citas', {
      ...datos, inicio, fin, motivo: texto(d.motivo) || cat?.nombre || null, notas: texto(d.notas),
      estado: texto(d.estado, 'agendada'), cita_origen_id: d.cita_origen_id ?? null,
      catalogo_id: cat?.id ?? null, creada_en: t, actualizada_en: t,
    });
    return clonar(conNombres(nueva));
  },
  async actualizarCita(id, d) {
    exigirRol('admin', 'recepcion', 'doctor');
    const c = buscar('citas', id);
    if (!c) throw new ErrorApi(404, 'Cita no encontrada.');
    if (c.estado === 'completada') throw new ErrorApi(409, 'No se puede reprogramar una cita ya completada.');
    const datos = {
      consultorio_id: entero(d.consultorio_id, c.consultorio_id),
      cubiculo_id: entero(d.cubiculo_id, c.cubiculo_id),
      doctor_id: entero(d.doctor_id, c.doctor_id),
      paciente_id: entero(d.paciente_id, c.paciente_id),
    };
    validarEstructura(datos);
    const inicio = d.inicio ? fechaHora(d.inicio, 'inicio') : c.inicio;
    const fin = d.fin ? fechaHora(d.fin, 'fin') : c.fin;
    if (fin <= inicio) throw new ErrorApi(400, 'La hora de fin debe ser posterior a la hora de inicio.');
    const conflictos = buscarConflictos({ ...datos, inicio, fin, excluir_id: Number(id) });
    if (conflictos.length) throw new ErrorApi(409, explicarConflictos(conflictos), { conflictos });
    Object.assign(c, datos, {
      inicio, fin, motivo: texto(d.motivo, c.motivo), notas: texto(d.notas, c.notas),
      catalogo_id: d.catalogo_id === undefined ? c.catalogo_id : tratamientoPrevisto(d.catalogo_id)?.id ?? null,
      actualizada_en: ahora(),
    });
    guardar();
    return clonar(conNombres(c));
  },
  async cambiarEstadoCita(id, estado) {
    exigirRol('admin', 'recepcion', 'doctor');
    const c = buscar('citas', id);
    if (!c) throw new ErrorApi(404, 'Cita no encontrada.');
    if (!TRANSICIONES[estado] && !Object.keys(TRANSICIONES).includes(estado)) {
      throw new ErrorApi(400, `Estado inválido. Opciones: ${Object.keys(TRANSICIONES).join(', ')}.`);
    }
    if (estado === c.estado) return clonar(conNombres(c));
    if (!TRANSICIONES[c.estado].includes(estado)) {
      throw new ErrorApi(409,
        `No se permite pasar de "${c.estado}" a "${estado}". Transiciones válidas: ${TRANSICIONES[c.estado].join(', ') || 'ninguna'}.`);
    }
    if (estado === 'completada') {
      const pendientes = tabla('consentimientos')
        .filter((x) => Number(x.cita_id) === Number(id) && x.estado === 'pendiente');
      if (pendientes.length) {
        throw new ErrorApi(409,
          `No se puede completar la cita: hay ${pendientes.length} consentimiento(s) informado(s) sin firmar ` +
          `(${pendientes.map((p) => p.tratamiento).join(', ')}). Fírmalos antes de cerrar la atención.`,
          { consentimientos_pendientes: pendientes.map((p) => ({ id: p.id, tratamiento: p.tratamiento })) });
      }
    }
    if (['cancelada', 'no_asistio'].includes(c.estado)) {
      const conflictos = buscarConflictos({
        cubiculo_id: c.cubiculo_id, doctor_id: c.doctor_id, inicio: c.inicio, fin: c.fin, excluir_id: c.id,
      });
      if (conflictos.length) throw new ErrorApi(409, explicarConflictos(conflictos), { conflictos });
    }
    c.estado = estado;
    c.actualizada_en = ahora();
    guardar();
    return clonar(conNombres(c));
  },

  async agenda(p = {}) {
    const u = usuarioActual();
    const vista = p.vista || 'dia';
    const agrupar = p.agrupar || 'cubiculo';
    const fecha = p.fecha || hoyIso();

    const base = new Date(`${fecha}T00:00:00`);
    let desde = fecha;
    let dias = 1;
    if (vista === 'semana') {
      const dow = (base.getDay() + 6) % 7;
      const lunes = new Date(base);
      lunes.setDate(base.getDate() - dow);
      desde = fechaLocal(lunes);
      dias = 7;
    }
    const finRango = new Date(`${desde}T00:00:00`);
    finRango.setDate(finRango.getDate() + dias - 1);
    const hasta = fechaLocal(finRango);

    const soloSuyo = u.rol === 'doctor' && u.doctor_id;
    let citas = tabla('citas').filter((c) => c.inicio >= `${desde}T00:00` && c.inicio <= `${hasta}T23:59`);
    for (const clave of ['consultorio_id', 'cubiculo_id', 'doctor_id']) {
      if (p[clave]) citas = citas.filter((c) => String(c[clave]) === String(p[clave]));
    }
    if (soloSuyo) citas = citas.filter((c) => Number(c.doctor_id) === Number(u.doctor_id));

    let columnas = [];
    if (agrupar === 'cubiculo') {
      columnas = tabla('cubiculos')
        .filter((c) => !p.consultorio_id || Number(c.consultorio_id) === Number(p.consultorio_id))
        .map((c) => ({
          id: c.id, nombre: c.nombre,
          subtitulo: buscar('consultorios', c.consultorio_id)?.nombre, clave: 'cubiculo_id',
        }));
    } else if (agrupar === 'doctor') {
      columnas = tabla('doctores')
        .filter((d) => d.activo && (!soloSuyo || Number(d.id) === Number(u.doctor_id)))
        .map((d) => ({ id: d.id, nombre: d.nombre, subtitulo: d.especialidad, clave: 'doctor_id' }));
    } else {
      columnas = tabla('consultorios').filter((c) => c.activo)
        .map((c) => ({ id: c.id, nombre: c.nombre, subtitulo: c.ciudad, clave: 'consultorio_id' }));
    }

    const listaDias = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(`${desde}T00:00:00`);
      d.setDate(d.getDate() + i);
      listaDias.push(fechaLocal(d));
    }
    return clonar({
      vista, agrupar, desde, hasta, dias: listaDias, columnas,
      citas: citas.map(conNombres).sort((a, b) => a.inicio.localeCompare(b.inicio)),
    });
  },

  /* -------------------------------- Clínico ------------------------------- */
  async crearTratamiento(citaId, d) {
    const u = exigirRol('admin', 'doctor');
    const cita = buscar('citas', citaId);
    if (!cita) throw new ErrorApi(404, 'Cita no encontrada.');
    verificarDoctorPropio(u, cita.doctor_id);
    if (['cancelada', 'no_asistio'].includes(cita.estado)) {
      throw new ErrorApi(409, `No se puede registrar información clínica en una cita con estado "${cita.estado}".`);
    }
    if (!['en_curso', 'completada'].includes(cita.estado)) {
      throw new ErrorApi(409, `La cita está "${cita.estado}". Pásala a "En curso" para registrar el tratamiento.`);
    }
    requerido(d, ['nombre']);

    const cat = d.catalogo_id ? buscar('catalogo_tratamientos', d.catalogo_id) : null;
    const requiere = d.requiere_consentimiento !== undefined
      ? !!d.requiere_consentimiento : !!(cat && cat.requiere_consentimiento);
    const precio = d.precio !== undefined ? numero(d.precio) : numero(cat?.precio_base, 0);
    if (precio < 0) throw new ErrorApi(400, 'El precio no puede ser negativo.');

    const t = ahora();
    const fecha = texto(d.fecha) || cita.inicio.slice(0, 10);
    const tratamiento = insertar('tratamientos', {
      cita_id: cita.id, paciente_id: cita.paciente_id, doctor_id: cita.doctor_id,
      consultorio_id: cita.consultorio_id, cubiculo_id: cita.cubiculo_id,
      catalogo_id: cat?.id ?? null, nombre: texto(d.nombre),
      descripcion: texto(d.descripcion, cat?.descripcion ?? null), dientes: texto(d.dientes),
      notas_clinicas: texto(d.notas_clinicas), precio, requiere_consentimiento: requiere ? 1 : 0,
      fecha, creado_en: t,
    });

    if (precio > 0 && d.generar_cargo !== false) {
      insertar('cargos', {
        paciente_id: cita.paciente_id, consultorio_id: cita.consultorio_id, cita_id: cita.id,
        tratamiento_id: tratamiento.id, concepto: texto(d.nombre), monto: precio, fecha, creado_en: t,
      });
    }
    if (requiere) {
      crearConsentimientoInterno({
        paciente_id: cita.paciente_id, doctor_id: cita.doctor_id, consultorio_id: cita.consultorio_id,
        cita_id: cita.id, tratamiento_id: tratamiento.id, catalogo_id: cat?.id ?? null,
        tratamiento: texto(d.nombre), observaciones: texto(d.observaciones), creado_por: u.nombre,
      });
    }
    const dientes = texto(d.dientes);
    const estadoDiente = texto(d.estado_diente);
    if (dientes && estadoDiente) {
      for (const pieza of dientes.split(',').map((x) => x.trim()).filter(Boolean)) {
        let reg = tabla('odontograma').find((o) =>
          Number(o.paciente_id) === Number(cita.paciente_id) && o.diente === pieza && o.cara === 'general');
        if (reg) Object.assign(reg, { estado: estadoDiente, nota: texto(d.nombre), tratamiento_id: tratamiento.id, actualizado_en: t });
        else insertar('odontograma', {
          paciente_id: cita.paciente_id, diente: pieza, cara: 'general', estado: estadoDiente,
          nota: texto(d.nombre), tratamiento_id: tratamiento.id, actualizado_en: t,
        });
      }
    }
    guardar();
    return clonar(tratamiento);
  },
  async subirFoto(citaId, d) {
    exigirRol('admin', 'doctor', 'recepcion');
    const cita = buscar('citas', citaId);
    if (!cita) throw new ErrorApi(404, 'Cita no encontrada.');
    if (['cancelada', 'no_asistio'].includes(cita.estado)) {
      throw new ErrorApi(409, `No se puede registrar información clínica en una cita con estado "${cita.estado}".`);
    }
    requerido(d, ['nombre', 'datos']);
    const m = String(d.datos).match(/^data:(image\/(png|jpeg|webp|gif));base64,/);
    if (!m) throw new ErrorApi(400, 'Formato de imagen no soportado. Usa PNG, JPG, WEBP o GIF.');
    return clonar(insertar('fotos', {
      paciente_id: cita.paciente_id, cita_id: cita.id, tratamiento_id: d.tratamiento_id ?? null,
      tipo: texto(d.tipo, 'intraoral'), nombre: texto(d.nombre),
      archivo: d.datos, mime: m[1], descripcion: texto(d.descripcion), creada_en: ahora(),
    }));
  },
  async crearRecordatorio(citaId, d) {
    exigirRol('admin', 'doctor', 'recepcion');
    const cita = buscar('citas', citaId);
    if (!cita) throw new ErrorApi(404, 'Cita no encontrada.');
    requerido(d, ['titulo']);
    const t = ahora();
    return clonar(insertar('recordatorios', {
      paciente_id: cita.paciente_id, cita_id: cita.id, doctor_id: cita.doctor_id,
      titulo: texto(d.titulo), descripcion: texto(d.descripcion),
      fecha_objetivo: texto(d.fecha_objetivo), prioridad: texto(d.prioridad, 'media'),
      estado: 'pendiente', creado_en: t, actualizado_en: t,
    }));
  },
  async recordatorios(p = {}) {
    usuarioActual();
    let lista = tabla('recordatorios');
    for (const clave of ['paciente_id', 'cita_id', 'doctor_id', 'estado']) {
      if (p[clave]) lista = lista.filter((r) => String(r[clave]) === String(p[clave]));
    }
    return clonar(lista.map((r) => {
      const pac = buscar('pacientes', r.paciente_id) || {};
      return { ...r, paciente_nombre: pac.nombre, paciente_apellidos: pac.apellidos };
    }).sort((a, b) => a.estado.localeCompare(b.estado) ||
      (a.fecha_objetivo || '9999-12-31').localeCompare(b.fecha_objetivo || '9999-12-31')));
  },
  async actualizarRecordatorio(id, d) {
    exigirRol('admin', 'doctor', 'recepcion');
    const r = buscar('recordatorios', id);
    if (!r) throw new ErrorApi(404, 'Recordatorio no encontrado.');
    Object.assign(r, {
      titulo: texto(d.titulo, r.titulo), descripcion: texto(d.descripcion, r.descripcion),
      fecha_objetivo: texto(d.fecha_objetivo, r.fecha_objetivo),
      prioridad: texto(d.prioridad, r.prioridad), estado: texto(d.estado, r.estado),
      actualizado_en: ahora(),
    });
    guardar();
    return clonar(r);
  },

  /* ---------------------------- Consentimientos --------------------------- */
  async consentimientos(p = {}) {
    const u = usuarioActual();
    let lista = tabla('consentimientos');
    for (const clave of ['paciente_id', 'cita_id', 'tratamiento_id', 'estado']) {
      if (p[clave]) lista = lista.filter((c) => String(c[clave]) === String(p[clave]));
    }
    if (u.rol === 'doctor' && u.doctor_id) {
      lista = lista.filter((c) => Number(c.doctor_id) === Number(u.doctor_id));
    }
    return clonar(lista.map(consentimientoConCita)
      .sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || '')));
  },
  async consentimiento(id) {
    usuarioActual();
    const c = buscar('consentimientos', id);
    if (!c) throw new ErrorApi(404, 'Consentimiento no encontrado.');
    return clonar(consentimientoConCita(c));
  },
  async crearConsentimiento(d) {
    const u = exigirRol('admin', 'doctor', 'recepcion');
    requerido(d, ['paciente_id', 'doctor_id', 'tratamiento']);
    verificarDoctorPropio(u, d.doctor_id);
    let consultorioId = d.consultorio_id ? entero(d.consultorio_id) : null;
    const citaId = d.cita_id ? entero(d.cita_id) : null;
    if (citaId) {
      const cita = buscar('citas', citaId);
      if (!cita) throw new ErrorApi(404, 'Cita no encontrada.');
      consultorioId = consultorioId ?? cita.consultorio_id;
    }
    if (!consultorioId) {
      consultorioId = tabla('doctor_consultorio')
        .filter((x) => Number(x.doctor_id) === Number(d.doctor_id))
        .map((x) => x.consultorio_id).sort((a, b) => a - b)[0] ?? null;
    }
    return clonar(crearConsentimientoInterno({
      paciente_id: entero(d.paciente_id), doctor_id: entero(d.doctor_id),
      consultorio_id: consultorioId, cita_id: citaId,
      tratamiento_id: d.tratamiento_id ? entero(d.tratamiento_id) : null,
      catalogo_id: d.catalogo_id ? entero(d.catalogo_id) : null,
      tratamiento: d.tratamiento, observaciones: d.observaciones, creado_por: u.nombre,
    }));
  },
  async generarConsentimiento(tratamientoId, d = {}) {
    const u = exigirRol('admin', 'doctor');
    const t = buscar('tratamientos', tratamientoId);
    if (!t) throw new ErrorApi(404, 'Tratamiento no encontrado.');
    verificarDoctorPropio(u, t.doctor_id);
    const vigente = tabla('consentimientos')
      .filter((c) => Number(c.tratamiento_id) === Number(t.id) && c.estado !== 'anulado')
      .sort((a, b) => b.id - a.id)[0];
    if (vigente) return clonar(consentimientoConCita(vigente));
    return clonar(crearConsentimientoInterno({
      paciente_id: t.paciente_id, doctor_id: entero(d.doctor_id, t.doctor_id),
      consultorio_id: t.consultorio_id, cita_id: t.cita_id, tratamiento_id: t.id,
      catalogo_id: t.catalogo_id, tratamiento: texto(d.tratamiento, t.nombre),
      observaciones: d.observaciones, creado_por: u.nombre,
    }));
  },
  async actualizarConsentimiento(id, d) {
    const u = exigirRol('admin', 'doctor', 'recepcion');
    const c = buscar('consentimientos', id);
    if (!c) throw new ErrorApi(404, 'Consentimiento no encontrado.');
    if (c.estado === 'firmado') {
      throw new ErrorApi(409, 'Un consentimiento firmado es inmutable. Anúlalo y genera uno nuevo si necesitas cambiarlo.');
    }
    if (c.estado === 'anulado') throw new ErrorApi(409, 'Este consentimiento está anulado y no puede editarse.');
    const doctorId = d.doctor_id ? entero(d.doctor_id) : c.doctor_id;
    verificarDoctorPropio(u, doctorId);
    const doc = buscar('doctores', doctorId);
    if (!doc) throw new ErrorApi(404, 'Doctor no encontrado.');
    Object.assign(c, {
      tratamiento: texto(d.tratamiento, c.tratamiento),
      observaciones: texto(d.observaciones, c.observaciones),
      catalogo_id: d.catalogo_id !== undefined ? (d.catalogo_id ? entero(d.catalogo_id) : null) : c.catalogo_id,
      doctor_id: doc.id, doctor_nombre: doc.nombre, doctor_especialidad: doc.especialidad,
    });
    guardar();
    return clonar(consentimientoConCita(c));
  },
  async firmarConsentimiento(id, d) {
    exigirRol('admin', 'doctor', 'recepcion');
    const c = buscar('consentimientos', id);
    if (!c) throw new ErrorApi(404, 'Consentimiento no encontrado.');
    if (c.estado === 'firmado') throw new ErrorApi(409, 'Este consentimiento ya está firmado y es inmutable.');
    if (c.estado === 'anulado') throw new ErrorApi(409, 'Este consentimiento está anulado; genera uno nuevo.');

    const firmaPaciente = validarFirma(d.firma_paciente, 'del paciente');
    const firmaDoctor = validarFirma(d.firma_doctor, 'del doctor');

    let representante = { nombre: null, cedula: null, parentesco: null };
    let nombreFirmante = texto(d.firma_paciente_nombre, c.paciente_nombre);
    if (c.es_menor) {
      requerido(d, ['representante_nombre', 'representante_cedula', 'representante_parentesco']);
      representante = {
        nombre: texto(d.representante_nombre), cedula: texto(d.representante_cedula),
        parentesco: texto(d.representante_parentesco),
      };
      nombreFirmante = representante.nombre;
    }
    const t = ahora();
    Object.assign(c, {
      firma_paciente: firmaPaciente, firma_paciente_nombre: nombreFirmante, firma_paciente_en: t,
      firma_doctor: firmaDoctor, firma_doctor_en: t,
      representante_nombre: representante.nombre, representante_cedula: representante.cedula,
      representante_parentesco: representante.parentesco,
      estado: 'firmado', firmado_en: t,
    });
    guardar();
    return clonar(consentimientoConCita(c));
  },
  async anularConsentimiento(id, d) {
    const u = exigirRol('admin', 'doctor');
    const c = buscar('consentimientos', id);
    if (!c) throw new ErrorApi(404, 'Consentimiento no encontrado.');
    if (c.estado === 'anulado') throw new ErrorApi(409, 'Este consentimiento ya está anulado.');
    requerido(d, ['motivo']);
    Object.assign(c, {
      estado: 'anulado', anulado_en: ahora(), anulado_motivo: texto(d.motivo), anulado_por: u.nombre,
    });
    let reemplazo = null;
    if (d.crear_reemplazo) {
      reemplazo = crearConsentimientoInterno({
        paciente_id: c.paciente_id, doctor_id: c.doctor_id, consultorio_id: c.consultorio_id,
        cita_id: c.cita_id, tratamiento_id: c.tratamiento_id, catalogo_id: c.catalogo_id,
        tratamiento: texto(d.tratamiento, c.tratamiento),
        observaciones: texto(d.observaciones, c.observaciones),
        creado_por: u.nombre, reemplaza_a: c.id,
      });
      c.reemplazado_por = reemplazo.id;
    }
    guardar();
    return clonar({ anulado: consentimientoConCita(c), reemplazo });
  },

  /* ------------------------------ Contabilidad ---------------------------- */
  async cargos(p = {}) {
    usuarioActual();
    return clonar(cargosDe((c) =>
      (!p.paciente_id || Number(c.paciente_id) === Number(p.paciente_id)) &&
      (!p.consultorio_id || Number(c.consultorio_id) === Number(p.consultorio_id)) &&
      (!p.cita_id || Number(c.cita_id) === Number(p.cita_id)) &&
      (!p.tratamiento_id || Number(c.tratamiento_id) === Number(p.tratamiento_id))));
  },
  async crearCargo(d) {
    exigirRol('admin', 'recepcion', 'doctor');
    requerido(d, ['paciente_id', 'consultorio_id', 'concepto', 'monto']);
    const monto = numero(d.monto);
    if (monto <= 0) throw new ErrorApi(400, 'El monto del cargo debe ser mayor que cero.');
    return clonar(insertar('cargos', {
      paciente_id: entero(d.paciente_id), consultorio_id: entero(d.consultorio_id),
      cita_id: d.cita_id ?? null, tratamiento_id: d.tratamiento_id ?? null,
      concepto: texto(d.concepto), monto, fecha: texto(d.fecha) || hoyIso(), creado_en: ahora(),
    }));
  },
  async pagos(p = {}) {
    usuarioActual();
    let lista = tabla('pagos');
    for (const clave of ['paciente_id', 'consultorio_id', 'cargo_id']) {
      if (p[clave]) lista = lista.filter((x) => String(x[clave]) === String(p[clave]));
    }
    return clonar(lista.map((x) => {
      const pac = buscar('pacientes', x.paciente_id) || {};
      return { ...x, paciente_nombre: pac.nombre, paciente_apellidos: pac.apellidos };
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id));
  },
  async crearPago(d) {
    exigirRol('admin', 'recepcion');
    requerido(d, ['monto']);
    const monto = numero(d.monto);
    if (monto <= 0) throw new ErrorApi(400, 'El monto del pago debe ser mayor que cero.');
    let cargo = null;
    if (d.cargo_id) {
      cargo = buscar('cargos', d.cargo_id);
      if (!cargo) throw new ErrorApi(404, 'Cargo no encontrado.');
      const pagado = tabla('pagos').filter((p) => Number(p.cargo_id) === Number(cargo.id))
        .reduce((s, p) => s + p.monto, 0);
      const saldo = redondear(cargo.monto - pagado);
      if (monto > saldo + 0.001) {
        throw new ErrorApi(400,
          `El abono (${monto.toFixed(2)}) supera el saldo pendiente del cargo (${saldo.toFixed(2)}).`);
      }
    } else {
      requerido(d, ['paciente_id', 'consultorio_id']);
    }
    return clonar(insertar('pagos', {
      cargo_id: cargo?.id ?? null,
      paciente_id: cargo ? cargo.paciente_id : entero(d.paciente_id),
      consultorio_id: cargo ? cargo.consultorio_id : entero(d.consultorio_id),
      monto, metodo: texto(d.metodo, 'efectivo'), fecha: texto(d.fecha) || hoyIso(),
      nota: texto(d.nota), creado_en: ahora(),
    }));
  },
  async gastos(p = {}) {
    exigirRol('admin');
    let lista = tabla('gastos');
    if (p.consultorio_id) lista = lista.filter((g) => Number(g.consultorio_id) === Number(p.consultorio_id));
    return clonar(lista.map((g) => ({
      ...g, consultorio_nombre: buscar('consultorios', g.consultorio_id)?.nombre,
    })).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id));
  },
  async crearGasto(d) {
    exigirRol('admin');
    requerido(d, ['consultorio_id', 'concepto', 'monto']);
    const monto = numero(d.monto);
    if (monto <= 0) throw new ErrorApi(400, 'El monto del gasto debe ser mayor que cero.');
    return clonar(insertar('gastos', {
      consultorio_id: entero(d.consultorio_id), categoria: texto(d.categoria, 'insumos'),
      concepto: texto(d.concepto), proveedor: texto(d.proveedor), monto,
      fecha: texto(d.fecha) || hoyIso(), creado_en: ahora(),
    }));
  },
  async estadoCuenta(id) {
    usuarioActual();
    const p = buscar('pacientes', id);
    if (!p) throw new ErrorApi(404, 'Paciente no encontrado.');
    const cargos = cargosDe((c) => Number(c.paciente_id) === Number(id));
    const pagos = tabla('pagos').filter((x) => Number(x.paciente_id) === Number(id));
    const totalCargos = redondear(cargos.reduce((s, c) => s + c.monto, 0));
    const totalPagos = redondear(pagos.reduce((s, c) => s + c.monto, 0));
    return clonar({
      paciente: { id: p.id, nombre: p.nombre, apellidos: p.apellidos, cedula: p.cedula },
      cargos, pagos, total_cargos: totalCargos, total_pagos: totalPagos,
      saldo: redondear(totalCargos - totalPagos),
    });
  },
  async balance(p = {}) {
    exigirRol('admin');
    const cid = p.consultorio_id ? Number(p.consultorio_id) : null;
    const periodo = p.periodo || 'mes';
    const fecha = p.fecha || hoyIso();
    let desde = p.desde;
    let hasta = p.hasta;
    if (periodo === 'dia') { desde = fecha; hasta = fecha; }
    else if (periodo === 'mes') { desde = `${fecha.slice(0, 7)}-01`; hasta = `${fecha.slice(0, 7)}-31`; }

    const enSede = (x) => !cid || Number(x.consultorio_id) === cid;
    const enRango = (x) => x.fecha >= desde && x.fecha <= hasta;

    const pagos = tabla('pagos').filter((x) => enSede(x) && enRango(x));
    const gastos = tabla('gastos').filter((x) => enSede(x) && enRango(x));
    const cargos = tabla('cargos').filter((x) => enSede(x) && enRango(x));
    const suma = (l) => redondear(l.reduce((s, x) => s + x.monto, 0));

    const agrupar = (lista, clave) => {
      const m = new Map();
      for (const x of lista) {
        const k = clave(x);
        const prev = m.get(k) || { n: 0, total: 0 };
        m.set(k, { n: prev.n + 1, total: prev.total + x.monto });
      }
      return [...m.entries()].map(([k, v]) => ({ ...v, total: redondear(v.total), clave: k }))
        .sort((a, b) => b.total - a.total);
    };

    const doctorDePago = (pg) => {
      const cargo = pg.cargo_id ? buscar('cargos', pg.cargo_id) : null;
      const tr = cargo?.tratamiento_id ? buscar('tratamientos', cargo.tratamiento_id) : null;
      const cita = cargo?.cita_id ? buscar('citas', cargo.cita_id) : null;
      const doctorId = tr?.doctor_id ?? cita?.doctor_id ?? null;
      return buscar('doctores', doctorId)?.nombre || 'Sin asignar';
    };

    const produccion = tabla('tratamientos')
      .filter((t) => enSede(t) && t.fecha >= desde && t.fecha <= hasta)
      .reduce((m, t) => {
        const n = buscar('doctores', t.doctor_id)?.nombre || 'Sin asignar';
        const prev = m.get(n) || { n: 0, total: 0 };
        m.set(n, { n: prev.n + 1, total: prev.total + t.precio });
        return m;
      }, new Map());

    const totalCargosHist = suma(tabla('cargos').filter(enSede));
    const totalPagosHist = suma(tabla('pagos').filter(enSede));

    return clonar({
      periodo, desde, hasta, consultorio_id: cid,
      ingresos: suma(pagos), gastos: suma(gastos), facturado: suma(cargos),
      balance: redondear(suma(pagos) - suma(gastos)),
      por_cobrar_periodo: redondear(suma(cargos) - suma(pagos)),
      cuentas_por_cobrar_total: redondear(totalCargosHist - totalPagosHist),
      conteos: { pagos: pagos.length, gastos: gastos.length, cargos: cargos.length },
      gastos_por_categoria: agrupar(gastos, (g) => g.categoria).map((x) => ({ categoria: x.clave, total: x.total })),
      ingresos_por_metodo: agrupar(pagos, (x) => x.metodo).map((x) => ({ metodo: x.clave, total: x.total, n: x.n })),
      ingresos_por_doctor: agrupar(pagos, doctorDePago).map((x) => ({ doctor: x.clave, total: x.total, n: x.n })),
      produccion_por_doctor: [...produccion.entries()]
        .map(([doctor, v]) => ({ doctor, total: redondear(v.total), n: v.n }))
        .sort((a, b) => b.total - a.total),
      por_consultorio: tabla('consultorios').filter((c) => !cid || c.id === cid).map((c) => {
        const ing = suma(tabla('pagos').filter((x) => Number(x.consultorio_id) === c.id && enRango(x)));
        const gas = suma(tabla('gastos').filter((x) => Number(x.consultorio_id) === c.id && enRango(x)));
        const fac = suma(tabla('cargos').filter((x) => Number(x.consultorio_id) === c.id && enRango(x)));
        return {
          id: c.id, nombre: c.nombre, ingresos: ing, gastos: gas, facturado: fac,
          balance: redondear(ing - gas), por_cobrar: redondear(fac - ing),
        };
      }),
    });
  },
  /* --------------------------- Ajustes del consultorio -------------------- */
  async ajustes() {
    usuarioActual();
    const guardados = tabla('ajustes');
    const fila = guardados.find((a) => a.clave === 'recepcion_dinero');
    return { recepcion_dinero: (fila?.valor ?? '0') === '1' };
  },
  async guardarAjustes(d) {
    exigirRol('admin');
    for (const [clave, valor] of Object.entries(d || {})) {
      if (clave !== 'recepcion_dinero') throw new ErrorApi(400, `Ajuste desconocido: ${clave}.`);
      const fila = tabla('ajustes').find((a) => a.clave === clave);
      if (fila) fila.valor = valor ? '1' : '0';
      else insertar('ajustes', { clave, valor: valor ? '1' : '0' });
    }
    guardar();
    return this.ajustes();
  },

  async resumen() {
    usuarioActual();
    const fecha = hoyIso();
    const mes = fecha.slice(0, 7);
    const citasMes = tabla('citas').filter((c) => c.inicio.slice(0, 7) === mes);
    const porEstado = new Map();
    for (const c of citasMes) porEstado.set(c.estado, (porEstado.get(c.estado) || 0) + 1);
    return clonar({
      fecha,
      consultorios: tabla('consultorios').filter((c) => c.activo).length,
      cubiculos: tabla('cubiculos').filter((c) => c.activo).length,
      doctores: tabla('doctores').filter((d) => d.activo).length,
      pacientes: tabla('pacientes').length,
      citas_hoy: tabla('citas').filter((c) => c.inicio.slice(0, 10) === fecha).length,
      citas_mes: citasMes.length,
      citas_por_estado: [...porEstado.entries()].map(([estado, n]) => ({ estado, n }))
        .sort((a, b) => a.estado.localeCompare(b.estado)),
      recordatorios_pendientes: tabla('recordatorios').filter((r) => r.estado === 'pendiente').length,
      consentimientos_pendientes: tabla('consentimientos').filter((c) => c.estado === 'pendiente').length,
      ingresos_mes: redondear(tabla('pagos').filter((p) => p.fecha.slice(0, 7) === mes)
        .reduce((s, p) => s + p.monto, 0)),
      gastos_mes: redondear(tabla('gastos').filter((g) => g.fecha.slice(0, 7) === mes)
        .reduce((s, g) => s + g.monto, 0)),
    });
  },
};

function asignarDoctor(doctorId, consultorios, cubiculos) {
  bd.doctor_consultorio = tabla('doctor_consultorio').filter((x) => Number(x.doctor_id) !== Number(doctorId));
  bd.doctor_cubiculo = tabla('doctor_cubiculo').filter((x) => Number(x.doctor_id) !== Number(doctorId));
  for (const cid of consultorios || []) {
    if (!buscar('consultorios', cid)) throw new ErrorApi(404, `El consultorio ${cid} no existe.`);
    bd.doctor_consultorio.push({ doctor_id: doctorId, consultorio_id: entero(cid) });
  }
  for (const cuid of cubiculos || []) {
    const cu = buscar('cubiculos', cuid);
    if (!cu) throw new ErrorApi(404, `El cubículo ${cuid} no existe.`);
    bd.doctor_cubiculo.push({ doctor_id: doctorId, cubiculo_id: entero(cuid) });
    if (!bd.doctor_consultorio.some((x) =>
      Number(x.doctor_id) === Number(doctorId) && Number(x.consultorio_id) === Number(cu.consultorio_id))) {
      bd.doctor_consultorio.push({ doctor_id: doctorId, consultorio_id: cu.consultorio_id });
    }
  }
  guardar();
}

function fechaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

cargar();
