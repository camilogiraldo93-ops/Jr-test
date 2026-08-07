import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crearManejador } from './http.js';
import { RAIZ, DIR_UPLOADS, uno } from './db.js';
import { crearUsuario } from './auth.js';

// El registro de rutas ocurre al importar cada módulo.
import './routes/auth.js';
import './routes/clinica.js';
import './routes/pacientes.js';
import './routes/citas.js';
import './routes/consentimientos.js';
import './routes/clinico.js';
import './routes/contabilidad.js';

/** Crea el usuario administrador inicial si la base está vacía. */
export function asegurarAdmin() {
  const n = uno('SELECT COUNT(*) n FROM usuarios').n;
  if (n === 0) {
    crearUsuario({
      nombre: 'Administrador',
      email: 'admin@clinica.com',
      password: 'admin123',
      rol: 'admin',
    });
    console.log('Usuario administrador inicial creado: admin@clinica.com / admin123');
  }
}

export function crearServidor() {
  const manejar = crearManejador({
    dirPublico: path.join(RAIZ, 'public'),
    dirUploads: DIR_UPLOADS,
  });
  return http.createServer((req, res) => {
    manejar(req, res).catch((e) => {
      console.error('[fallo del manejador]', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Error interno del servidor.' }));
    });
  });
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esPrincipal) {
  asegurarAdmin();
  const puerto = Number(process.env.PORT || 3210);
  crearServidor().listen(puerto, () => {
    console.log(`Gestión Dental escuchando en http://localhost:${puerto}`);
  });
}
