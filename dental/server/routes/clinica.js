import { get, post, put, del, ErrorApp } from '../http.js';
import { todos, uno, correr, ahora, transaccion } from '../db.js';
import { requerido, texto, booleano, entero } from '../util.js';

/* ---------------------------- Consultorios ---------------------------- */

get('/api/consultorios', () => {
  const lista = todos('SELECT * FROM consultorios ORDER BY nombre');
  return lista.map((c) => ({
    ...c,
    cubiculos: todos('SELECT * FROM cubiculos WHERE consultorio_id = ? ORDER BY nombre', [c.id]),
    doctores: todos(
      `SELECT d.* FROM doctores d
       JOIN doctor_consultorio dc ON dc.doctor_id = d.id
       WHERE dc.consultorio_id = ? ORDER BY d.nombre`, [c.id]),
  }));
});

get('/api/consultorios/:id', ({ params }) => {
  const c = uno('SELECT * FROM consultorios WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Consultorio no encontrado.');
  c.cubiculos = todos('SELECT * FROM cubiculos WHERE consultorio_id = ? ORDER BY nombre', [c.id]);
  return c;
});

post('/api/consultorios', { roles: ['admin'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['nombre']);
  const { ultimoId } = correr(
    'INSERT INTO consultorios (nombre, direccion, telefono, ciudad, creado_en) VALUES (?,?,?,?,?)',
    [texto(cuerpo.nombre), texto(cuerpo.direccion), texto(cuerpo.telefono), texto(cuerpo.ciudad), ahora()]
  );
  return uno('SELECT * FROM consultorios WHERE id = ?', [ultimoId]);
});

put('/api/consultorios/:id', { roles: ['admin'] }, ({ params, cuerpo }) => {
  const c = uno('SELECT * FROM consultorios WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Consultorio no encontrado.');
  correr('UPDATE consultorios SET nombre=?, direccion=?, telefono=?, ciudad=?, activo=? WHERE id=?', [
    texto(cuerpo.nombre, c.nombre), texto(cuerpo.direccion, c.direccion),
    texto(cuerpo.telefono, c.telefono), texto(cuerpo.ciudad, c.ciudad),
    booleano(cuerpo.activo, !!c.activo) ? 1 : 0, params.id,
  ]);
  return uno('SELECT * FROM consultorios WHERE id = ?', [params.id]);
});

del('/api/consultorios/:id', { roles: ['admin'] }, ({ params }) => {
  const usos = uno('SELECT COUNT(*) n FROM citas WHERE consultorio_id = ?', [params.id]);
  if (usos.n > 0) throw new ErrorApp(409, 'No se puede eliminar: el consultorio tiene citas registradas.');
  correr('DELETE FROM consultorios WHERE id = ?', [params.id]);
  return { ok: true };
});

/* ------------------------------ Cubículos ----------------------------- */

get('/api/cubiculos', ({ consulta }) => {
  const cid = consulta.get('consultorio_id');
  return cid
    ? todos('SELECT * FROM cubiculos WHERE consultorio_id = ? ORDER BY nombre', [cid])
    : todos(`SELECT cu.*, co.nombre AS consultorio_nombre FROM cubiculos cu
             JOIN consultorios co ON co.id = cu.consultorio_id ORDER BY co.nombre, cu.nombre`);
});

post('/api/cubiculos', { roles: ['admin'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['consultorio_id', 'nombre']);
  if (!uno('SELECT id FROM consultorios WHERE id = ?', [cuerpo.consultorio_id])) {
    throw new ErrorApp(404, 'El consultorio indicado no existe.');
  }
  const { ultimoId } = correr(
    'INSERT INTO cubiculos (consultorio_id, nombre, descripcion, creado_en) VALUES (?,?,?,?)',
    [entero(cuerpo.consultorio_id), texto(cuerpo.nombre), texto(cuerpo.descripcion), ahora()]
  );
  return uno('SELECT * FROM cubiculos WHERE id = ?', [ultimoId]);
});

put('/api/cubiculos/:id', { roles: ['admin'] }, ({ params, cuerpo }) => {
  const c = uno('SELECT * FROM cubiculos WHERE id = ?', [params.id]);
  if (!c) throw new ErrorApp(404, 'Cubículo no encontrado.');
  correr('UPDATE cubiculos SET nombre=?, descripcion=?, activo=? WHERE id=?', [
    texto(cuerpo.nombre, c.nombre), texto(cuerpo.descripcion, c.descripcion),
    booleano(cuerpo.activo, !!c.activo) ? 1 : 0, params.id,
  ]);
  return uno('SELECT * FROM cubiculos WHERE id = ?', [params.id]);
});

del('/api/cubiculos/:id', { roles: ['admin'] }, ({ params }) => {
  const usos = uno('SELECT COUNT(*) n FROM citas WHERE cubiculo_id = ?', [params.id]);
  if (usos.n > 0) throw new ErrorApp(409, 'No se puede eliminar: el cubículo tiene citas registradas.');
  correr('DELETE FROM cubiculos WHERE id = ?', [params.id]);
  return { ok: true };
});

/* ------------------------------- Doctores ----------------------------- */

