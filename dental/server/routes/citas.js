import { get, post, put, patch, del, ErrorApp, conEstado } from '../http.js';
import { todos, uno, correr, ahora } from '../db.js';
import { requerido, texto, entero, fechaHora, soloFecha } from '../util.js';
import { pendientesDeCita } from './consentimientos.js';

export const ESTADOS = ['agendada', 'confirmada', 'en_curso', 'completada', 'cancelada', 'no_asistio'];
// Los estados que liberan la agenda no bloquean el horario.
const ESTADOS_BLOQUEANTES = ['agendada', 'confirmada', 'en_curso', 'completada'];

const TRANSICIONES = {
  agendada: ['confirmada', 'en_curso', 'cancelada', 'no_asistio'],
  confirmada: ['en_curso', 'completada', 'cancelada', 'no_asistio'],
  en_curso: ['completada', 'cancelada'],
  completada: [],
  cancelada: ['agendada'],
  no_asistio: ['agendada'],
};

const SQL_CITA = `
  SELECT ci.*,
         p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos, p.telefono AS paciente_telefono,
         p.cedula AS paciente_cedula,
         d.nombre AS doctor_nombre, d.color AS doctor_color,
         cu.nombre AS cubiculo_nombre, co.nombre AS consultorio_nombre
  FROM citas ci
  JOIN pacientes p ON p.id = ci.paciente_id
  JOIN doctores d ON d.id = ci.doctor_id
  JOIN cubiculos cu ON cu.id = ci.cubiculo_id
  JOIN consultorios co ON co.id = ci.consultorio_id`;

export function obtenerCita(id) {
  return uno(`${SQL_CITA} WHERE ci.id = ?`, [id]);
}

/**
 * Detecta choques de horario para el cubículo y para el doctor.
 * Solapamiento real: inicio_existente < fin_nuevo AND fin_existente > inicio_nuevo.
 */
export function buscarConflictos({ cubiculo_id, doctor_id, inicio, fin, excluir_id = null }) {
  const filas = todos(
    `${SQL_CITA}
     WHERE ci.estado IN (${ESTADOS_BLOQUEANTES.map(() => '?').join(',')})
       AND (ci.cubiculo_id = ? OR ci.doctor_id = ?)
       AND ci.inicio < ? AND ci.fin > ?
       AND (? IS NULL OR ci.id != ?)
     ORDER BY ci.inicio`,
    [...ESTADOS_BLOQUEANTES, cubiculo_id, doctor_id, fin, inicio, excluir_id, excluir_id]
  );
  return filas.map((c) => ({
    cita_id: c.id,
    motivo: c.cubiculo_id === Number(cubiculo_id) && c.doctor_id === Number(doctor_id) ? 'cubiculo_y_doctor'
      : c.cubiculo_id === Number(cubiculo_id) ? 'cubiculo' : 'doctor',
    inicio: c.inicio,
    fin: c.fin,
    doctor: c.doctor_nombre,
    cubiculo: c.cubiculo_nombre,
    consultorio: c.consultorio_nombre,
    paciente: `${c.paciente_nombre} ${c.paciente_apellidos}`,
    estado: c.estado,
  }));
}

function explicarConflictos(conflictos) {
  return conflictos.map((c) => {
    const quien = c.motivo === 'cubiculo' ? `el cubículo "${c.cubiculo}"`
      : c.motivo === 'doctor' ? `el/la Dr(a). ${c.doctor}`
      : `el cubículo "${c.cubiculo}" y el/la Dr(a). ${c.doctor}`;
    const verbo = c.motivo === 'cubiculo_y_doctor' ? 'ya tienen' : 'ya tiene';
    return `Choque de horario: ${quien} ${verbo} la cita #${c.cita_id} de ${c.paciente} ` +
           `de ${c.inicio.slice(11)} a ${c.fin.slice(11)} el ${c.inicio.slice(0, 10)} (estado: ${c.estado}).`;
  }).join(' ');
}

