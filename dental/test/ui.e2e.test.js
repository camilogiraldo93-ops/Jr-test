/**
 * Prueba de regresión de interfaz con navegador real (Chromium/Playwright).
 * Recorre los 8 flujos de usuario haciendo clic y vigila la consola:
 * cualquier error de consola o excepción de página hace fallar la prueba.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { arrancarServidor } from './utiles.js';

/**
 * Playwright puede estar instalado en el proyecto o solo de forma global.
 * npm reescribe el prefijo global cuando se ejecuta dentro de un script, así que se
 * prueban varias ubicaciones en vez de confiar únicamente en `npm root -g`.
 */
async function cargarPlaywright() {
  const normalizar = (m) => (m?.chromium ? m : m?.default);
  try {
    const local = normalizar(await import('playwright'));
    if (local?.chromium) return local;
  } catch { /* no está instalado en el proyecto */ }

  const candidatos = [];
  if (process.env.PLAYWRIGHT_ROOT) candidatos.push(process.env.PLAYWRIGHT_ROOT);
  // Junto al binario de Node: <prefijo>/bin/node → <prefijo>/lib/node_modules
  candidatos.push(path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules'));
  try {
    const entorno = { ...process.env };
    delete entorno.npm_config_prefix;
    delete entorno.npm_config_global_prefix;
    candidatos.push(execSync('npm root -g', { env: entorno }).toString().trim());
  } catch { /* npm puede no estar disponible */ }
  candidatos.push('/usr/lib/node_modules', '/usr/local/lib/node_modules');

  for (const raiz of candidatos) {
    const destino = path.join(raiz, 'playwright', 'index.js');
    if (!fs.existsSync(destino)) continue;
    const mod = normalizar(await import(pathToFileURL(destino).href));
    if (mod?.chromium) return mod;
  }
  throw new Error(
    `No se encontró Playwright para las pruebas de interfaz. Rutas probadas: ${candidatos.join(', ')}`);
}

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAG0lEQVR42mP8z8BQz0AEYBxVSF+FAAvvDPMPYDGiAAAAAElFTkSuQmCC',
  'base64');

let servidor;
let navegador;
let pagina;
const erroresConsola = [];
let dirTmp;
const ctx = {};

const sufijo = String(Date.now()).slice(-6);

// Chromium escribe en consola un "Failed to load resource" por cada respuesta no-2xx.
// Los 4xx que la aplicación provoca a propósito (conflicto de agenda, validaciones) y muestra
// al usuario no son fallos: se ignora ese ruido del navegador, pero cualquier 5xx se registra
// aparte mediante el vigilante de respuestas, y todo lo demás sí cuenta como error.
const RUIDO_NAVEGADOR = /Failed to load resource: the server responded with a status of 4\d\d/;

function registrarVigilancia(p) {
  p.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const texto = msg.text();
    if (RUIDO_NAVEGADOR.test(texto)) return;
    erroresConsola.push(`[consola] ${texto}`);
  });
  p.on('pageerror', (err) => erroresConsola.push(`[excepción] ${err.message}`));
  p.on('requestfailed', (req) => {
    const f = req.failure();
    if (f && !/ERR_ABORTED/.test(f.errorText)) {
      erroresConsola.push(`[red] ${req.url()} → ${f.errorText}`);
    }
  });
  p.on('response', (res) => {
    if (res.status() >= 500) erroresConsola.push(`[HTTP ${res.status()}] ${res.url()}`);
  });
}

/** Quita los avisos visibles para que no se confundan con los de la siguiente acción. */
async function limpiarAvisos() {
  await pagina.evaluate(() => {
    document.querySelectorAll('#avisos .aviso').forEach((n) => n.remove());
  });
}

