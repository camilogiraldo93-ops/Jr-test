import { get, post, ErrorApp, conEstado } from '../http.js';
import { iniciarSesion, cerrarSesion, crearUsuario } from '../auth.js';
import { todos, uno } from '../db.js';
import { requerido, texto } from '../util.js';

post('/api/auth/login', { publico: true }, ({ cuerpo }) => {
  requerido(cuerpo, ['email', 'password']);
  const sesion = iniciarSesion(cuerpo.email, cuerpo.password);
  if (!sesion) throw new ErrorApp(401, 'Correo o contraseña incorrectos.');
  return conEstado(200, sesion);
});

post('/api/auth/logout', ({ req }) => {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) cerrarSesion(auth.slice(7));
  return conEstado(200, { ok: true });
});

get('/api/auth/yo', ({ usuario }) => usuario);

get('/api/usuarios', { roles: ['admin'] }, () =>
  todos('SELECT id, nombre, email, rol, doctor_id, activo, creado_en FROM usuarios ORDER BY id'));

post('/api/usuarios', { roles: ['admin'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['nombre', 'email', 'password', 'rol']);
  const rol = texto(cuerpo.rol);
  if (!['admin', 'doctor', 'recepcion'].includes(rol)) {
    throw new ErrorApp(400, 'Elige de la lista qué hace esta persona: administradora, doctor o recepción.');
  }
  if (uno('SELECT id FROM usuarios WHERE email = ?', [String(cuerpo.email).toLowerCase().trim()])) {
    throw new ErrorApp(409, 'Ya existe un usuario con ese correo.');
  }
  if (String(cuerpo.password).length < 6) {
    throw new ErrorApp(400, 'La contraseña debe tener al menos 6 caracteres.');
  }
  return crearUsuario({
    nombre: texto(cuerpo.nombre),
    email: cuerpo.email,
    password: cuerpo.password,
    rol,
    doctor_id: cuerpo.doctor_id ?? null,
  });
});
