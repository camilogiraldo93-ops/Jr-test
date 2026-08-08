import { get, put, ErrorApp } from '../http.js';
import { todos, correr } from '../db.js';

/**
 * Ajustes del consultorio.
 *
 * `recepcion_dinero` existe porque hay dos formas legítimas de trabajar: en unas
 * clínicas el dueño lleva el dinero y recepción no lo toca; en otras, recepción
 * apunta los gastos del día y saca los reportes. Viene encendido, que es lo más
 * común en un consultorio pequeño, y la administradora puede apagarlo. Lo que
 * nunca se abre a recepción es la configuración del consultorio.
 */
export const AJUSTES = {
  recepcion_dinero: {
    valorPorDefecto: '1',
    etiqueta: 'Recepción puede ver y apuntar el dinero',
    ayuda: 'Viene encendido: recepción apunta los gastos del día y exporta los cobros. ' +
           'Apágalo si en tu consultorio eso lo lleva solo la administradora. ' +
           'La configuración del consultorio no se le abre en ningún caso.',
  },
};

export function ajustes() {
  const guardados = Object.fromEntries(todos('SELECT clave, valor FROM ajustes').map((a) => [a.clave, a.valor]));
  const salida = {};
  for (const [clave, def] of Object.entries(AJUSTES)) {
    salida[clave] = (guardados[clave] ?? def.valorPorDefecto) === '1';
  }
  return salida;
}

/** ¿Este usuario puede ver y mover el dinero del consultorio? */
export function exigirDinero(usuario) {
  if (usuario.rol === 'admin') return;
  if (usuario.rol === 'recepcion' && ajustes().recepcion_dinero) return;
  throw new ErrorApp(403,
    'En este consultorio el dinero lo lleva la administradora. Si quieres que recepción también ' +
    'pueda, se enciende en Configuración → «Recepción puede ver y apuntar el dinero».');
}

get('/api/ajustes', () => ajustes());

put('/api/ajustes', { roles: ['admin'] }, ({ cuerpo }) => {
  for (const [clave, valor] of Object.entries(cuerpo || {})) {
    if (!AJUSTES[clave]) throw new ErrorApp(400, `Ajuste desconocido: ${clave}.`);
    correr('INSERT INTO ajustes (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
      [clave, valor ? '1' : '0']);
  }
  return ajustes();
});
