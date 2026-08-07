import { get, post, put, ErrorApp } from '../http.js';
import { todos, uno, correr, ahora } from '../db.js';
import { requerido, texto, soloFecha, redondear } from '../util.js';

const CAMPOS = ['nombre', 'apellidos', 'cedula', 'telefono', 'email', 'fecha_nacimiento', 'sexo',
  'direccion', 'ocupacion', 'contacto_emergencia', 'telefono_emergencia', 'alergias', 'medicamentos',
  'antecedentes_medicos', 'antecedentes_odontologicos', 'motivo_consulta', 'notas'];

/** Buscador por nombre, apellidos, cédula o teléfono. */
get('/api/pacientes', ({ consulta }) => {
  const q = texto(consulta.get('q'));
  if (!q) return todos('SELECT * FROM pacientes ORDER BY apellidos, nombre LIMIT 200');
  const like = `%${q.toLowerCase()}%`;
  return todos(
    `SELECT * FROM pacientes
     WHERE lower(nombre) LIKE ? OR lower(apellidos) LIKE ?
        OR lower(nombre || ' ' || apellidos) LIKE ?
        OR lower(ifnull(cedula,'')) LIKE ? OR ifnull(telefono,'') LIKE ?
     ORDER BY apellidos, nombre LIMIT 200`,
    [like, like, like, like, like]
  );
});

get('/api/pacientes/:id', ({ params }) => {
  const p = uno('SELECT * FROM pacientes WHERE id = ?', [params.id]);
  if (!p) throw new ErrorApp(404, 'Paciente no encontrado.');
  return p;
});

post('/api/pacientes', { roles: ['admin', 'recepcion', 'doctor'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['nombre', 'apellidos']);
  const cedula = texto(cuerpo.cedula);
  if (cedula && uno('SELECT id FROM pacientes WHERE cedula = ?', [cedula])) {
    throw new ErrorApp(409, `Ya existe un paciente con la cédula ${cedula}.`);
  }
  const t = ahora();
  const valores = CAMPOS.map((c) => (c === 'fecha_nacimiento' ? soloFecha(cuerpo[c]) : texto(cuerpo[c])));
  const { ultimoId } = correr(
    `INSERT INTO pacientes (${CAMPOS.join(',')}, creado_en, actualizado_en)
     VALUES (${CAMPOS.map(() => '?').join(',')},?,?)`, [...valores, t, t]
  );
  return uno('SELECT * FROM pacientes WHERE id = ?', [ultimoId]);
});

put('/api/pacientes/:id', { roles: ['admin', 'recepcion', 'doctor'] }, ({ params, cuerpo }) => {
  const p = uno('SELECT * FROM pacientes WHERE id = ?', [params.id]);
  if (!p) throw new ErrorApp(404, 'Paciente no encontrado.');
  const cedula = texto(cuerpo.cedula, p.cedula);
  if (cedula && cedula !== p.cedula && uno('SELECT id FROM pacientes WHERE cedula = ?', [cedula])) {
    throw new ErrorApp(409, `Ya existe otro paciente con la cédula ${cedula}.`);
  }
  const valores = CAMPOS.map((c) =>
    c === 'fecha_nacimiento' ? soloFecha(cuerpo[c], p[c]) : texto(cuerpo[c], p[c]));
  correr(`UPDATE pacientes SET ${CAMPOS.map((c) => `${c}=?`).join(',')}, actualizado_en=? WHERE id=?`,
    [...valores, ahora(), params.id]);
  return uno('SELECT * FROM pacientes WHERE id = ?', [params.id]);
});

/* ---------------------------- Odontograma ----------------------------- */

get('/api/pacientes/:id/odontograma', ({ params }) =>
  todos('SELECT * FROM odontograma WHERE paciente_id = ? ORDER BY diente', [params.id]));

post('/api/pacientes/:id/odontograma', { roles: ['admin', 'doctor'] }, ({ params, cuerpo }) => {
  if (!uno('SELECT id FROM pacientes WHERE id = ?', [params.id])) {
    throw new ErrorApp(404, 'Paciente no encontrado.');
  }
  requerido(cuerpo, ['diente', 'estado']);
  const estados = ['sano', 'caries', 'obturado', 'corona', 'ausente', 'endodoncia', 'implante', 'fractura', 'sellante'];
  const estado = texto(cuerpo.estado);
  if (!estados.includes(estado)) {
    throw new ErrorApp(400, `Estado de diente inválido. Opciones: ${estados.join(', ')}.`);
  }
  correr(
    `INSERT INTO odontograma (paciente_id, diente, cara, estado, nota, tratamiento_id, actualizado_en)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(paciente_id, diente, cara) DO UPDATE SET
       estado=excluded.estado, nota=excluded.nota,
       tratamiento_id=excluded.tratamiento_id, actualizado_en=excluded.actualizado_en`,
    [params.id, texto(cuerpo.diente), texto(cuerpo.cara, 'general'), estado,
     texto(cuerpo.nota), cuerpo.tratamiento_id ?? null, ahora()]
  );
  return uno('SELECT * FROM odontograma WHERE paciente_id = ? AND diente = ? AND cara = ?',
    [params.id, texto(cuerpo.diente), texto(cuerpo.cara, 'general')]);
});

