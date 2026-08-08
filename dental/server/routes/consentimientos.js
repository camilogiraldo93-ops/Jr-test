import { get, post, put, ErrorApp, conEstado } from '../http.js';
import { todos, uno, correr, ahora, transaccion } from '../db.js';
import { requerido, texto, entero, soloFecha, verificarDoctorPropio, nombreCompleto } from '../util.js';

/** Edad cumplida a partir de la fecha de nacimiento. Devuelve null si no hay dato. */
export function edad(fechaNacimiento) {
  const f = soloFecha(fechaNacimiento);
  if (!f) return null;
  const n = new Date(`${f}T12:00:00`);
  if (Number.isNaN(n.getTime())) return null;
  const hoy = new Date();
  let a = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) a--;
  return a;
}

function marcaFechaHora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

const SQL_LISTA = `
  SELECT c.*, ci.inicio AS cita_inicio, ci.motivo AS cita_motivo
  FROM consentimientos c
  LEFT JOIN citas ci ON ci.id = c.cita_id`;

export function obtener(id) {
  return uno(`${SQL_LISTA} WHERE c.id = ?`, [id]);
}

/**
 * Crea un consentimiento en estado pendiente tomando una instantánea de los datos
 * del paciente, del doctor y del consultorio en el momento de generarlo.
 */
export function crearConsentimiento({
  paciente_id, doctor_id, consultorio_id = null, cita_id = null,
  tratamiento_id = null, catalogo_id = null, tratamiento, observaciones = null,
  creado_por = null, reemplaza_a = null,
}) {
  const pac = uno('SELECT * FROM pacientes WHERE id = ?', [paciente_id]);
  if (!pac) throw new ErrorApp(404, 'Paciente no encontrado.');
  const doc = uno('SELECT * FROM doctores WHERE id = ?', [doctor_id]);
  if (!doc) throw new ErrorApp(404, 'Doctor no encontrado.');
  const con = consultorio_id ? uno('SELECT * FROM consultorios WHERE id = ?', [consultorio_id]) : null;
  if (consultorio_id && !con) throw new ErrorApp(404, 'Consultorio no encontrado.');

  const a = edad(pac.fecha_nacimiento);
  const { fecha, hora } = marcaFechaHora();

  const { ultimoId } = correr(
    `INSERT INTO consentimientos (
       paciente_id, doctor_id, consultorio_id, cita_id, tratamiento_id, catalogo_id,
       tratamiento, observaciones,
       paciente_nombre, paciente_cedula, paciente_fecha_nacimiento, es_menor,
       doctor_nombre, doctor_especialidad,
       consultorio_nombre, consultorio_direccion, consultorio_telefono, consultorio_ciudad,
       fecha, hora, estado, reemplaza_a, creado_por, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pendiente', ?,?,?)`,
    [paciente_id, doctor_id, consultorio_id, cita_id, tratamiento_id, catalogo_id,
     texto(tratamiento), texto(observaciones),
     nombreCompleto(pac.nombre, pac.apellidos), pac.cedula, pac.fecha_nacimiento, a !== null && a < 18 ? 1 : 0,
     doc.nombre, doc.especialidad,
     con?.nombre ?? null, con?.direccion ?? null, con?.telefono ?? null, con?.ciudad ?? null,
     fecha, hora, reemplaza_a, creado_por, ahora()]
  );
  return obtener(ultimoId);
}

/* -------------------------------- Lectura ------------------------------- */

get('/api/consentimientos', ({ consulta, usuario }) => {
  const filtros = [];
  const params = [];
  for (const clave of ['paciente_id', 'cita_id', 'tratamiento_id', 'estado']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`c.${clave} = ?`); params.push(v); }
  }
  // El doctor solo ve los consentimientos que él firma o firmó.
  if (usuario.rol === 'doctor' && usuario.doctor_id) {
    filtros.push('c.doctor_id = ?');
    params.push(usuario.doctor_id);
  }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(`${SQL_LISTA} ${where} ORDER BY c.creado_en DESC`, params);
});

get('/api/consentimientos/:id', ({ params }) => {
  const c = obtener(params.id);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  return c;
});

/* -------------------------------- Creación ------------------------------ */

