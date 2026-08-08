import fs from 'node:fs';
import path from 'node:path';
import { usuarioPorToken } from './auth.js';

const NOMBRE_ROL = { admin: 'la administradora', doctor: 'el doctor', recepcion: 'recepción' };

/** «la administradora», «la administradora o el doctor», … */
function listaPuestos(roles) {
  const nombres = roles.map((x) => NOMBRE_ROL[x] || x);
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1]}`;
}

/** Error de aplicación con código HTTP y detalle opcional. */
export class ErrorApp extends Error {
  constructor(estado, mensaje, detalle = null) {
    super(mensaje);
    this.estado = estado;
    this.detalle = detalle;
  }
}

const rutas = [];

/** Registra una ruta. patron admite parámetros con ':nombre'. */
export function ruta(metodo, patron, opciones, manejador) {
  if (typeof opciones === 'function') { manejador = opciones; opciones = {}; }
  const nombres = [];
  const regex = new RegExp('^' + patron.replace(/:([a-zA-Z_]+)/g, (_, n) => {
    nombres.push(n);
    return '([^/]+)';
  }) + '$');
  rutas.push({ metodo, regex, nombres, roles: opciones.roles || null, publico: !!opciones.publico, manejador });
}

export const get = (p, o, h) => ruta('GET', p, o, h);
export const post = (p, o, h) => ruta('POST', p, o, h);
export const put = (p, o, h) => ruta('PUT', p, o, h);
export const patch = (p, o, h) => ruta('PATCH', p, o, h);
export const del = (p, o, h) => ruta('DELETE', p, o, h);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function enviarJson(res, estado, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

async function leerCuerpo(req) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > 25 * 1024 * 1024) throw new ErrorApp(413, 'Eso pesa demasiado (el máximo son 25 MB). Prueba con un archivo más pequeño.');
    trozos.push(t);
  }
  if (!trozos.length) return {};
  const texto = Buffer.concat(trozos).toString('utf8');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorApp(400, 'Los datos llegaron incompletos o dañados. Vuelve a intentarlo.');
  }
}

function servirEstatico(res, base, relativo, fallbackIndex) {
  let limpio = decodeURIComponent(relativo.split('?')[0]);
  if (limpio.includes('\0')) return false;
  let destino = path.join(base, limpio);
  if (!destino.startsWith(base)) return false;
  if (!fs.existsSync(destino) || fs.statSync(destino).isDirectory()) {
    if (!fallbackIndex) return false;
    destino = path.join(base, 'index.html');
    if (!fs.existsSync(destino)) return false;
  }
  const ext = path.extname(destino).toLowerCase();
  const datos = fs.readFileSync(destino);
  res.writeHead(200, {
    'Content-Type': TIPOS[ext] || 'application/octet-stream',
    'Content-Length': datos.length,
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
  });
  res.end(datos);
  return true;
}

export function crearManejador({ dirPublico, dirUploads }) {
  return async function manejar(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ruta = url.pathname;

    try {
      if (ruta.startsWith('/uploads/')) {
        if (servirEstatico(res, dirUploads, ruta.slice('/uploads/'.length), false)) return;
        return enviarJson(res, 404, { error: 'Archivo no encontrado.' });
      }

      if (!ruta.startsWith('/api/')) {
        const rel = ruta === '/' ? 'index.html' : ruta.slice(1);
        if (servirEstatico(res, dirPublico, rel, true)) return;
        return enviarJson(res, 404, { error: 'Recurso no encontrado.' });
      }

      for (const r of rutas) {
        if (r.metodo !== req.method) continue;
        const m = ruta.match(r.regex);
        if (!m) continue;

        const params = {};
        r.nombres.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });

        let usuario = null;
        if (!r.publico) {
          const auth = req.headers['authorization'] || '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
          usuario = usuarioPorToken(token);
          if (!usuario) throw new ErrorApp(401, 'Sesión no válida o expirada. Inicia sesión de nuevo.');
          if (r.roles && !r.roles.includes(usuario.rol)) {
            // El código interno del puesto no le dice nada a quien lee: se nombra
            // el puesto como se nombra en el consultorio y se dice de quién es.
            throw new ErrorApp(403,
              `Esta parte no le corresponde a ${NOMBRE_ROL[usuario.rol] || 'tu puesto'}. ` +
              `La maneja ${listaPuestos(r.roles)}. Si necesitas algo de aquí, pídeselo.`);
          }
        }

        const cuerpo = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await leerCuerpo(req) : {};
        const resultado = await r.manejador({ params, cuerpo, consulta: url.searchParams, usuario, req });
        if (resultado === undefined) return enviarJson(res, 204, {});
        const estado = req.method === 'POST' ? 201 : 200;
        return enviarJson(res, resultado?.__estado || estado, resultado?.__cuerpo || resultado);
      }

      throw new ErrorApp(404, `Ruta no encontrada: ${req.method} ${ruta}`);
    } catch (e) {
      if (e instanceof ErrorApp) {
        return enviarJson(res, e.estado, { error: e.message, detalle: e.detalle });
      }
      console.error('[error no controlado]', e);
      // Quien lee esto está atendiendo a alguien: lo que necesita saber es que
      // no fue culpa suya, que no se perdió nada y qué hacer ahora.
      return enviarJson(res, 500, {
        error: 'Algo falló de nuestro lado y no se pudo guardar. No es culpa tuya y no se perdió ' +
               'lo que ya estaba guardado. Vuelve a intentarlo; si sigue igual, avísale a quien te da soporte.',
        detalle: String(e.message || e),
      });
    }
  };
}

export function conEstado(estado, cuerpo) {
  return { __estado: estado, __cuerpo: cuerpo };
}