/** Espera un aviso de éxito cuyo texto coincida con la expresión dada. */
async function esperarExito(patron) {
  const fuente = patron ? patron.source : '.';
  try {
    await pagina.waitForFunction((f) => {
      const rx = new RegExp(f, 'i');
      return [...document.querySelectorAll('#avisos .aviso.exito')].some((n) => rx.test(n.innerText));
    }, fuente, { timeout: 30000 });
  } catch {
    const estado = await pagina.evaluate(() => ({
      avisos: [...document.querySelectorAll('#avisos .aviso')].map((n) => `${n.className}: ${n.innerText}`),
      modal: document.querySelector('.modal-cab h3')?.textContent || null,
      alertas: [...document.querySelectorAll('.modal-fondo .alerta-caja')].map((n) => n.innerText),
    }));
    throw new Error(`No apareció el aviso de éxito ${fuente}. Estado: ${JSON.stringify(estado)}`);
  }
  await limpiarAvisos();
}

const modal = () => pagina.locator('.modal-fondo').last();

/** Espera a que no quede ningún modal abierto (evita actuar sobre uno que se está cerrando). */
async function sinModales() {
  await pagina.waitForFunction(() => document.querySelectorAll('.modal-fondo').length === 0, null, { timeout: 45000 });
}

/** Abre un modal desde un botón, garantizando que no había otro abierto. */
async function abrirModal(selectorBoton) {
  await sinModales();
  await pagina.click(selectorBoton);
  await pagina.waitForSelector('.modal-fondo .modal-cuerpo');
}

/** Selecciona una opción esperando primero a que exista con esa etiqueta exacta. */
async function elegirOpcion(selectorSelect, etiqueta) {
  try {
    await pagina.waitForFunction(({ s, e }) => {
      const modales = document.querySelectorAll('.modal-fondo');
      const raiz = modales.length ? modales[modales.length - 1] : document;
      const sel = raiz.querySelector(s);
      return !!sel && [...sel.options].some((o) => o.textContent.trim() === e);
    }, { s: selectorSelect, e: etiqueta }, { timeout: 45000 });
  } catch (e) {
    const diagnostico = await pagina.evaluate((s) => {
      const modales = [...document.querySelectorAll('.modal-fondo')];
      const raiz = modales.length ? modales[modales.length - 1] : document;
      const sel = raiz.querySelector(s);
      return {
        modales: modales.length,
        titulo: raiz.querySelector?.('.modal-cab h3')?.textContent || null,
        opciones: sel ? [...sel.options].map((o) => o.textContent) : null,
      };
    }, selectorSelect);
    throw new Error(`No apareció la opción "${etiqueta}" en ${selectorSelect}. Estado: ${JSON.stringify(diagnostico)}`);
  }
  await modal().locator(selectorSelect).selectOption({ label: etiqueta });
}

test('preparación: navegador y servidor', async () => {
  const { chromium } = await cargarPlaywright();
  servidor = await arrancarServidor({ sembrar: true });
  dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dental-fotos-'));
  fs.writeFileSync(path.join(dirTmp, 'radiografia.png'), PNG_BYTES);
  fs.writeFileSync(path.join(dirTmp, 'intraoral.png'), PNG_BYTES);

  navegador = await chromium.launch({ args: ['--no-sandbox'] });
  const contexto = await navegador.newContext({ viewport: { width: 1360, height: 950 } });
  contexto.setDefaultTimeout(45000);
  pagina = await contexto.newPage();
  registrarVigilancia(pagina);
});

test('UI · Inicio de sesión y panel', async () => {
  await pagina.goto(`${servidor.base}/`, { waitUntil: 'networkidle' });
  await pagina.fill('input[name="email"]', 'admin@clinica.com');
  await pagina.fill('input[name="password"]', 'admin123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco', { timeout: 30000 });
  await pagina.waitForSelector('.kpi');
  assert.match(await pagina.locator('h2').first().innerText(), /Panel general/);
  assert.ok(await pagina.locator('a[href="#/configuracion"]').count(), 'el admin ve Configuración');
});