post('/api/consentimientos', { roles: ['admin', 'doctor', 'recepcion'] }, ({ cuerpo, usuario }) => {
  requerido(cuerpo, ['paciente_id', 'doctor_id', 'tratamiento']);
  verificarDoctorPropio(usuario, cuerpo.doctor_id);

  let consultorioId = cuerpo.consultorio_id ? entero(cuerpo.consultorio_id) : null;
  let citaId = cuerpo.cita_id ? entero(cuerpo.cita_id) : null;
  if (citaId) {
    const cita = uno('SELECT * FROM citas WHERE id = ?', [citaId]);
    if (!cita) throw new ErrorApp(404, 'Cita no encontrada.');
    consultorioId = consultorioId ?? cita.consultorio_id;
  }
  if (!consultorioId) {
    // Sin cita de referencia se usa el consultorio donde atiende el doctor.
    const asignado = uno(
      'SELECT consultorio_id FROM doctor_consultorio WHERE doctor_id = ? ORDER BY consultorio_id LIMIT 1',
      [cuerpo.doctor_id]);
    consultorioId = asignado?.consultorio_id ?? null;
  }

  return crearConsentimiento({
    paciente_id: entero(cuerpo.paciente_id),
    doctor_id: entero(cuerpo.doctor_id),
    consultorio_id: consultorioId,
    cita_id: citaId,
    tratamiento_id: cuerpo.tratamiento_id ? entero(cuerpo.tratamiento_id) : null,
    catalogo_id: cuerpo.catalogo_id ? entero(cuerpo.catalogo_id) : null,
    tratamiento: cuerpo.tratamiento,
    observaciones: cuerpo.observaciones,
    creado_por: usuario.nombre,
  });
});

/** Genera (o reutiliza) el consentimiento de un tratamiento ya registrado. */
post('/api/tratamientos/:id/consentimiento', { roles: ['admin', 'doctor'] }, ({ params, cuerpo, usuario }) => {
  const t = uno('SELECT * FROM tratamientos WHERE id = ?', [params.id]);
  if (!t) throw new ErrorApp(404, 'Tratamiento no encontrado.');
  verificarDoctorPropio(usuario, t.doctor_id);
  const vigente = uno(
    "SELECT id FROM consentimientos WHERE tratamiento_id = ? AND estado != 'anulado' ORDER BY id DESC LIMIT 1",
    [t.id]);
  if (vigente) return conEstado(200, obtener(vigente.id));
  return crearConsentimiento({
    paciente_id: t.paciente_id,
    doctor_id: entero(cuerpo.doctor_id, t.doctor_id),
    consultorio_id: t.consultorio_id,
    cita_id: t.cita_id,
    tratamiento_id: t.id,
    catalogo_id: t.catalogo_id,
    tratamiento: texto(cuerpo.tratamiento, t.nombre),
    observaciones: cuerpo.observaciones,
    creado_por: usuario.nombre,
  });
});

/* -------------------------------- Edición ------------------------------- */

/** Solo se pueden editar los tres campos manuales, y solo mientras esté pendiente. */
put('/api/consentimientos/:id', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo, usuario }) => {
  const c = obtener(params.id);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  if (c.estado === 'firmado') {
    throw new ErrorApp(409, 'Un consentimiento firmado es inmutable. Anúlalo y genera uno nuevo si necesitas cambiarlo.');
  }
  if (c.estado === 'anulado') throw new ErrorApp(409, 'Este consentimiento está anulado y no puede editarse.');

  const doctorId = cuerpo.doctor_id ? entero(cuerpo.doctor_id) : c.doctor_id;
  verificarDoctorPropio(usuario, doctorId);
  const doc = uno('SELECT * FROM doctores WHERE id = ?', [doctorId]);
  if (!doc) throw new ErrorApp(404, 'Doctor no encontrado.');

  correr(
    `UPDATE consentimientos SET tratamiento = ?, observaciones = ?, catalogo_id = ?,
       doctor_id = ?, doctor_nombre = ?, doctor_especialidad = ? WHERE id = ?`,
    [texto(cuerpo.tratamiento, c.tratamiento), texto(cuerpo.observaciones, c.observaciones),
     cuerpo.catalogo_id !== undefined ? (cuerpo.catalogo_id ? entero(cuerpo.catalogo_id) : null) : c.catalogo_id,
     doc.id, doc.nombre, doc.especialidad, params.id]
  );
  return obtener(params.id);
});