function validarEstructura({ consultorio_id, cubiculo_id, doctor_id, paciente_id }) {
  if (!uno('SELECT id FROM consultorios WHERE id = ?', [consultorio_id])) {
    throw new ErrorApp(404, 'El consultorio indicado no existe.');
  }
  const cu = uno('SELECT * FROM cubiculos WHERE id = ?', [cubiculo_id]);
  if (!cu) throw new ErrorApp(404, 'El cubículo indicado no existe.');
  if (Number(cu.consultorio_id) !== Number(consultorio_id)) {
    throw new ErrorApp(400, `El cubículo "${cu.nombre}" no pertenece al consultorio seleccionado.`);
  }
  if (!uno('SELECT id FROM doctores WHERE id = ?', [doctor_id])) {
    throw new ErrorApp(404, 'El doctor indicado no existe.');
  }
  if (!uno('SELECT id FROM pacientes WHERE id = ?', [paciente_id])) {
    throw new ErrorApp(404, 'El paciente indicado no existe.');
  }
  const asignado = uno('SELECT 1 x FROM doctor_consultorio WHERE doctor_id = ? AND consultorio_id = ?',
    [doctor_id, consultorio_id]);
  if (!asignado) {
    throw new ErrorApp(400, 'El doctor no está asignado a ese consultorio. Asígnalo primero en Configuración.');
  }
}

/* ------------------------------- Listado ------------------------------ */

get('/api/citas', ({ consulta, usuario }) => {
  const filtros = [];
  const params = [];
  if (usuario.rol === 'doctor' && usuario.doctor_id) {
    filtros.push('ci.doctor_id = ?');
    params.push(usuario.doctor_id);
  }
  const map = {
    consultorio_id: 'ci.consultorio_id', cubiculo_id: 'ci.cubiculo_id',
    doctor_id: 'ci.doctor_id', paciente_id: 'ci.paciente_id', estado: 'ci.estado',
  };
  for (const [clave, col] of Object.entries(map)) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`${col} = ?`); params.push(v); }
  }
  const desde = consulta.get('desde');
  const hasta = consulta.get('hasta');
  if (desde) { filtros.push('ci.inicio >= ?'); params.push(`${soloFecha(desde)}T00:00`); }
  if (hasta) { filtros.push('ci.inicio <= ?'); params.push(`${soloFecha(hasta)}T23:59`); }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(`${SQL_CITA} ${where} ORDER BY ci.inicio`, params);
});

get('/api/citas/:id', ({ params, usuario }) => {
  const c = obtenerCita(params.id);
  if (!c) throw new ErrorApp(404, 'Cita no encontrada.');
  if (usuario.rol === 'doctor' && usuario.doctor_id && c.doctor_id !== usuario.doctor_id) {
    throw new ErrorApp(403, 'Esta cita pertenece a otro doctor.');
  }
  c.tratamientos = todos('SELECT * FROM tratamientos WHERE cita_id = ? ORDER BY id', [c.id]);
  c.fotos = todos('SELECT * FROM fotos WHERE cita_id = ? ORDER BY id', [c.id]);
  c.recordatorios = todos('SELECT * FROM recordatorios WHERE cita_id = ? ORDER BY id', [c.id]);
  c.consentimientos = todos('SELECT * FROM consentimientos WHERE cita_id = ? ORDER BY id', [c.id]);
  c.cargos = todos('SELECT * FROM cargos WHERE cita_id = ? ORDER BY id', [c.id]);
  c.cita_seguimiento = todos(`${SQL_CITA} WHERE ci.cita_origen_id = ? ORDER BY ci.inicio`, [c.id]);
  return c;
});

/* --------------------- Verificación previa de conflicto ---------------- */

post('/api/citas/verificar', ({ cuerpo }) => {
  requerido(cuerpo, ['cubiculo_id', 'doctor_id', 'inicio', 'fin']);
  const inicio = fechaHora(cuerpo.inicio, 'inicio');
  const fin = fechaHora(cuerpo.fin, 'fin');
  if (fin <= inicio) throw new ErrorApp(400, 'La hora de fin debe ser posterior a la hora de inicio.');
  const conflictos = buscarConflictos({
    cubiculo_id: entero(cuerpo.cubiculo_id), doctor_id: entero(cuerpo.doctor_id),
    inicio, fin, excluir_id: cuerpo.excluir_id ? entero(cuerpo.excluir_id) : null,
  });
  return conEstado(200, {
    disponible: conflictos.length === 0,
    conflictos,
    mensaje: conflictos.length ? explicarConflictos(conflictos) : 'Horario disponible.',
  });
});

/* ------------------------------- Crear -------------------------------- */