test('UI · Flujo 1: crear consultorio, cubículos y doctor', async () => {
  await pagina.click('a[href="#/configuracion"]');
  await pagina.waitForSelector('text=Consultorios y cubículos');

  // Consultorio
  await abrirModal('button:has-text("➕ Consultorio")');
  await modal().locator('input[name="nombre"]').fill(`Clínica UI ${sufijo}`);
  await modal().locator('input[name="direccion"]').fill('Av. de Pruebas 123');
  await modal().locator('input[name="ciudad"]').fill('Quito');
  await modal().locator('button:has-text("Crear consultorio")').click();
  await esperarExito(/Consultorio creado/);
  await pagina.waitForSelector(`text=Clínica UI ${sufijo}`);

  // Dos cubículos
  for (const nombre of ['Cubículo UI-1', 'Cubículo UI-2']) {
    await abrirModal('button:has-text("➕ Cubículo")');
    await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
    await modal().locator('input[name="nombre"]').fill(nombre);
    await modal().locator('button:has-text("Crear cubículo")').click();
    await esperarExito(/Cubículo creado/);
    await pagina.waitForSelector(`li:has-text("${nombre}")`);
  }

  // Doctor asignado a los dos cubículos nuevos
  await abrirModal('button:has-text("➕ Nuevo doctor")');
  await modal().locator('input[name="nombre"]').fill(`Dra. Prueba UI ${sufijo}`);
  await modal().locator('input[name="cedula"]').fill(`17${sufijo}99`);
  await modal().locator('input[name="especialidad"]').fill('Odontología general');
  for (const nombre of ['Cubículo UI-1', 'Cubículo UI-2']) {
    await modal().locator(`label:has-text("${nombre}") input[type="checkbox"]`).check();
  }
  await modal().locator('button:has-text("Crear doctor")').click();
  await esperarExito(/Doctor creado/);
  await pagina.waitForSelector(`td:has-text("Dra. Prueba UI ${sufijo}")`);

  const fila = pagina.locator('tr', { hasText: `Dra. Prueba UI ${sufijo}` }).first();
  assert.match(await fila.innerText(), /Cubículo UI-1/);
  assert.match(await fila.innerText(), new RegExp(`Clínica UI ${sufijo}`));
});

test('UI · Flujo 2: crear paciente con ficha completa', async () => {
  await pagina.click('a[href="#/pacientes"]');
  await pagina.waitForSelector('button:has-text("➕ Nuevo paciente")');
  await abrirModal('button:has-text("➕ Nuevo paciente")');

  const m = modal();
  await m.locator('input[name="nombre"]').fill('Beatriz');
  await m.locator('input[name="apellidos"]').fill(`Nájera UI${sufijo}`);
  await m.locator('input[name="cedula"]').fill(`09${sufijo}55`);
  await m.locator('input[name="telefono"]').fill('099-777-1234');
  await m.locator('input[name="email"]').fill('beatriz.najera@mail.com');
  await m.locator('input[name="fecha_nacimiento"]').fill('1987-03-21');
  await m.locator('select[name="sexo"]').selectOption('F');
  await m.locator('input[name="direccion"]').fill('Calle Prueba 456');
  await m.locator('textarea[name="alergias"]').fill('Alergia a la penicilina');
  await m.locator('textarea[name="medicamentos"]').fill('Levotiroxina 50mcg');
  await m.locator('textarea[name="antecedentes_medicos"]').fill('Hipotiroidismo controlado');
  await m.locator('textarea[name="antecedentes_odontologicos"]').fill('Ortodoncia 2015-2017');
  await m.locator('input[name="motivo_consulta"]').fill('Dolor en molar inferior izquierdo');
  await m.locator('button:has-text("Crear paciente")').click();
  await esperarExito(/creado/);

  await pagina.waitForSelector('h2:has-text("Beatriz")');
  ctx.pacienteUrl = pagina.url();
  ctx.pacienteId = Number(ctx.pacienteUrl.split('/').pop());
  assert.ok(Number.isInteger(ctx.pacienteId));
  assert.match(await pagina.locator('.alerta-caja.aviso').innerText(), /penicilina/i);
});

