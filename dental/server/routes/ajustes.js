import { get, put, ErrorApp } from '../http.js';
import { todos, correr } from '../db.js';

/**
 * Ajustes del consultorio.
 *
 * `recepcion_dinero` existe porque hay dos formas legítimas de trabajar: en unas
 * clínicas el dueño lleva el dinero y recepción no lo toca; en otras, recepción
 * apunta los gastos del día y saca los reportes. Viene apagado —que es lo
 * acordado al construir la app— y la administradora puede encenderlo.
 */
export const AJUSTES = {
  recepcion_dinero: {
    valorPorDefecto: '0',
    etiqueta: 'Recepción puede ver y apuntar el dinero',
    ayuda: 'Si lo enciendes, recepción verá la sección «Dinero» para apuntar gastos ' +
           'y exportar los cobros. La configuración del consultorio nunca se le abre.',
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
    'El dinero del consultorio lo lleva la administradora. Si quieres que recepción también ' +
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
