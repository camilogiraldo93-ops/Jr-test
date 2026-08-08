import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, post, put, patch, del, ErrorApp } from '../http.js';
import { todos, uno, correr, ahora, transaccion, DIR_UPLOADS } from '../db.js';
import { requerido, texto, entero, numero, booleano, soloFecha, verificarDoctorPropio } from '../util.js';
import { obtenerCita } from './citas.js';
import { crearConsentimiento } from './consentimientos.js';

/* ---------------------------- Tratamientos ---------------------------- */

function citaEditable(id) {
  const c = obtenerCita(id);
  if (!c) throw new ErrorApp(404, 'Cita no encontrada.');
  if (['cancelada', 'no_asistio'].includes(c.estado)) {
    throw new ErrorApp(409, `No se puede registrar información clínica en una cita con estado "${c.estado}".`);
  }
  return c;
}

/**
 * El registro clínico corresponde a la atención: exige que la cita esté en curso.
 * Se admite también sobre una cita ya completada para permitir cargar algo olvidado.
 */
function exigirEnAtencion(c) {
  if (!['en_curso', 'completada'].includes(c.estado)) {
    throw new ErrorApp(409,
      `La cita está "${c.estado}". Pásala a "En curso" para registrar el tratamiento.`);
  }
  return c;
}

get('/api/citas/:id/tratamientos', ({ params }) =>
  todos('SELECT * FROM tratamientos WHERE cita_id = ? ORDER BY id', [params.id]));

post('/api/citas/:id/tratamientos', { roles: ['admin', 'doctor'] }, ({ params, cuerpo, usuario }) => {
  // El permiso se comprueba antes que el estado: así el mensaje que recibe cada
  // usuario explica su propio impedimento y no el de otro.
  const cita = citaEditable(params.id);
  verificarDoctorPropio(usuario, cita.doctor_id);
  exigirEnAtencion(cita);
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
      crearConsentimiento({
        paciente_id: cita.paciente_id,
        doctor_id: cita.doctor_id,
        consultorio_id: cita.consultorio_id,
        cita_id: cita.id,
        tratamiento_id: ultimoId,
        catalogo_id: catalogo?.id ?? null,
        tratamiento: texto(cuerpo.nombre),
        observaciones: texto(cuerpo.observaciones),
        creado_por: usuario.nombre,
      });
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
  if (!m) throw new ErrorApp(400, 'Ese archivo no se pudo leer como imagen. Vuelve a elegirlo desde el botón de subir.');
  const mime = m[1];
  if (!MIMES[mime]) throw new ErrorApp(400,
    'Ese archivo no es una imagen. Sube una foto o una radiografía en PNG, JPG, WEBP o GIF.');
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) throw new ErrorApp(400, 'Esa imagen llegó vacía. Vuelve a intentarlo con otro archivo.');
  if (buffer.length > 12 * 1024 * 1024) throw new ErrorApp(413,
    'Esa imagen pesa más de 12 MB. Súbela más pequeña o sácala de nuevo con menos calidad.');
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
  if (!tipos.includes(tipo)) throw new ErrorApp(400, 'Elige de la lista qué clase de imagen es (radiografía, foto intraoral, foto extraoral, documento u otro).');
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
    throw new ErrorApp(400, 'Elige la urgencia de la lista: puede esperar, normal o urgente.');
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
    throw new ErrorApp(400, 'Elige de la lista cómo va: por hacer, hecha o ya no aplica.');
  }
  correr('UPDATE recordatorios SET titulo=?, descripcion=?, fecha_objetivo=?, prioridad=?, estado=?, actualizado_en=? WHERE id=?',
    [texto(cuerpo.titulo, r.titulo), texto(cuerpo.descripcion, r.descripcion),
     soloFecha(cuerpo.fecha_objetivo, r.fecha_objetivo), texto(cuerpo.prioridad, r.prioridad),
     estado, ahora(), params.id]);
  return uno('SELECT * FROM recordatorios WHERE id = ?', [params.id]);
});
