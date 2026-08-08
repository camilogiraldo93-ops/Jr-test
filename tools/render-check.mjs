/**
 * Verifica que la app se renderiza sin errores en un navegador real.
 *
 * Sirve elnino/ como sitio estático, abre Chromium y responde las llamadas a
 * Open-Meteo con el fixture de respuestas REALES capturado por
 * tools/capture-fixture.mjs. Así se puede comprobar el renderizado completo
 * desde un entorno sin salida a internet, sin fabricar ningún dato.
 *
 * Los archivos de data/ se sirven tal cual: la climatología, el ONI, la
 * geometría y el backtest son los de producción.
 *
 * Uso: node tools/render-check.mjs [--headed]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'elnino');
const FIXTURE = path.join(ROOT, 'backtest/fixtures/live-sample.json');

if (!fs.existsSync(FIXTURE)) {
  console.error(`Falta el fixture ${FIXTURE}. Ejecuta antes tools/capture-fixture.mjs en un entorno con salida a internet.`);
  process.exit(2);
}
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const porUrl = new Map(fixture.respuestas.map((r) => [r.url, r.body]));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(SITE, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no encontrado'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let fallos = 0;
const check = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!cond) fallos++;
};

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const erroresConsola = [];
const erroresPagina = [];
page.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(m.text()); });
page.on('pageerror', (e) => erroresPagina.push(e.message));

let servidasDelFixture = 0;
let noEnFixture = [];
await page.route('**://*.open-meteo.com/**', async (route) => {
  const url = route.request().url();
  const body = porUrl.get(url);
  if (body == null) { noEnFixture.push(url); await route.abort(); return; }
  servidasDelFixture++;
  await route.fulfill({ status: 200, contentType: 'application/json', body });
});

console.log(`\n== Render en Chromium (fixture del ${fixture._meta.capturado.slice(0, 16)}) ==`);
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('#contenido:not([hidden])', { timeout: 20000 }).catch(() => {});

const visible = await page.isVisible('#contenido');
check('el contenido principal se muestra', visible);
check('el panel de error permanece oculto', !(await page.isVisible('#error')));
check('todas las llamadas a Open-Meteo se resolvieron con el fixture',
  noEnFixture.length === 0, noEnFixture.length ? `(sin fixture: ${noEnFixture[0]})` : `(${servidasDelFixture} llamadas)`);
check('sin errores de JavaScript', erroresPagina.length === 0, erroresPagina[0] || '');
check('sin errores en consola', erroresConsola.length === 0, erroresConsola[0] || '');

const provinciasPintadas = await page.locator('#mapa .provincia').count();
check('el mapa pinta las 24 provincias', provinciasPintadas === 24, `(${provinciasPintadas})`);

const conColor = await page.locator('#mapa .provincia').evaluateAll(
  (ns) => ns.filter((n) => n.getAttribute('fill') && n.getAttribute('fill') !== 'none').length,
);
check('todas las provincias tienen color de severidad', conColor === provinciasPintadas, `(${conColor})`);

check('la leyenda tiene los cuatro niveles',
  (await page.locator('#leyenda .leyenda-item').count()) === 4);
check('hay selector de días', (await page.locator('#selector-dias .dia').count()) >= 5,
  `(${await page.locator('#selector-dias .dia').count()} días)`);

const textoEnso = await page.locator('#enso').innerText();
check('el panel ENSO muestra el valor del ONI', /-?\d+\.\d{2}\s*°C/.test(textoEnso));
check('el panel ENSO cita a NOAA', /NOAA/.test(textoEnso));

const tarjetas = await page.locator('.alerta').count();
const vacio = await page.locator('#lista-alertas .vacio').count();
check('la lista de alertas está resuelta (tarjetas o mensaje explícito)', tarjetas > 0 || vacio > 0,
  `(${tarjetas} tarjetas)`);

if (tarjetas > 0) {
  const t = page.locator('.alerta').first();
  const texto = await t.innerText();
  check('cada alerta cita su fuente', /Open-Meteo/.test(texto));
  check('cada alerta muestra su umbral', /[Uu]mbral/.test(texto));
  check('cada alerta muestra incertidumbre', /[Ii]ncertidumbre/.test(texto));
  check('cada alerta indica anticipación en horas', /h de anticipación/.test(texto));
  const conIncert = await page.locator('.alerta .incertidumbre').count();
  check('todas las tarjetas llevan bloque de incertidumbre', conIncert === tarjetas, `(${conIncert}/${tarjetas})`);
}

const lim = await page.locator('#limitaciones-body').innerText();
check('las limitaciones están documentadas en la app', lim.length > 800, `(${lim.length} caracteres)`);
check('las limitaciones incluyen la métrica del backtest', /coincidencia exacta/i.test(lim));
check('las limitaciones advierten sobre el baseline trivial', /baseline|nunca alertar/i.test(lim));
check('la app se declara no oficial',
  /no es una fuente oficial/i.test(await page.locator('.disclaimer').innerText()));

const shot = path.join(ROOT, 'backtest/fixtures/render.png');
await page.screenshot({ path: shot, fullPage: true });
console.log(`\n  captura: ${shot}`);

await browser.close();
server.close();
console.log(`\n${fallos === 0 ? 'RENDER OK' : `${fallos} COMPROBACIÓN(ES) FALLAN`}\n`);
process.exit(fallos === 0 ? 0 : 1);