test('UI · Flujo 3: agendar cita y bloqueo de conflicto', async () => {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 5);
  const iso = fecha.toISOString().slice(0, 10);
  ctx.fechaCita = iso;

  await abrirModal('button:has-text("📅 Agendar cita")');
  let m = modal();
  await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
  await elegirOpcion('select[name="cubiculo_id"]', 'Cubículo UI-1');
  await elegirOpcion('select[name="doctor_id"]', `Dra. Prueba UI ${sufijo} — Odontología general`);
  await m.locator('input[name="fecha"]').fill(iso);
  await m.locator('input[name="hora_inicio"]').fill('10:00');
  await m.locator('input[name="hora_fin"]').fill('11:00');
  await m.locator('input[name="motivo"]').fill('Evaluación y diagnóstico inicial');
  await pagina.waitForSelector('.alerta-caja.ok:has-text("Horario disponible")');
  await m.locator('button:has-text("Agendar cita")').click();
  await esperarExito(/Cita agendada/);

  await pagina.waitForSelector('h2:has-text("Cita #")');
  ctx.citaUrl = pagina.url();
  ctx.citaId = Number(ctx.citaUrl.split('/').pop());

  // Intento de cita solapada desde la agenda → debe bloquearse.
  await pagina.click('a[href="#/agenda"]');
  await pagina.waitForSelector('button:has-text("➕ Nueva cita")');
  await abrirModal('button:has-text("➕ Nueva cita")');
  m = modal();
  await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
  await elegirOpcion('select[name="cubiculo_id"]', 'Cubículo UI-1');
  await elegirOpcion('select[name="doctor_id"]', `Dra. Prueba UI ${sufijo} — Odontología general`);
  await m.locator('input[name="fecha"]').fill(iso);
  await m.locator('input[name="hora_inicio"]').fill('10:30');
  await m.locator('input[name="hora_fin"]').fill('11:30');

  await pagina.waitForSelector('.alerta-caja:has-text("Conflicto de agenda")');
  const textoConflicto = await m.locator('.alerta-caja').innerText();
  assert.match(textoConflicto, /Conflicto de agenda/);
  assert.match(textoConflicto, /ya tienen? la cita #/);

  await m.locator('button:has-text("Agendar cita")').click();
  await pagina.waitForSelector('.aviso.error');
  assert.match(await pagina.locator('.aviso.error').last().innerText(), /choque de horario/i);
  assert.ok(await pagina.locator('.modal-fondo').count(), 'el modal permanece abierto tras el conflicto');
  await limpiarAvisos();
  await m.locator('button:has-text("Cancelar")').click();
  await pagina.waitForSelector('.modal-fondo', { state: 'detached' });

  // La cita creada aparece en la agenda por cubículo.
  await pagina.fill('input[name="fecha"]', iso);
  await pagina.waitForSelector('.bloque-cita:has-text("Beatriz")');
});

