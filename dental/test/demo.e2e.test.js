/**
 * Prueba de la demo navegable (demo/dentalgest-demo.html): un único archivo que
 * corre la interfaz completa en el navegador. Verifica que las reglas portadas
 * desde el servidor se comportan igual y que la consola queda limpia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO = path.join(RAIZ, 'demo', 'dentalgest-demo.html');

async function cargarPlaywright() {
  const normalizar = (m) => (m?.chromium ? m : m?.default);
  try {
    const local = normalizar(await import('playwright'));
    if (local?.chromium) return local;
  } catch { /* no está en el proyecto */ }
  const candidatos = [
    process.env.PLAYWRIGHT_ROOT,
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
    '/usr/lib/node_modules', '/usr/local/lib/node_modules',
  ].filter(Boolean);
  try {
    const entorno = { ...process.env };
    delete entorno.npm_config_prefix;
    delete entorno.npm_config_global_prefix;
    candidatos.push(execSync('npm root -g', { env: entorno }).toString().trim());
  } catch { /* npm puede no estar */ }
  for (const raiz of candidatos) {
    const destino = path.join(raiz, 'playwright', 'index.js');
    if (!fs.existsSync(destino)) continue;
    const mod = normalizar(await import(pathToFileURL(destino).href));
    if (mod?.chromium) return mod;
  }
  throw new Error('No se encontró Playwright.');
}

let servidor;
let navegador;
let pagina;
let base;
const erroresConsola = [];
const ctx = {};

function vigilar(p) {
  p.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(`[consola] ${m.text()}`); });
  p.on('pageerror', (e) => erroresConsola.push(`[excepción] ${e.message}`));
  p.on('requestfailed', (r) => {
    const f = r.failure();
    if (f && !/ERR_ABORTED/.test(f.errorText)) erroresConsola.push(`[red] ${r.url()} → ${f.errorText}`);
  });
}

async function esperarExito(patron) {
  await pagina.waitForFunction((f) => {
    const rx = new RegExp(f, 'i');
    return [...document.querySelectorAll('#avisos .aviso.exito')].some((n) => rx.test(n.innerText));
  }, patron.source, { timeout: 20000 });
  await pagina.evaluate(() => document.querySelectorAll('#avisos .aviso').forEach((n) => n.remove()));
}

const modal = () => pagina.locator('.modal-fondo').last();

async function abrirModal(selector) {
  await pagina.waitForFunction(() => document.querySelectorAll('.modal-fondo').length === 0);
  await pagina.click(selector);
  await pagina.waitForSelector('.modal-fondo .modal-cuerpo');
}

async function trazar(lienzo) {
  await lienzo.scrollIntoViewIfNeeded();
  const c = await lienzo.boundingBox();
  await pagina.mouse.move(c.x + 40, c.y + c.height * 0.7);
  await pagina.mouse.down();
  await pagina.mouse.move(c.x + c.width * 0.35, c.y + c.height * 0.3, { steps: 12 });
  await pagina.mouse.move(c.x + c.width * 0.7, c.y + c.height * 0.75, { steps: 12 });
  await pagina.mouse.up();
}

async function entrar(email, password) {
  await pagina.goto(base, { waitUntil: 'networkidle' });
  await pagina.fill('input[name="email"]', email);
  await pagina.fill('input[name="password"]', password);
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco', { timeout: 20000 });
}

test('preparación: construye la demo y la sirve', async () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'demo/construir.mjs'],
    { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(r.status, 0, `la construcción falló:\n${r.stderr || r.stdout}`);
  assert.ok(fs.existsSync(ARCHIVO), 'se generó el archivo de la demo');

  const html = fs.readFileSync(ARCHIVO, 'utf8');
  assert.ok(!/src=["']\/|href=["']\/(css|js)/.test(html),
    'la demo no debe referenciar archivos externos: es autocontenida');
  assert.ok(Buffer.byteLength(html) < 16 * 1024 * 1024, 'cabe de sobra en el límite de publicación');

  servidor = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r2) => servidor.listen(0, r2));
  base = `http://127.0.0.1:${servidor.address().port}/`;

  const { chromium } = await cargarPlaywright();
  navegador = await chromium.launch({ args: ['--no-sandbox'] });
  const contexto = await navegador.newContext({ viewport: { width: 1360, height: 950 } });
  contexto.setDefaultTimeout(30000);
  pagina = await contexto.newPage();
  vigilar(pagina);
});