/* --------------------------------- Firma -------------------------------- */

function validarFirma(valor, quien) {
  const s = texto(valor);
  if (!s) throw new ErrorApp(400, `Falta la firma ${quien}. Debe trazarse en pantalla.`);
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(s)) {
    throw new ErrorApp(400, `La firma ${quien} no tiene un formato de imagen válido.`);
  }
  if (s.length > 4 * 1024 * 1024) throw new ErrorApp(413, `La firma ${quien} es demasiado grande.`);
  return s;
}

post('/api/consentimientos/:id/firmar', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo }) => {
  const c = obtener(params.id);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  if (c.estado === 'firmado') throw new ErrorApp(409, 'Este consentimiento ya está firmado y no se puede cambiar. Si hay que corregir algo, anúlalo y haz uno nuevo.');
  if (c.estado === 'anulado') throw new ErrorApp(409, 'Este consentimiento está anulado; genera uno nuevo.');

  const firmaPaciente = validarFirma(cuerpo.firma_paciente, 'del paciente');
  const firmaDoctor = validarFirma(cuerpo.firma_doctor, 'del doctor');

  let representante = { nombre: null, cedula: null, parentesco: null };
  let nombreFirmante = texto(cuerpo.firma_paciente_nombre, c.paciente_nombre);

  if (c.es_menor) {
    requerido(cuerpo, ['representante_nombre', 'representante_cedula', 'representante_parentesco']);
    representante = {
      nombre: texto(cuerpo.representante_nombre),
      cedula: texto(cuerpo.representante_cedula),
      parentesco: texto(cuerpo.representante_parentesco),
    };
    nombreFirmante = representante.nombre;
  }

  const t = ahora();
  correr(
    `UPDATE consentimientos SET
       firma_paciente = ?, firma_paciente_nombre = ?, firma_paciente_en = ?,
       firma_doctor = ?, firma_doctor_en = ?,
       representante_nombre = ?, representante_cedula = ?, representante_parentesco = ?,
       estado = 'firmado', firmado_en = ?
     WHERE id = ?`,
    [firmaPaciente, nombreFirmante, t, firmaDoctor, t,
     representante.nombre, representante.cedula, representante.parentesco, t, params.id]
  );
  return conEstado(200, obtener(params.id));
});

/* -------------------------------- Anulación ----------------------------- */

post('/api/consentimientos/:id/anular', { roles: ['admin', 'doctor'] }, ({ params, cuerpo, usuario }) => {
  const c = obtener(params.id);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  if (c.estado === 'anulado') throw new ErrorApp(409, 'Este consentimiento ya está anulado.');
  requerido(cuerpo, ['motivo']);

  return transaccion(() => {
    correr(
      `UPDATE consentimientos SET estado = 'anulado', anulado_en = ?, anulado_motivo = ?, anulado_por = ?
       WHERE id = ?`, [ahora(), texto(cuerpo.motivo), usuario.nombre, params.id]);

    let reemplazo = null;
    if (cuerpo.crear_reemplazo) {
      reemplazo = crearConsentimiento({
        paciente_id: c.paciente_id,
        doctor_id: c.doctor_id,
        consultorio_id: c.consultorio_id,
        cita_id: c.cita_id,
        tratamiento_id: c.tratamiento_id,
        catalogo_id: c.catalogo_id,
        tratamiento: texto(cuerpo.tratamiento, c.tratamiento),
        observaciones: texto(cuerpo.observaciones, c.observaciones),
        creado_por: usuario.nombre,
        reemplaza_a: c.id,
      });
      correr('UPDATE consentimientos SET reemplazado_por = ? WHERE id = ?', [reemplazo.id, c.id]);
    }
    return conEstado(200, { anulado: obtener(params.id), reemplazo });
  });
});

/** Consentimientos requeridos y aún sin firmar de una cita. */
export function pendientesDeCita(citaId) {
  return todos(
    "SELECT * FROM consentimientos WHERE cita_id = ? AND estado = 'pendiente' ORDER BY id", [citaId]);
}
