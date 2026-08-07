import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, post, put, patch, del, ErrorApp } from '../http.js';
import { todos, uno, correr, ahora, transaccion, DIR_UPLOADS } from '../db.js';
import { requerido, texto, entero, numero, booleano, soloFecha, verificarDoctorPropio } from '../util.js';
import { obtenerCita } from './citas.js';

/* ---------------------------- Tratamientos ---------------------------- */

function citaEditable(id) {
  const c = obtenerCita(id);
  if (!c) throw new ErrorApp(404, 'Cita no encontrada.');
  if (['cancelada', 'no_asistio'].includes(c.estado)) {
    throw new ErrorApp(409, `No se puede registrar información clínica en una cita con estado "${c.estado}".`);
  }
  return c;
}

get('/api/citas/:id/tratamientos', ({ params }) =>
  todos('SELECT * FROM tratamientos WHERE cita_id = ? ORDER BY id', [params.id]));

post('/api/citas/:id/tratamientos', { roles: ['admin', 'doctor'] }, ({ params, cuerpo, usuario }) => {
  const cita = citaEditable(params.id);
  verificarDoctorPropio(usuario, cita.doctor_id);
  requerido(cuerpo, ['nombre']);

  const catalogo = cuerpo.catalogo_id ? uno('SELECT * FROM catalogo_tratamientos WHERE id = ?', [cuerpo.catalogo_id]) : null;
  const requiere = cuerpo.requiere_consentimiento !== undefined
    ? booleano(cuerpo.requiere_consentimiento)
    : !!(catalogo && catalogo.requiere_consentimiento);
  const precio = cuerpo.precio !== undefined ? numero(cuerpo.precio) : numero(catalogo?.precio_base, 0);
  if (precio < 0) throw new ErrorApp(400, 'El precio no puede ser negativo.');

  return transaccion(() => {
    const t = ahora();
    const { ultimoId } = correr(
      `INSERT INTO tratamientos (cita_id, paciente_id, doctor_id, consultorio_id, cubiculo_id, catalogo_id,
        nombre, descripcion, dientes, notas_clinicas, precio, requiere_consentimiento, fecha, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [cita.id, cita.paciente_id, cita.doctor_id, cita.consultorio_id, cita.cubiculo_id,
       catalogo?.id ?? null, texto(cuerpo.nombre), texto(cuerpo.descripcion, catalogo?.descripcion ?? null),
       texto(cuerpo.dientes), texto(cuerpo.notas_clinicas), precio, requiere ? 1 : 0,
       soloFecha(cuerpo.fecha) || cita.inicio.slice(0, 10), t]
    );

    // Genera automáticamente el cargo contable del tratamiento.
    if (precio > 0 && booleano(cuerpo.generar_cargo, true)) {
      correr(
        `INSERT INTO cargos (paciente_id, consultorio_id, cita_id, tratamiento_id, concepto, monto, fecha, creado_en)
         VALUES (?,?,?,?,?,?,?,?)`,
        [cita.paciente_id, cita.consultorio_id, cita.id, ultimoId, texto(cuerpo.nombre), precio,
         soloFecha(cuerpo.fecha) || cita.inicio.slice(0, 10), t]
      );
    }

    // Prepara el consentimiento informado si el tratamiento lo exige.
    if (requiere) {
      const doctor = uno('SELECT * FROM doctores WHERE id = ?', [cita.doctor_id]);
      const pac = uno('SELECT * FROM pacientes WHERE id = ?', [cita.paciente_id]);
      correr(
        `INSERT INTO consentimientos (tratamiento_id, cita_id, paciente_id, doctor_id, titulo, descripcion,
          riesgos, alternativas, nombre_paciente, nombre_doctor, estado, creado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'pendiente', ?)`,
        [ultimoId, cita.id, cita.paciente_id, cita.doctor_id, texto(cuerpo.nombre),
         texto(cuerpo.descripcion, catalogo?.descripcion) || `Tratamiento de ${texto(cuerpo.nombre)}.`,
         texto(cuerpo.riesgos, catalogo?.riesgos) || 'Riesgos generales del procedimiento odontológico: dolor o molestia postoperatoria, inflamación, sangrado, infección y reacción a la anestesia.',
         texto(cuerpo.alternativas, catalogo?.alternativas) || 'No realizar el tratamiento, tratamiento alternativo o derivación a especialista.',
         `${pac.nombre} ${pac.apellidos}`, doctor.nombre, t]
      );
    }

    // Actualiza el odontograma con los dientes tratados.
    const dientes = texto(cuerpo.dientes);
    const estadoDiente = texto(cuerpo.estado_diente);
    if (dientes && estadoDiente) {
      for (const d of dientes.split(',').map((x) => x.trim()).filter(Boolean)) {
        correr(
          `INSERT INTO odontograma (paciente_id, diente, cara, estado, nota, tratamiento_id, actualizado_en)
           VALUES (?,?,'general',?,?,?,?)
           ON CONFLICT(paciente_id, diente, cara) DO UPDATE SET
             estado=excluded.estado, nota=excluded.nota, tratamiento_id=excluded.tratamiento_id,
             actualizado_en=excluded.actualizado_en`,
          [cita.paciente_id, d, estadoDiente, texto(cuerpo.nombre), ultimoId, t]
        );
      }
    }

    return uno('SELECT * FROM tratamientos WHERE id = ?', [ultimoId]);
  });
});

get('/api/tratamientos/:id', ({ params }) => {
  const t = uno('SELECT * FROM tratamientos WHERE id = ?', [params.id]);
  if (!t) throw new ErrorApp(404, 'Tratamiento no encontrado.');
  t.consentimientos = todos('SELECT * FROM consentimientos WHERE tratamiento_id = ?', [t.id]);
  return t;
});

/* -------------------------------- Fotos -------------------------------- */

const MIMES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

function guardarArchivo(datos) {
  const m = String(datos).match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) throw new ErrorApp(400, 'La imagen debe enviarse como data URL base64 (data:image/...;base64,...).');
  const mime = m[1];
  if (!MIMES[mime]) throw new ErrorApp(400, `Formato de imagen no soportado: ${mime}. Usa PNG, JPG, WEBP o GIF.`);
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) throw new ErrorApp(400, 'La imagen está vacía.');
  if (buffer.length > 12 * 1024 * 1024) throw new ErrorApp(413, 'La imagen supera el límite de 12 MB.');
  const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${MIMES[mime]}`;
  fs.writeFileSync(path.join(DIR_UPLOADS, nombre), buffer);
  return { archivo: nombre, mime };
}

get('/api/citas/:id/fotos', ({ params }) =>
  todos('SELECT * FROM fotos WHERE cita_id = ? ORDER BY id', [params.id]));

post('/api/citas/:id/fotos', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo }) => {
  const cita = citaEditable(params.id);
  requerido(cuerpo, ['nombre', 'datos']);
  const tipos = ['radiografia', 'intraoral', 'extraoral', 'documento', 'otro'];
  const tipo = texto(cuerpo.tipo, 'intraoral');
  if (!tipos.includes(tipo)) throw new ErrorApp(400, `Tipo de imagen inválido. Opciones: ${tipos.join(', ')}.`);
  const { archivo, mime } = guardarArchivo(cuerpo.datos);
  const { ultimoId } = correr(
    `INSERT INTO fotos (paciente_id, cita_id, tratamiento_id, tipo, nombre, archivo, mime, descripcion, creada_en)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [cita.paciente_id, cita.id, cuerpo.tratamiento_id ?? null, tipo, texto(cuerpo.nombre),
     archivo, mime, texto(cuerpo.descripcion), ahora()]
  );
  return uno('SELECT * FROM fotos WHERE id = ?', [ultimoId]);
});

get('/api/pacientes/:id/fotos', ({ params }) =>
  todos('SELECT * FROM fotos WHERE paciente_id = ? ORDER BY creada_en DESC', [params.id]));

del('/api/fotos/:id', { roles: ['admin', 'doctor'] }, ({ params }) => {
  const f = uno('SELECT * FROM fotos WHERE id = ?', [params.id]);
  if (!f) throw new ErrorApp(404, 'Imagen no encontrada.');
  const ruta = path.join(DIR_UPLOADS, f.archivo);
  if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  correr('DELETE FROM fotos WHERE id = ?', [params.id]);
  return { ok: true };
});

/* ---------------------------- Recordatorios ---------------------------- */

get('/api/recordatorios', ({ consulta }) => {
  const filtros = [];
  const params = [];
  for (const clave of ['paciente_id', 'cita_id', 'doctor_id', 'estado']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`r.${clave} = ?`); params.push(v); }
  }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(
    `SELECT r.*, p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos
     FROM recordatorios r JOIN pacientes p ON p.id = r.paciente_id
     ${where} ORDER BY r.estado, ifnull(r.fecha_objetivo,'9999-12-31') ASC`, params);
});

post('/api/citas/:id/recordatorios', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo }) => {
  const cita = citaEditable(params.id);
  requerido(cuerpo, ['titulo']);
  const prioridad = texto(cuerpo.prioridad, 'media');
  if (!['baja', 'media', 'alta'].includes(prioridad)) {
    throw new ErrorApp(400, 'Prioridad inválida. Opciones: baja, media, alta.');
  }
  const t = ahora();
  const { ultimoId } = correr(
    `INSERT INTO recordatorios (paciente_id, cita_id, doctor_id, titulo, descripcion, fecha_objetivo, prioridad, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [cita.paciente_id, cita.id, cita.doctor_id, texto(cuerpo.titulo), texto(cuerpo.descripcion),
     soloFecha(cuerpo.fecha_objetivo), prioridad, t, t]
  );
  return uno('SELECT * FROM recordatorios WHERE id = ?', [ultimoId]);
});

patch('/api/recordatorios/:id', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo }) => {
  const r = uno('SELECT * FROM recordatorios WHERE id = ?', [params.id]);
  if (!r) throw new ErrorApp(404, 'Recordatorio no encontrado.');
  const estado = texto(cuerpo.estado, r.estado);
  if (!['pendiente', 'completado', 'cancelado'].includes(estado)) {
    throw new ErrorApp(400, 'Estado inválido. Opciones: pendiente, completado, cancelado.');
  }
  correr('UPDATE recordatorios SET titulo=?, descripcion=?, fecha_objetivo=?, prioridad=?, estado=?, actualizado_en=? WHERE id=?',
    [texto(cuerpo.titulo, r.titulo), texto(cuerpo.descripcion, r.descripcion),
     soloFecha(cuerpo.fecha_objetivo, r.fecha_objetivo), texto(cuerpo.prioridad, r.prioridad),
     estado, ahora(), params.id]);
  return uno('SELECT * FROM recordatorios WHERE id = ?', [params.id]);
});

/* -------------------------- Consentimientos ---------------------------- */

get('/api/consentimientos', ({ consulta }) => {
  const filtros = [];
  const params = [];
  for (const clave of ['paciente_id', 'cita_id', 'tratamiento_id', 'estado']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`${clave} = ?`); params.push(v); }
  }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(`SELECT * FROM consentimientos ${where} ORDER BY creado_en DESC`, params);
});