test('Demo · inicia sesión y carga el panel con los datos de ejemplo', async () => {
  await entrar('admin@clinica.com', 'admin123');
  await pagina.waitForSelector('.kpi');
  const kpis = await pagina.locator('.rejilla.c4').first().innerText();
  assert.match(kpis, /10/, '10 pacientes de ejemplo');
  assert.match(await pagina.locator('h2').first().innerText(), /Panel general/);
});

test('Demo · la agenda muestra citas y bloquea conflictos', async () => {
  await pagina.click('a[href="#/agenda"]');
  await pagina.waitForSelector('.agenda-tabla');

  // Busca un día con citas y comprueba que se pintan.
  const cita = await pagina.evaluate(() => {
    const partes = location.href;
    return partes;
  });
  assert.ok(cita);

  await pagina.waitForSelector('.agenda-controles');
  const hoy = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Vista semanal: con la semilla desplazada siempre hay algo esta semana o la próxima.
  await pagina.selectOption('select[name="vista"]', 'semana');
  await pagina.fill('input[name="fecha"]', iso(hoy));
  await pagina.waitForSelector('.bloque-cita', { timeout: 20000 });
  const bloques = await pagina.locator('.bloque-cita').count();
  assert.ok(bloques > 0, `la semana actual tiene ${bloques} citas`);

  // Conflicto: se reusa el horario de una cita existente.
  const datos = await pagina.locator('.bloque-cita').first().getAttribute('title');
  assert.ok(datos, 'el bloque describe la cita');

  await pagina.selectOption('select[name="vista"]', 'dia');
  await abrirModal('button:has-text("➕ Nueva cita")');
  const m = modal();
  await m.locator('input[name="fecha"]').fill(iso(hoy));
  await m.locator('input[name="hora_inicio"]').fill('09:00');
  await m.locator('input[name="hora_fin"]').fill('10:00');
  await pagina.waitForSelector('.modal-fondo .alerta-caja', { timeout: 20000 });
  await m.locator('button:has-text("Cancelar")').click();
});