post('/api/citas', { roles: ['admin', 'recepcion', 'doctor'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['consultorio_id', 'cubiculo_id', 'doctor_id', 'paciente_id', 'inicio', 'fin']);
  const datos = {
    consultorio_id: entero(cuerpo.consultorio_id),
    cubiculo_id: entero(cuerpo.cubiculo_id),
    doctor_id: entero(cuerpo.doctor_id),
    paciente_id: entero(cuerpo.paciente_id),
  };
  validarEstructura(datos);

  const inicio = fechaHora(cuerpo.inicio, 'inicio');
  const fin = fechaHora(cuerpo.fin, 'fin');
  if (fin <= inicio) throw new ErrorApp(400, 'La hora de fin debe ser posterior a la hora de inicio.');

  const conflictos = buscarConflictos({ ...datos, inicio, fin });
  if (conflictos.length) {
    throw new ErrorApp(409, explicarConflictos(conflictos), { conflictos });
  }

  const estado = texto(cuerpo.estado, 'agendada');
  if (!ESTADOS.includes(estado)) throw new ErrorApp(400, `Estado inválido. Opciones: ${ESTADOS.join(', ')}.`);

  if (cuerpo.cita_origen_id && !uno('SELECT id FROM citas WHERE id = ?', [cuerpo.cita_origen_id])) {
    throw new ErrorApp(404, 'La cita de origen indicada no existe.');
  }

  const t = ahora();
  const { ultimoId } = correr(
    `INSERT INTO citas (consultorio_id, cubiculo_id, doctor_id, paciente_id, inicio, fin, motivo, notas, estado, cita_origen_id, creada_en, actualizada_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [datos.consultorio_id, datos.cubiculo_id, datos.doctor_id, datos.paciente_id, inicio, fin,
     texto(cuerpo.motivo), texto(cuerpo.notas), estado, cuerpo.cita_origen_id ?? null, t, t]
  );
  return obtenerCita(ultimoId);
});

/* ----------------------------- Reprogramar ---------------------------- */

put('/api/citas/:id', { roles: ['admin', 'recepcion', 'doctor'] }, ({ params, cuerpo }) => {
  const c = obtenerCita(params.id);
  if (!c) throw new ErrorApp(404, 'Cita no encontrada.');
  if (c.estado === 'completada') {
    throw new ErrorApp(409, 'No se puede reprogramar una cita ya completada.');
  }
  const datos = {
    consultorio_id: entero(cuerpo.consultorio_id, c.consultorio_id),
    cubiculo_id: entero(cuerpo.cubiculo_id, c.cubiculo_id),
    doctor_id: entero(cuerpo.doctor_id, c.doctor_id),
    paciente_id: entero(cuerpo.paciente_id, c.paciente_id),
  };
  validarEstructura(datos);
  const inicio = cuerpo.inicio ? fechaHora(cuerpo.inicio, 'inicio') : c.inicio;
  const fin = cuerpo.fin ? fechaHora(cuerpo.fin, 'fin') : c.fin;
  if (fin <= inicio) throw new ErrorApp(400, 'La hora de fin debe ser posterior a la hora de inicio.');

  const conflictos = buscarConflictos({ ...datos, inicio, fin, excluir_id: Number(params.id) });
  if (conflictos.length) throw new ErrorApp(409, explicarConflictos(conflictos), { conflictos });

  correr(
    `UPDATE citas SET consultorio_id=?, cubiculo_id=?, doctor_id=?, paciente_id=?, inicio=?, fin=?,
     motivo=?, notas=?, actualizada_en=? WHERE id=?`,
    [datos.consultorio_id, datos.cubiculo_id, datos.doctor_id, datos.paciente_id, inicio, fin,
     texto(cuerpo.motivo, c.motivo), texto(cuerpo.notas, c.notas), ahora(), params.id]
  );
  return obtenerCita(params.id);
});

/* --------------------------- Cambiar estado --------------------------- */

patch('/api/citas/:id/estado', { roles: ['admin', 'recepcion', 'doctor'] }, ({ params, cuerpo }) => {
  const c = obtenerCita(params.id);
  if (!c) throw new ErrorApp(404, 'Cita no encontrada.');
  requerido(cuerpo, ['estado']);
  const nuevo = texto(cuerpo.estado);
  if (!ESTADOS.includes(nuevo)) throw new ErrorApp(400, `Estado inválido. Opciones: ${ESTADOS.join(', ')}.`);
  if (nuevo === c.estado) return obtenerCita(params.id);
  if (!TRANSICIONES[c.estado].includes(nuevo)) {
    throw new ErrorApp(409,
      `No se permite pasar de "${c.estado}" a "${nuevo}". Transiciones válidas: ${TRANSICIONES[c.estado].join(', ') || 'ninguna'}.`);
  }
  // Una cita no se cierra si deja consentimientos requeridos sin firmar.
  if (nuevo === 'completada') {
    const pendientes = pendientesDeCita(c.id);
    if (pendientes.length) {
      throw new ErrorApp(409,
        `No se puede completar la cita: hay ${pendientes.length} consentimiento(s) informado(s) sin firmar ` +
        `(${pendientes.map((p) => p.tratamiento).join(', ')}). Fírmalos antes de cerrar la atención.`,
        { consentimientos_pendientes: pendientes.map((p) => ({ id: p.id, tratamiento: p.tratamiento })) });
    }
  }

  // Al reactivar una cita cancelada hay que revalidar el horario.
  if (['cancelada', 'no_asistio'].includes(c.estado)) {
    const conflictos = buscarConflictos({
      cubiculo_id: c.cubiculo_id, doctor_id: c.doctor_id, inicio: c.inicio, fin: c.fin, excluir_id: c.id,
    });
    if (conflictos.length) throw new ErrorApp(409, explicarConflictos(conflictos), { conflictos });
  }
  correr('UPDATE citas SET estado=?, actualizada_en=? WHERE id=?', [nuevo, ahora(), params.id]);
  return obtenerCita(params.id);
});

del('/api/citas/:id', { roles: ['admin'] }, ({ params }) => {
  if (!uno('SELECT id FROM citas WHERE id = ?', [params.id])) throw new ErrorApp(404, 'Cita no encontrada.');
  const t = uno('SELECT COUNT(*) n FROM tratamientos WHERE cita_id = ?', [params.id]);
  if (t.n > 0) throw new ErrorApp(409, 'No se puede eliminar: la cita tiene tratamientos registrados. Cancélala en su lugar.');
  correr('DELETE FROM citas WHERE id = ?', [params.id]);
  return { ok: true };
});

/* ---------------------------- Agenda / vistas -------------------------- */

get('/api/agenda', ({ consulta, usuario }) => {
  const vista = texto(consulta.get('vista'), 'dia');       // dia | semana
  const agrupar = texto(consulta.get('agrupar'), 'cubiculo'); // consultorio | cubiculo | doctor
  const fecha = soloFecha(consulta.get('fecha')) || new Date().toISOString().slice(0, 10);

  const base = new Date(`${fecha}T00:00:00`);
  let desde = fecha;
  let dias = 1;
  if (vista === 'semana') {
    const dow = (base.getDay() + 6) % 7; // lunes = 0
    const lunes = new Date(base);
    lunes.setDate(base.getDate() - dow);
    desde = lunes.toISOString().slice(0, 10);
    dias = 7;
  }
  const finDate = new Date(`${desde}T00:00:00`);
  finDate.setDate(finDate.getDate() + dias - 1);
  const hasta = finDate.toISOString().slice(0, 10);

  const filtros = [`ci.inicio >= ?`, `ci.inicio <= ?`];
  const params = [`${desde}T00:00`, `${hasta}T23:59`];
  for (const clave of ['consultorio_id', 'cubiculo_id', 'doctor_id']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`ci.${clave} = ?`); params.push(v); }
  }
  // Un doctor solo ve su propia agenda, sin importar los filtros que envíe.
  const soloSuyo = usuario.rol === 'doctor' && usuario.doctor_id;
  if (soloSuyo) { filtros.push('ci.doctor_id = ?'); params.push(usuario.doctor_id); }
  const citas = todos(`${SQL_CITA} WHERE ${filtros.join(' AND ')} ORDER BY ci.inicio`, params);

  let columnas = [];
  if (agrupar === 'cubiculo') {
    const cid = consulta.get('consultorio_id');
    columnas = todos(
      `SELECT cu.id, cu.nombre, co.nombre AS subtitulo FROM cubiculos cu
       JOIN consultorios co ON co.id = cu.consultorio_id
       ${cid ? 'WHERE cu.consultorio_id = ?' : ''} ORDER BY co.nombre, cu.nombre`, cid ? [cid] : []
    ).map((c) => ({ ...c, clave: 'cubiculo_id' }));
  } else if (agrupar === 'doctor') {
    columnas = todos(
      `SELECT id, nombre, especialidad AS subtitulo FROM doctores
       WHERE activo = 1 ${soloSuyo ? 'AND id = ?' : ''} ORDER BY nombre`, soloSuyo ? [usuario.doctor_id] : [])
      .map((c) => ({ ...c, clave: 'doctor_id' }));
  } else {
    columnas = todos('SELECT id, nombre, ciudad AS subtitulo FROM consultorios WHERE activo = 1 ORDER BY nombre')
      .map((c) => ({ ...c, clave: 'consultorio_id' }));
  }

  const listaDias = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(`${desde}T00:00:00`);
    d.setDate(d.getDate() + i);
    listaDias.push(d.toISOString().slice(0, 10));
  }

  return { vista, agrupar, desde, hasta, dias: listaDias, columnas, citas };
});
