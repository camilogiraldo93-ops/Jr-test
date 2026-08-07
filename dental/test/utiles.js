import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Arranca el servidor con una base de datos temporal y aislada. */
export async function arrancarServidor({ sembrar = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentalgest-'));
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const puerto = 3300 + Math.floor(Math.random() * 900);
  const env = { ...process.env, DENTAL_DATA_DIR: dir, DENTAL_DB: path.join(dir, 'test.db'), PORT: String(puerto) };

  if (sembrar) {
    await new Promise((res, rej) => {
      const p = spawn(process.execPath, ['--no-warnings', 'seed.js', '--reset'], { cwd: RAIZ, env, stdio: 'ignore' });
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`seed falló con código ${c}`))));
      p.on('error', rej);
    });
  }

  const proceso = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const registro = [];
  proceso.stdout.on('data', (d) => registro.push(String(d)));
  proceso.stderr.on('data', (d) => registro.push(String(d)));

  const base = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x', password: 'y' }),
      });
      if (r.status) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    base, dir, proceso, registro,
    errores: () => registro.filter((l) => /error no controlado|fallo del manejador|TypeError|ReferenceError/i.test(l)),
    /** Detiene el proceso; con conservar=true no borra el directorio de datos. */
    detener: ({ conservar = false } = {}) => new Promise((res) => {
      const fin = () => {
        if (!conservar) {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignorar */ }
        }
        res();
      };
      proceso.on('exit', fin);
      proceso.kill('SIGTERM');
      setTimeout(fin, 4000).unref();
    }),
  };
}

/** Cliente HTTP mínimo para el API. */
export function cliente(base) {
  let token = null;
  async function pedir(metodo, ruta, cuerpo) {
    const opciones = { method: metodo, headers: {} };
    if (token) opciones.headers.Authorization = `Bearer ${token}`;
    if (cuerpo !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }
    const res = await fetch(base + ruta, opciones);
    const texto = await res.text();
    let datos = null;
    if (texto) { try { datos = JSON.parse(texto); } catch { datos = texto; } }
    return { estado: res.status, datos };
  }
  return {
    get token() { return token; },
    set token(v) { token = v; },
    async login(email, password) {
      const r = await pedir('POST', '/api/auth/login', { email, password });
      if (r.estado !== 200) throw new Error(`Login falló (${r.estado}): ${JSON.stringify(r.datos)}`);
      token = r.datos.token;
      return r.datos.usuario;
    },
    get: (r) => pedir('GET', r),
    post: (r, c) => pedir('POST', r, c),
    put: (r, c) => pedir('PUT', r, c),
    patch: (r, c) => pedir('PATCH', r, c),
    del: (r) => pedir('DELETE', r),
  };
}

/** Exige que la respuesta tenga el estado esperado; si no, muestra el detalle. */
export function exigir(r, estado, contexto = '') {
  if (r.estado !== estado) {
    throw new Error(`${contexto} → se esperaba ${estado} pero llegó ${r.estado}: ${JSON.stringify(r.datos)}`);
  }
  return r.datos;
}

/** PNG 2x2 válido como data URL, para probar la carga de imágenes. */
export const PNG_DEMO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAG0lEQVR42mP8z8BQz0AEYBxVSF+FAAvvDPMPYDGiAAAAAElFTkSuQmCC';

export function fechaRelativa(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export { RAIZ };
