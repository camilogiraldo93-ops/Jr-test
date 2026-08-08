/**
 * Construye la demo navegable: un único archivo HTML autocontenido con la misma
 * interfaz de DentalGest, pero resolviendo las peticiones en el navegador.
 *
 * - Los datos de ejemplo se generan ejecutando el `seed.js` real, así que la demo
 *   arranca con exactamente el mismo consultorio que `npm run seed:reset`.
 * - Las imágenes del expediente se incrustan como data URL.
 * - Los módulos ES se empaquetan a mano (no hay dependencias de construcción).
 *
 * Uso: node demo/construir.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const SALIDA = path.join(AQUI, 'dentalgest-demo.html');

/* ------------------------- 1. Datos de ejemplo reales --------------------- */

function generarSemilla() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dental-demo-'));
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const env = { ...process.env, DENTAL_DATA_DIR: dir, DENTAL_DB: path.join(dir, 'demo.db') };
  const r = spawnSync(process.execPath, ['--no-warnings', 'seed.js', '--reset'],
    { cwd: RAIZ, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`El seed falló:\n${r.stderr || r.stdout}`);

  const db = new DatabaseSync(path.join(dir, 'demo.db'));
  const volcar = (t) => db.prepare(`SELECT * FROM ${t}`).all().map((f) => ({ ...f }));

  const TABLAS = ['consultorios', 'cubiculos', 'doctores', 'doctor_consultorio', 'doctor_cubiculo',
    'pacientes', 'odontograma', 'catalogo_tratamientos', 'citas', 'tratamientos', 'fotos',
    'recordatorios', 'consentimientos', 'cargos', 'pagos', 'gastos'];

  const datos = {};
  for (const t of TABLAS) datos[t] = volcar(t);

  // Las contraseñas no viajan: la demo valida contra la lista pública de accesos.
  datos.usuarios = volcar('usuarios').map(({ password_hash, salt, ...u }) => u);

  // Las imágenes se incrustan como data URL para que el archivo sea autocontenido.
  const MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  let pesoImagenes = 0;
  for (const f of datos.fotos) {
    const ruta = path.join(dir, 'uploads', f.archivo);
    if (!fs.existsSync(ruta)) { f.archivo = ''; continue; }
    const buf = fs.readFileSync(ruta);
    pesoImagenes += buf.length;
    f.archivo = `data:${MIMES[path.extname(f.archivo).toLowerCase()] || 'image/png'};base64,${buf.toString('base64')}`;
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  const hoy = new Date();
  const p = (n) => String(n).padStart(2, '0');
  datos.fecha_base = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`;
  datos.version = `demo-${datos.fecha_base}`;

  console.log(`Semilla: ${datos.pacientes.length} pacientes, ${datos.citas.length} citas, ` +
    `${datos.fotos.length} imágenes (${Math.round(pesoImagenes / 1024)} KB).`);
  return datos;
}

/* --------------------------- 2. Empaquetado de módulos -------------------- */

// El módulo de API real se sustituye por el que resuelve todo en el navegador.
const SUSTITUCIONES = { 'js/api.js': path.join(AQUI, 'api-demo.js') };

function rutaModulo(especificador, desde) {
  const abs = path.resolve(path.dirname(desde), especificador);
  return path.relative(path.join(RAIZ, 'public'), abs).split(path.sep).join('/');
}

function leerModulo(clave) {
  const sustituto = SUSTITUCIONES[clave];
  return fs.readFileSync(sustituto || path.join(RAIZ, 'public', clave), 'utf8');
}

/** Recorre el grafo de importaciones desde la entrada y devuelve el orden de carga. */
function ordenar(entrada) {
  const visitados = new Set();
  const orden = [];
  const visitar = (clave) => {
    if (visitados.has(clave)) return;
    visitados.add(clave);
    const fuente = leerModulo(clave);
    const rutaReal = SUSTITUCIONES[clave] || path.join(RAIZ, 'public', clave);
    for (const m of fuente.matchAll(/^import\s+[^;]*?\bfrom\s+'([^']+)'/gm)) {
      // Las importaciones del sustituto se resuelven contra la carpeta original.
      const base = SUSTITUCIONES[clave] ? path.join(RAIZ, 'public', clave) : rutaReal;
      visitar(rutaModulo(m[1], base));
    }
    orden.push(clave);
  };
  visitar(entrada);
  return orden;
}

/** Convierte un módulo ES en una función que devuelve su objeto de exportaciones. */
function transformar(clave, fuente) {
  const exportados = new Set();
  let codigo = fuente;

  codigo = codigo.replace(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)';?$/gm, (_, nombres, esp) => {
    const base = SUSTITUCIONES[clave] ? path.join(RAIZ, 'public', clave) : path.join(RAIZ, 'public', clave);
    const destino = rutaModulo(esp, base);
    const lista = nombres.split(',').map((n) => n.trim()).filter(Boolean).join(', ');
    return `const { ${lista} } = __mod(${JSON.stringify(destino)});`;
  });

  codigo = codigo.replace(/^export\s+(async\s+function|function|class|const)\s+([A-Za-z_$][\w$]*)/gm,
    (_, tipo, nombre) => {
      exportados.add(nombre);
      return `${tipo} ${nombre}`;
    });

  if (/^export\s/m.test(codigo)) {
    throw new Error(`Forma de export no soportada en ${clave}:\n` +
      codigo.split('\n').filter((l) => /^export\s/.test(l)).join('\n'));
  }

  const devuelve = [...exportados].map((n) => `${n}`).join(', ');
  return `__def(${JSON.stringify(clave)}, function () {\n${codigo}\nreturn { ${devuelve} };\n});`;
}

function empaquetar() {
  const orden = ordenar('js/app.js');
  console.log(`Módulos empaquetados (${orden.length}): ${orden.join(', ')}`);
  const cuerpos = orden.map((c) => transformar(c, leerModulo(c)));
  return `
(function () {
  'use strict';
  const __fabricas = {};
  const __cache = {};
  function __def(nombre, fn) { __fabricas[nombre] = fn; }
  function __mod(nombre) {
    if (!(nombre in __cache)) {
      if (!__fabricas[nombre]) throw new Error('Módulo no empaquetado: ' + nombre);
      __cache[nombre] = __fabricas[nombre]();
    }
    return __cache[nombre];
  }
${cuerpos.join('\n\n')}
  __mod('js/app.js');
})();`;
}

/* ------------------------------ 3. Documento ------------------------------ */

const BANNER = `
<div id="cinta-demo">
  <span><b>Demo</b> · los datos viven solo en tu navegador y no salen de tu dispositivo</span>
  <button type="button" id="btn-reiniciar-demo">↺ Reiniciar datos</button>
</div>`;

const ESTILO_BANNER = `
#cinta-demo {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 500;
  background: #0f2b33; color: #cfe3e7; font-size: .82rem;
  padding: 7px 14px; display: flex; gap: 12px; align-items: center; justify-content: center;
  flex-wrap: wrap;
}
#cinta-demo b { color: #14b8a6; }
#cinta-demo button {
  background: rgba(255,255,255,.1); color: #cfe3e7; border: 1px solid rgba(255,255,255,.2);
  border-radius: 7px; padding: 4px 10px; cursor: pointer; font-size: .8rem;
}
#cinta-demo button:hover { background: rgba(255,255,255,.2); }
body { padding-bottom: 42px; }
/* La barra lateral ocupa el alto completo: se recorta para que la cinta no
   tape el botón de cerrar sesión, que vive al final de la columna. */