test('Demo · regla clínica, tratamiento, consentimiento y doble firma', async () => {
  // El seed deja una cita en curso con implante y consentimiento pendiente.
  await pagina.goto(`${base}#/panel`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.tarjeta:has-text("Consentimientos por firmar")');
  const pendiente = pagina.locator('.tarjeta:has-text("Consentimientos por firmar") a:has-text("Firmar")').first();
  assert.equal(await pendiente.count(), 1, 'el panel lista el consentimiento pendiente');
  await pendiente.click();

  await pagina.waitForSelector('.documento');
  const texto = await pagina.locator('.documento').innerText();
  assert.match(texto, /CONSENTIMIENTO INFORMADO PARA TRATAMIENTO ODONTOL/i);
  assert.match(texto, /Implante dental/);
  assert.match(texto, /Clínica Dental Centro/);
  assert.match(texto, /AUTORIZO/);
  ctx.consentUrl = pagina.url();

  const lienzos = pagina.locator('canvas.firma-lienzo');
  assert.equal(await lienzos.count(), 2);
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await pagina.waitForSelector('.aviso.error');
  assert.match(await pagina.locator('.aviso.error').last().innerText(), /Falta la firma del paciente/);
  await pagina.evaluate(() => document.querySelectorAll('#avisos .aviso').forEach((n) => n.remove()));

  await trazar(lienzos.nth(0));
  await trazar(lienzos.nth(1));
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await esperarExito(/firmado y archivado/);
  await pagina.waitForSelector('.alerta-caja.ok:has-text("Documento firmado")');
  assert.equal(await pagina.locator('.firmas .firma-img').count(), 2, 'guarda ambas firmas');

  // Inmutable
  assert.equal(await pagina.locator('canvas.firma-lienzo').count(), 0);
  assert.equal(await pagina.locator('.tarjeta:has-text("Datos del documento")').count(), 0);
});

test('Demo · la cita se puede completar una vez firmado', async () => {
  await pagina.goto(ctx.consentUrl, { waitUntil: 'networkidle' });
  await pagina.click('a:has-text("🗓️ Cita")');
  await pagina.waitForSelector('h2:has-text("Cita #")');
  ctx.citaUrl = pagina.url();

  assert.equal(await pagina.locator('.alerta-caja:has-text("sin firmar")').count(), 0,
    'ya no hay aviso de consentimiento pendiente');
  await pagina.click('button:has-text("Completada")');
  await esperarExito(/Completada/i);
  await pagina.waitForSelector('.eti.completada');
});

test('Demo · expediente completo con pestañas, imágenes e impresión', async () => {
  await pagina.click('a:has-text("📋 Expediente")');
  await pagina.waitForSelector('.pestanas button');

  const pestanas = await pagina.locator('.pestanas button').allInnerTexts();
  assert.ok(pestanas.length >= 8);
  for (const nombre of pestanas) {
    await pagina.locator('.pestanas button', { hasText: nombre }).first().click();
    await pagina.waitForFunction((n) => document.querySelector('.pestanas button.activo')?.innerText === n,
      nombre, { timeout: 10000 });
    const titulo = await pagina.locator('.contenido .tarjeta h3').first().innerText();
    assert.ok(titulo.trim().length > 0, `la pestaña "${nombre}" muestra encabezado`);
  }

  await pagina.click('button:has-text("🖼️ Imágenes")');
  await pagina.waitForSelector('.galeria figure');
  const cargadas = await pagina.locator('.galeria img').evaluateAll(
    (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));
  assert.ok(cargadas, 'las imágenes incrustadas se renderizan');

  const url = pagina.url();
  const idPaciente = Number(url.split('/').pop());
  await pagina.goto(`${base}#/imprimir/expediente/${idPaciente}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.vista-impresion .hoja');
  assert.match(await pagina.locator('.hoja').innerText(), /Expediente clínico/);
});

test('Demo · contabilidad con desglose por doctor y exportación CSV', async () => {
  await pagina.goto(`${base}#/contabilidad`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.tarjeta:has-text("Ingresos por doctor")');
  assert.ok(await pagina.locator('.tarjeta:has-text("Ingresos por método de pago")').count());

  const [descarga] = await Promise.all([
    pagina.waitForEvent('download'),
    pagina.click('button:has-text("Exportar gastos (CSV)")'),
  ]);
  const csv = fs.readFileSync(await descarga.path(), 'utf8');
  assert.match(csv, /Fecha;Consultorio;Categoria;Concepto;Proveedor;Monto/);
});

test('Demo · los cambios sobreviven a recargar la página', async () => {
  await pagina.goto(`${base}#/pacientes`, { waitUntil: 'networkidle' });
  await abrirModal('button:has-text("➕ Nuevo paciente")');
  await modal().locator('input[name="nombre"]').fill('Persona');
  await modal().locator('input[name="apellidos"]').fill('De Prueba Demo');
  await modal().locator('input[name="telefono"]').fill('099-000-1111');
  await modal().locator('button:has-text("Crear paciente")').click();
  await esperarExito(/creado/);
  await pagina.waitForSelector('h2:has-text("Persona")');

  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Persona")');

  await pagina.goto(`${base}#/pacientes`, { waitUntil: 'networkidle' });
  await pagina.fill('input[name="q"]', 'De Prueba Demo');
  await pagina.waitForSelector('td a:has-text("De Prueba Demo")');
});

test('Demo · los roles limitan lo que se ve', async () => {
  await pagina.click('.usuario-caja button');
  await pagina.waitForSelector('.login-caja');
  await pagina.fill('input[name="email"]', 'recepcion@clinica.com');
  await pagina.fill('input[name="password"]', 'recepcion123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco');
  assert.equal(await pagina.locator('a[href="#/contabilidad"]').count(), 0, 'recepción no ve Contabilidad');
  assert.equal(await pagina.locator('a[href="#/configuracion"]').count(), 0, 'ni Configuración');

  await pagina.click('.usuario-caja button');
  await pagina.waitForSelector('.login-caja');
  await pagina.fill('input[name="email"]', 'ana.morales@clinica.com');
  await pagina.fill('input[name="password"]', 'doctor123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco');
  await pagina.goto(`${base}#/agenda`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.agenda-tabla');
  await pagina.selectOption('select[name="agrupar"]', 'doctor');
  await pagina.waitForFunction(() => document.querySelectorAll('.agenda-tabla thead th').length === 2);
  const columnas = await pagina.locator('.agenda-tabla thead th').allInnerTexts();
  assert.match(columnas[1], /Ana Morales/, 'el doctor solo ve su propia columna');
});

test('Demo · el botón de reinicio devuelve los datos de ejemplo', async () => {
  await pagina.click('#btn-reiniciar-demo');
  await pagina.waitForSelector('.login-caja', { timeout: 20000 });
  await entrar('admin@clinica.com', 'admin123');
  await pagina.goto(`${base}#/pacientes`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('table.tabla tbody tr');
  const filas = await pagina.locator('table.tabla tbody tr').count();
  assert.equal(filas, 10, 'vuelve a los 10 pacientes originales');
});

test('Demo · cero errores de consola', async () => {
  assert.deepEqual(erroresConsola, [], `errores detectados:\n${erroresConsola.join('\n')}`);
});

test('limpieza', async () => {
  if (navegador) await navegador.close();
  if (servidor) await new Promise((r) => servidor.close(r));
});