test('UI · Estados de cita: agendada → confirmada → en curso', async () => {
  await pagina.goto(ctx.citaUrl, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Cita #")');
  assert.match(await pagina.locator('.eti.agendada').first().innerText(), /Agendada/);

  await pagina.click('button:has-text("Confirmada")');
  await esperarExito(/Confirmada/i);
  await pagina.waitForSelector('.eti.confirmada');

  await pagina.click('button:has-text("En curso")');
  await esperarExito(/En curso/i);
  await pagina.waitForSelector('.eti.en_curso');
});

test('UI · Flujo 4: registrar tratamiento, subir 2 fotos y crear recordatorio', async () => {
  // Tratamiento (con consentimiento requerido, tomado del catálogo)
  await abrirModal('button:has-text("➕ Registrar")');
  let m = modal();
  const opcionEndodoncia = await m.locator('select[name="catalogo_id"] option')
    .evaluateAll((ops) => ops.find((o) => o.textContent.startsWith('Endodoncia unirradicular'))?.value);
  assert.ok(opcionEndodoncia, 'el catálogo debe ofrecer la endodoncia');
  await m.locator('select[name="catalogo_id"]').selectOption(opcionEndodoncia);
  await m.locator('input[name="dientes"]').fill('36');
  await m.locator('select[name="estado_diente"]').selectOption('endodoncia');
  await m.locator('textarea[name="notas_clinicas"]').fill('Conducto instrumentado y obturado. Control en 30 días.');
  await m.locator('button:has-text("Registrar tratamiento")').click();
  await esperarExito(/Tratamiento registrado/);
  await pagina.waitForSelector('td:has-text("Endodoncia unirradicular")');

  // Dos fotos
  await abrirModal('button:has-text("➕ Cargar fotos")');
  m = modal();
  await m.locator('input[type="file"]').setInputFiles([
    path.join(dirTmp, 'radiografia.png'),
    path.join(dirTmp, 'intraoral.png'),
  ]);
  await m.locator('select[name="tipo"]').selectOption('radiografia');
  await m.locator('input[name="descripcion"]').fill('Control posoperatorio');
  await m.locator('button:has-text("Subir imágenes")').click();
  await esperarExito(/2 imagen\(es\)/);
  await pagina.waitForSelector('.galeria figure');
  assert.equal(await pagina.locator('.galeria figure').count(), 2);

  // Las imágenes se cargan realmente (sin 404)
  const cargadas = await pagina.locator('.galeria img').evaluateAll(
    (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));
  assert.ok(cargadas, 'las imágenes deben renderizarse desde /uploads');

  // Recordatorio
  await abrirModal('.tarjeta:has-text("Recordatorios creados en la cita") button:has-text("➕ Nuevo")');
  m = modal();
  await m.locator('input[name="titulo"]').fill('Control de endodoncia a los 30 días');
  await m.locator('textarea[name="descripcion"]').fill('Revisar sintomatología y programar corona.');
  await m.locator('select[name="prioridad"]').selectOption('alta');
  await m.locator('button:has-text("Crear recordatorio")').click();
  await esperarExito(/Recordatorio creado/);
  await pagina.waitForSelector('li:has-text("Control de endodoncia")');
});

test('UI · Flujo 5: generar y firmar el consentimiento informado', async () => {
  await pagina.waitForSelector('button:has-text("✍️ Firmar ahora")');
  await abrirModal('button:has-text("✍️ Firmar ahora")');
  const m = modal();
  await pagina.waitForSelector('.consent-texto');

  const texto = await m.locator('.consent-texto').innerText();
  // innerText devuelve el texto ya renderizado y el CSS pone los títulos en mayúsculas.
  assert.match(texto, /Riesgos y complicaciones/i);
  assert.match(texto, /Alternativas de tratamiento/i);
  assert.match(texto, /Beatriz/);
  assert.match(texto, new RegExp(`Dra. Prueba UI ${sufijo}`));

  // Firma con trazo real sobre el lienzo.
  const lienzo = m.locator('canvas.firma-lienzo');
  const caja = await lienzo.boundingBox();
  await pagina.mouse.move(caja.x + 40, caja.y + 120);
  await pagina.mouse.down();
  await pagina.mouse.move(caja.x + 130, caja.y + 50, { steps: 12 });
  await pagina.mouse.move(caja.x + 220, caja.y + 140, { steps: 12 });
  await pagina.mouse.move(caja.x + 320, caja.y + 60, { steps: 12 });
  await pagina.mouse.up();

  await m.locator('#acepta_consent').check();
  await m.locator('input[name="firmante"]').fill(`Beatriz Nájera UI${sufijo}`);
  await m.locator('button:has-text("Firmar y archivar")').click();
  await esperarExito(/firmado y archivado/);

  await pagina.waitForSelector('button:has-text("✅ Ver firmado")');
  await abrirModal('button:has-text("✅ Ver firmado")');
  await pagina.waitForSelector('.alerta-caja.ok:has-text("Firmado por")');
  assert.ok(await modal().locator('img[alt="Firma del paciente"]').count(), 'se archiva la imagen de la firma');
  await modal().locator('button[aria-label="Cerrar"]').click();
  await pagina.waitForSelector('.modal-fondo', { state: 'detached' });
});

test('UI · Flujo 6: agendar la cita de seguimiento desde la misma cita', async () => {
  await abrirModal('button:has-text("➕ Agendar seguimiento")');
  const m = modal();
  await pagina.waitForSelector('.modal-cab:has-text("Agendar seguimiento")');

  const f = new Date();
  f.setDate(f.getDate() + 35);
  const iso = f.toISOString().slice(0, 10);
  await m.locator('input[name="fecha"]').fill(iso);
  await m.locator('input[name="hora_inicio"]').fill('09:00');
  await m.locator('input[name="hora_fin"]').fill('09:45');
  await pagina.waitForSelector('.alerta-caja.ok:has-text("Horario disponible")');
  await m.locator('button:has-text("Agendar cita")').click();
  await esperarExito(/Cita agendada/);

  await pagina.waitForSelector('.tarjeta:has-text("Próxima cita derivada") li');
  const seg = await pagina.locator('.tarjeta:has-text("Próxima cita derivada")').innerText();
  assert.match(seg, /Seguimiento de/);

  // Completar la cita
  await pagina.click('button:has-text("Completada")');
  await esperarExito(/Completada/i);
  await pagina.waitForSelector('.eti.completada');
});

test('UI · Flujo 7: cobro del tratamiento, gasto y balance', async () => {
  // El cargo se generó solo; se cobra desde la cita.
  await pagina.waitForSelector('.tarjeta:has-text("Cobros de esta cita") td:has-text("Endodoncia")');
  await abrirModal('.tarjeta:has-text("Cobros de esta cita") button:has-text("Cobrar")');
  let m = modal();
  await m.locator('input[name="monto"]').fill('120');
  await m.locator('select[name="metodo"]').selectOption('tarjeta');
  await m.locator('input[name="nota"]').fill('Abono inicial');
  await m.locator('button:has-text("Registrar pago")').click();
  await esperarExito(/Pago registrado/);

  const cobros = await pagina.locator('.tarjeta:has-text("Cobros de esta cita")').innerText();
  assert.match(cobros, /\$120\.00/);
  assert.match(cobros, /\$100\.00/, 'saldo pendiente = 220 − 120');

  // Gasto del consultorio
  await pagina.click('a[href="#/contabilidad"]');
  await pagina.waitForSelector('button:has-text("🧾 Registrar gasto")');
  await abrirModal('button:has-text("🧾 Registrar gasto")');
  m = modal();
  await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
  await m.locator('select[name="categoria"]').selectOption('insumos');
  await m.locator('input[name="concepto"]').fill('Limas rotatorias y gutapercha');
  await m.locator('input[name="proveedor"]').fill('Depósito Dental Andino');
  await m.locator('input[name="monto"]').fill('80');
  await m.locator('button:has-text("Registrar gasto")').click();
  await esperarExito(/Gasto registrado/);

  // Balance del consultorio nuevo: ingresos 120, gastos 80, balance 40.
  await pagina.selectOption('select[name="consultorio_id"]', { label: `Clínica UI ${sufijo}` });
  // El filtro recarga de forma asíncrona: esperamos a que el resumen quede acotado a esa sede.
  await pagina.waitForFunction((nombre) => {
    const tarjeta = [...document.querySelectorAll('.tarjeta')]
      .find((t) => t.querySelector('h3')?.textContent.includes('Resumen por consultorio'));
    const filas = tarjeta ? [...tarjeta.querySelectorAll('tbody tr')] : [];
    return filas.length === 1 && filas[0].textContent.includes(nombre);
  }, `Clínica UI ${sufijo}`, { timeout: 30000 });
  const kpis = await pagina.locator('.rejilla.c4').first().innerText();
  assert.match(kpis, /\$120\.00/, 'ingresos del período');
  assert.match(kpis, /\$80\.00/, 'gastos del período');
  assert.match(kpis, /\$40\.00/, 'balance = 120 − 80');

  const porConsultorio = await pagina.locator('.tarjeta:has-text("Resumen por consultorio")').innerText();
  assert.match(porConsultorio, new RegExp(`Clínica UI ${sufijo}`));

  const deudores = await pagina.locator('.tarjeta:has-text("saldo pendiente")').innerText();
  assert.match(deudores, /Nájera/);
});

test('UI · Flujo 8: buscar al paciente y verificar el expediente completo', async () => {
  await pagina.click('a[href="#/pacientes"]');
  await pagina.waitForSelector('input[name="q"]');
  await pagina.fill('input[name="q"]', `09${sufijo}55`);
  await pagina.waitForSelector('td a:has-text("Nájera")');
  await pagina.click('td a:has-text("Nájera")');
  await pagina.waitForSelector('h2:has-text("Beatriz")');

  await verificarExpediente();

  // Recarga completa: la persistencia debe conservarlo todo.
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Beatriz")');
  await verificarExpediente();
});

async function verificarExpediente() {
  // Ficha + próxima cita
  await pagina.click('button:has-text("📋 Ficha")');
  const ficha = await pagina.locator('.contenido').innerText();
  assert.match(ficha, /Hipotiroidismo controlado/);
  assert.match(ficha, /Levotiroxina/);
  assert.match(ficha, /Próxima cita/);

  // Historial cronológico
  await pagina.click('button:has-text("🕒 Historial")');
  await pagina.waitForSelector('.linea .item');
  const items = await pagina.locator('.linea .item').count();
  assert.ok(items >= 6, `la cronología debe tener varias entradas (tiene ${items})`);
  const historial = await pagina.locator('.linea').innerText();
  for (const esperado of [/tratamiento/, /consentimiento/, /foto/, /cita/]) {
    assert.match(historial, esperado);
  }

  // Tratamientos
  await pagina.click('button:has-text("🦷 Tratamientos")');
  await pagina.waitForSelector('td:has-text("Endodoncia unirradicular")');

  // Fotos
  await pagina.click('button:has-text("🖼️ Imágenes")');
  await pagina.waitForSelector('.galeria figure');
  assert.equal(await pagina.locator('.galeria figure').count(), 2);

  // Consentimiento firmado
  await pagina.click('button:has-text("📝 Consentimientos")');
  await pagina.waitForSelector('.eti.firmado');

  // Recordatorios
  await pagina.click('button:has-text("🔔 Recordatorios")');
  await pagina.waitForSelector('li:has-text("Control de endodoncia")');

  // Odontograma con la pieza 36 marcada
  await pagina.click('button:has-text("🪥 Odontograma")');
  await pagina.waitForSelector('.diente.endodoncia');
  assert.match(await pagina.locator('.diente.endodoncia').first().getAttribute('title'), /36/);

  // Estado de cuenta
  await pagina.click('button:has-text("💰 Estado de cuenta")');
  await pagina.waitForSelector('.kpi');
  const cuenta = await pagina.locator('.contenido').innerText();
  assert.match(cuenta, /\$220\.00/, 'total facturado');
  assert.match(cuenta, /\$120\.00/, 'total abonado');
  assert.match(cuenta, /\$100\.00/, 'saldo pendiente');
}

test('UI · Roles: recepción y doctor ven solo lo que les corresponde', async () => {
  // Recepción
  await pagina.click('.usuario-caja button');
  await pagina.waitForSelector('.login-caja');
  await pagina.fill('input[name="email"]', 'recepcion@clinica.com');
  await pagina.fill('input[name="password"]', 'recepcion123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco');
  assert.equal(await pagina.locator('a[href="#/configuracion"]').count(), 0, 'recepción no ve Configuración');
  assert.equal(await pagina.locator('a[href="#/contabilidad"]').count(), 1, 'recepción sí ve Contabilidad');

  await pagina.goto(`${servidor.base}/#/cita/${ctx.citaId}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Cita #")');
  assert.equal(
    await pagina.locator('.tarjeta:has-text("Tratamientos de esta cita") button:has-text("➕ Registrar")').count(), 0,
    'recepción no puede registrar tratamientos');
  assert.equal(await pagina.locator('.tarjeta:has-text("Cobros de esta cita") button:has-text("➕ Registrar pago")').count(), 1,
    'recepción sí puede registrar pagos');

  // Doctor
  await pagina.click('.usuario-caja button');
  await pagina.waitForSelector('.login-caja');
  await pagina.fill('input[name="email"]', 'ana.morales@clinica.com');
  await pagina.fill('input[name="password"]', 'doctor123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco');
  assert.equal(await pagina.locator('a[href="#/contabilidad"]').count(), 0, 'el doctor no ve Contabilidad');
  assert.equal(await pagina.locator('a[href="#/pacientes"]').count(), 1);
});

test('UI · Agenda: las tres agrupaciones y las vistas día/semana renderizan', async () => {
  await pagina.click('a[href="#/agenda"]');
  await pagina.waitForSelector('.agenda-tabla');
  await pagina.fill('input[name="fecha"]', ctx.fechaCita);

  for (const agrupar of ['cubiculo', 'doctor', 'consultorio']) {
    for (const vista of ['dia', 'semana']) {
      await pagina.selectOption('select[name="agrupar"]', agrupar);
      await pagina.selectOption('select[name="vista"]', vista);
      await pagina.waitForSelector('.agenda-tabla thead th');
      const columnas = await pagina.locator('.agenda-tabla thead th').count();
      assert.ok(columnas > 1, `${vista}/${agrupar} debe tener columnas (tiene ${columnas})`);
    }
  }
  await pagina.selectOption('select[name="vista"]', 'dia');
  await pagina.selectOption('select[name="agrupar"]', 'cubiculo');
  await pagina.waitForSelector('.bloque-cita');
});

test('UI · Vista de tablet (820×1180) sin desbordamiento horizontal', async () => {
  const contexto = await navegador.newContext({
    viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false,
  });
  const tablet = await contexto.newPage();
  registrarVigilancia(tablet);
  await tablet.goto(`${servidor.base}/`, { waitUntil: 'networkidle' });
  await tablet.fill('input[name="email"]', 'admin@clinica.com');
  await tablet.fill('input[name="password"]', 'admin123');
  await tablet.click('button[type="submit"]');
  await tablet.waitForSelector('.marco');

  for (const ruta of ['#/panel', '#/agenda', '#/pacientes', '#/contabilidad', '#/configuracion']) {
    await tablet.goto(`${servidor.base}/${ruta}`, { waitUntil: 'networkidle' });
    await tablet.waitForSelector('.contenido h2');
    const desborde = await tablet.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(desborde <= 2, `${ruta} desborda ${desborde}px en horizontal`);
  }
  await contexto.close();
});

test('Cero errores de consola y cero excepciones en toda la sesión', async () => {
  assert.deepEqual(erroresConsola, [],
    `se detectaron errores en el navegador:\n${erroresConsola.join('\n')}`);
  const delServidor = servidor.errores();
  assert.deepEqual(delServidor, [], `el servidor registró errores:\n${delServidor.join('\n')}`);
});

test('limpieza', async () => {
  if (navegador) await navegador.close();
  if (servidor) await servidor.detener();
  if (dirTmp) fs.rmSync(dirTmp, { recursive: true, force: true });
});