.lateral { height: calc(100vh - 42px); }
.avisos { bottom: 110px; }
.boton-ayuda { bottom: 58px; }
@media (max-width: 900px) { .lateral { height: auto; } }
@media print { #cinta-demo { display: none !important; } body { padding-bottom: 0; } }`;

function construir() {
  const semilla = generarSemilla();
  const css = fs.readFileSync(path.join(RAIZ, 'public/css/app.css'), 'utf8');
  const bundle = empaquetar();

  const html = `<title>DentalGest — Demo navegable</title>
<style>
${css}
${ESTILO_BANNER}
</style>

<div id="app" class="cargando">
  <div class="pantalla-carga"><div class="spinner"></div><p>Cargando DentalGest…</p></div>
</div>
<div id="modales"></div>
<div id="avisos" class="avisos" role="status" aria-live="polite"></div>
${BANNER}

<script>window.__SEMILLA_DENTALGEST__ = ${JSON.stringify(semilla)};</script>
<script>
${bundle}
document.getElementById('btn-reiniciar-demo').addEventListener('click', function () {
  try { localStorage.removeItem('dentalgest_demo_datos'); localStorage.removeItem('dentalgest_demo_sesion'); } catch (e) {}
  location.hash = '';
  location.reload();
});
</script>`;

  fs.writeFileSync(SALIDA, html);
  console.log(`\n✅ ${SALIDA}`);
  console.log(`   ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
}

construir();