get('/api/consentimientos/:id', ({ params }) => {
  const c = uno('SELECT * FROM consentimientos WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  return c;
});

/** Genera un consentimiento informado para un tratamiento concreto. */
post('/api/tratamientos/:id/consentimiento', { roles: ['admin', 'doctor'] }, ({ params, cuerpo, usuario }) => {
  const t = uno('SELECT * FROM tratamientos WHERE id = ?', [params.id]);
  if (!t) throw new ErrorApp(404, 'Tratamiento no encontrado.');
  verificarDoctorPropio(usuario, t.doctor_id);
  const existente = uno("SELECT * FROM consentimientos WHERE tratamiento_id = ? AND estado != 'rechazado'", [t.id]);
  if (existente) return existente;
  const doctor = uno('SELECT * FROM doctores WHERE id = ?', [t.doctor_id]);
  const pac = uno('SELECT * FROM pacientes WHERE id = ?', [t.paciente_id]);
  const cat = t.catalogo_id ? uno('SELECT * FROM catalogo_tratamientos WHERE id = ?', [t.catalogo_id]) : null;
  const { ultimoId } = correr(
    `INSERT INTO consentimientos (tratamiento_id, cita_id, paciente_id, doctor_id, titulo, descripcion,
      riesgos, alternativas, nombre_paciente, nombre_doctor, estado, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'pendiente', ?)`,
    [t.id, t.cita_id, t.paciente_id, t.doctor_id, texto(cuerpo.titulo, t.nombre),
     texto(cuerpo.descripcion, t.descripcion) || `Tratamiento de ${t.nombre}.`,
     texto(cuerpo.riesgos, cat?.riesgos) || 'Riesgos generales del procedimiento odontológico: dolor o molestia postoperatoria, inflamación, sangrado, infección y reacción a la anestesia.',
     texto(cuerpo.alternativas, cat?.alternativas) || 'No realizar el tratamiento, tratamiento alternativo o derivación a especialista.',
     `${pac.nombre} ${pac.apellidos}`, doctor.nombre, ahora()]
  );
  return uno('SELECT * FROM consentimientos WHERE id = ?', [ultimoId]);
});

/** Firma del paciente: trazo digital en pantalla o aceptación explícita. */
post('/api/consentimientos/:id/firmar', { roles: ['admin', 'doctor', 'recepcion'] }, ({ params, cuerpo }) => {
  const c = uno('SELECT * FROM consentimientos WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  if (c.estado === 'firmado') throw new ErrorApp(409, 'Este consentimiento ya fue firmado y no puede modificarse.');
  requerido(cuerpo, ['firmante']);
  const tipo = texto(cuerpo.firma_tipo, 'trazo');
  if (!['trazo', 'aceptacion'].includes(tipo)) {
    throw new ErrorApp(400, 'Tipo de firma inválido. Opciones: trazo, aceptacion.');
  }
  if (tipo === 'trazo' && !texto(cuerpo.firma_data)) {
    throw new ErrorApp(400, 'Falta el trazo de la firma. Pide al paciente que firme en pantalla.');
  }
  if (tipo === 'aceptacion' && !booleano(cuerpo.acepta)) {
    throw new ErrorApp(400, 'El paciente debe marcar explícitamente la aceptación del consentimiento.');
  }
  correr(
    `UPDATE consentimientos SET estado='firmado', firma_tipo=?, firma_data=?, firmante=?, firmado_en=? WHERE id=?`,
    [tipo, texto(cuerpo.firma_data, 'ACEPTACION_EXPLICITA'), texto(cuerpo.firmante), ahora(), params.id]
  );
  return uno('SELECT * FROM consentimientos WHERE id = ?', [params.id]);
});

put('/api/consentimientos/:id', { roles: ['admin', 'doctor'] }, ({ params, cuerpo }) => {
  const c = uno('SELECT * FROM consentimientos WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Consentimiento no encontrado.');
  if (c.estado === 'firmado') throw new ErrorApp(409, 'No se puede editar un consentimiento ya firmado.');
  correr('UPDATE consentimientos SET titulo=?, descripcion=?, riesgos=?, alternativas=? WHERE id=?', [
    texto(cuerpo.titulo, c.titulo), texto(cuerpo.descripcion, c.descripcion),
    texto(cuerpo.riesgos, c.riesgos), texto(cuerpo.alternativas, c.alternativas), params.id,
  ]);
  return uno('SELECT * FROM consentimientos WHERE id = ?', [params.id]);
});