/* ------------------------- Expediente completo ------------------------ */

get('/api/pacientes/:id/expediente', ({ params }) => {
  const p = uno('SELECT * FROM pacientes WHERE id = ?', [params.id]);
  if (!p) throw new ErrorApp(404, 'Paciente no encontrado.');
  const id = p.id;

  const citas = todos(
    `SELECT ci.*, d.nombre AS doctor_nombre, cu.nombre AS cubiculo_nombre, co.nombre AS consultorio_nombre
     FROM citas ci
     JOIN doctores d ON d.id = ci.doctor_id
     JOIN cubiculos cu ON cu.id = ci.cubiculo_id
     JOIN consultorios co ON co.id = ci.consultorio_id
     WHERE ci.paciente_id = ? ORDER BY ci.inicio DESC`, [id]);

  const tratamientos = todos(
    `SELECT t.*, d.nombre AS doctor_nombre, cu.nombre AS cubiculo_nombre, co.nombre AS consultorio_nombre
     FROM tratamientos t
     JOIN doctores d ON d.id = t.doctor_id
     JOIN cubiculos cu ON cu.id = t.cubiculo_id
     JOIN consultorios co ON co.id = t.consultorio_id
     WHERE t.paciente_id = ? ORDER BY t.fecha DESC, t.id DESC`, [id]);

  const fotos = todos('SELECT * FROM fotos WHERE paciente_id = ? ORDER BY creada_en DESC', [id]);
  const recordatorios = todos(
    "SELECT * FROM recordatorios WHERE paciente_id = ? ORDER BY estado, ifnull(fecha_objetivo, '9999-12-31') ASC", [id]);
  const consentimientos = todos(
    'SELECT * FROM consentimientos WHERE paciente_id = ? ORDER BY creado_en DESC', [id]);
  const odontograma = todos('SELECT * FROM odontograma WHERE paciente_id = ? ORDER BY diente', [id]);

  const cargos = todos('SELECT * FROM cargos WHERE paciente_id = ? ORDER BY fecha DESC, id DESC', [id]);
  const pagos = todos('SELECT * FROM pagos WHERE paciente_id = ? ORDER BY fecha DESC, id DESC', [id]);
  const totalCargos = redondear(cargos.reduce((s, c) => s + c.monto, 0));
  const totalPagos = redondear(pagos.reduce((s, c) => s + c.monto, 0));

  // Línea de tiempo cronológica unificada (citas + tratamientos + consentimientos + fotos)
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
      tipo: 'consentimiento', fecha: c.firmado_en || c.creado_en, titulo: `Consentimiento: ${c.titulo}`,
      detalle: c.estado === 'firmado' ? 'Firmado por el paciente' : 'Pendiente de firma',
      doctor: c.nombre_doctor, lugar: '', ref_id: c.id,
    })),
    ...fotos.map((f) => ({
      tipo: 'foto', fecha: f.creada_en, titulo: `Imagen: ${f.nombre}`,
      detalle: f.tipo, doctor: '', lugar: '', ref_id: f.id,
    })),
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  const proximaCita = todos(
    `SELECT ci.*, d.nombre AS doctor_nombre, cu.nombre AS cubiculo_nombre, co.nombre AS consultorio_nombre
     FROM citas ci
     JOIN doctores d ON d.id = ci.doctor_id
     JOIN cubiculos cu ON cu.id = ci.cubiculo_id
     JOIN consultorios co ON co.id = ci.consultorio_id
     WHERE ci.paciente_id = ? AND ci.estado IN ('agendada','confirmada') AND ci.inicio >= ?
     ORDER BY ci.inicio ASC LIMIT 1`, [id, new Date().toISOString().slice(0, 16)])[0] || null;

  return {
    paciente: p, citas, tratamientos, fotos, recordatorios, consentimientos, odontograma,
    cronologia, proxima_cita: proximaCita,
    estado_cuenta: {
      cargos, pagos,
      total_cargos: totalCargos,
      total_pagos: totalPagos,
      saldo: redondear(totalCargos - totalPagos),
    },
  };
});