function armarDoctor(d) {
  return {
    ...d,
    consultorios: todos(
      `SELECT c.id, c.nombre FROM consultorios c
       JOIN doctor_consultorio dc ON dc.consultorio_id = c.id
       WHERE dc.doctor_id = ? ORDER BY c.nombre`, [d.id]),
    cubiculos: todos(
      `SELECT cu.id, cu.nombre, cu.consultorio_id FROM cubiculos cu
       JOIN doctor_cubiculo dcu ON dcu.cubiculo_id = cu.id
       WHERE dcu.doctor_id = ? ORDER BY cu.nombre`, [d.id]),
  };
}

get('/api/doctores', () => todos('SELECT * FROM doctores ORDER BY nombre').map(armarDoctor));

get('/api/doctores/:id', ({ params }) => {
  const d = uno('SELECT * FROM doctores WHERE id = ?', [params.id]);
  if (!d) throw new ErrorApp(404, 'Doctor no encontrado.');
  return armarDoctor(d);
});

function asignar(doctorId, consultorios, cubiculos) {
  correr('DELETE FROM doctor_consultorio WHERE doctor_id = ?', [doctorId]);
  correr('DELETE FROM doctor_cubiculo WHERE doctor_id = ?', [doctorId]);
  for (const cid of consultorios || []) {
    if (!uno('SELECT id FROM consultorios WHERE id = ?', [cid])) {
      throw new ErrorApp(404, `El consultorio ${cid} no existe.`);
    }
    correr('INSERT OR IGNORE INTO doctor_consultorio (doctor_id, consultorio_id) VALUES (?,?)', [doctorId, cid]);
  }
  for (const cuid of cubiculos || []) {
    const cu = uno('SELECT * FROM cubiculos WHERE id = ?', [cuid]);
    if (!cu) throw new ErrorApp(404, `El cubículo ${cuid} no existe.`);
    correr('INSERT OR IGNORE INTO doctor_cubiculo (doctor_id, cubiculo_id) VALUES (?,?)', [doctorId, cuid]);
    correr('INSERT OR IGNORE INTO doctor_consultorio (doctor_id, consultorio_id) VALUES (?,?)',
      [doctorId, cu.consultorio_id]);
  }
}

post('/api/doctores', { roles: ['admin'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['nombre']);
  if (cuerpo.cedula && uno('SELECT id FROM doctores WHERE cedula = ?', [texto(cuerpo.cedula)])) {
    throw new ErrorApp(409, 'Ya existe un doctor con esa cédula.');
  }
  return transaccion(() => {
    const { ultimoId } = correr(
      'INSERT INTO doctores (nombre, cedula, especialidad, telefono, email, color, creado_en) VALUES (?,?,?,?,?,?,?)',
      [texto(cuerpo.nombre), texto(cuerpo.cedula), texto(cuerpo.especialidad),
       texto(cuerpo.telefono), texto(cuerpo.email), texto(cuerpo.color, '#0ea5e9'), ahora()]
    );
    asignar(ultimoId, cuerpo.consultorios, cuerpo.cubiculos);
    return armarDoctor(uno('SELECT * FROM doctores WHERE id = ?', [ultimoId]));
  });
});

put('/api/doctores/:id', { roles: ['admin'] }, ({ params, cuerpo }) => {
  const d = uno('SELECT * FROM doctores WHERE id = ?', [params.id]);
  if (!d) throw new ErrorApp(404, 'Doctor no encontrado.');
  return transaccion(() => {
    correr('UPDATE doctores SET nombre=?, cedula=?, especialidad=?, telefono=?, email=?, color=?, activo=? WHERE id=?', [
      texto(cuerpo.nombre, d.nombre), texto(cuerpo.cedula, d.cedula), texto(cuerpo.especialidad, d.especialidad),
      texto(cuerpo.telefono, d.telefono), texto(cuerpo.email, d.email), texto(cuerpo.color, d.color),
      booleano(cuerpo.activo, !!d.activo) ? 1 : 0, params.id,
    ]);
    if (cuerpo.consultorios || cuerpo.cubiculos) asignar(Number(params.id), cuerpo.consultorios, cuerpo.cubiculos);
    return armarDoctor(uno('SELECT * FROM doctores WHERE id = ?', [params.id]));
  });
});

/* ------------------------ Catálogo de tratamientos -------------------- */

get('/api/catalogo', () => todos('SELECT * FROM catalogo_tratamientos WHERE activo = 1 ORDER BY nombre'));

post('/api/catalogo', { roles: ['admin'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['nombre']);
  const { ultimoId } = correr(
    `INSERT INTO catalogo_tratamientos (nombre, descripcion, precio_base, duracion_min, requiere_consentimiento, riesgos, alternativas)
     VALUES (?,?,?,?,?,?,?)`,
    [texto(cuerpo.nombre), texto(cuerpo.descripcion), Number(cuerpo.precio_base) || 0,
     entero(cuerpo.duracion_min, 30), booleano(cuerpo.requiere_consentimiento) ? 1 : 0,
     texto(cuerpo.riesgos), texto(cuerpo.alternativas)]
  );
  return uno('SELECT * FROM catalogo_tratamientos WHERE id = ?', [ultimoId]);
});
