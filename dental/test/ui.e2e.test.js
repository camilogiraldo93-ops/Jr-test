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

/** La fecha de hoy en el formato que usan los campos <input type="date">. */
function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  // Lo primero que se ve es la página del día, como una agenda de papel.
  await pagina.waitForSelector('.hoja-dia');
  assert.match(await pagina.locator('h2').first().innerText(), /hoy/i);
  assert.ok(await pagina.locator('.renglon-hora').count() > 10, 'la hoja del día lista las horas');
  assert.ok(await pagina.locator('.buscador-global input').count(), 'el buscador de pacientes está siempre visible');

  await pagina.click('a[href="#/panel"]');
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
  await m.locator('button:has-text("Llenar más datos ahora")').click();
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
  await esperarExito(/ya está en la lista/);

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
  await esperarExito(/quedó agendada/);

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

  await pagina.waitForSelector('.alerta-caja:has-text("ya está ocupada")');
  const textoConflicto = await m.locator('.alerta-caja').innerText();
  assert.match(textoConflicto, /ya está ocupada/);
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

test('UI · Agendar eligiendo el tratamiento previsto del catálogo', async () => {
  await pagina.click('a[href="#/agenda"]');
  await pagina.waitForSelector('button:has-text("➕ Nueva cita")');
  await abrirModal('button:has-text("➕ Nueva cita")');
  const m = modal();

  await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
  await elegirOpcion('select[name="cubiculo_id"]', 'Cubículo UI-1');
  await elegirOpcion('select[name="doctor_id"]', `Dra. Prueba UI ${sufijo} — Odontología general`);
  await m.locator('input[name="fecha"]').fill(ctx.fechaCita);
  await m.locator('input[name="hora_inicio"]').fill('14:00');

  const opcionImplante = await m.locator('select[name="catalogo_id"] option')
    .evaluateAll((ops) => ops.find((o) => o.textContent.startsWith('Implante dental'))?.value);
  assert.ok(opcionImplante, 'el catálogo debe ofrecer el implante al agendar');
  await m.locator('select[name="catalogo_id"]').selectOption(opcionImplante);

  // La duración del catálogo (120 min) fija la hora de fin y el motivo se sugiere.
  await pagina.waitForFunction(() =>
    document.querySelector('.modal-fondo input[name="hora_fin"]').value === '16:00');
  assert.equal(await m.locator('input[name="motivo"]').inputValue(), 'Implante dental');
  assert.match(await m.locator('.alerta-caja.aviso').innerText(), /consentimiento informado/i);

  await pagina.waitForSelector('.alerta-caja.ok:has-text("Horario disponible")');
  await m.locator('button:has-text("Agendar cita")').click();
  await esperarExito(/quedó agendada/);

  // Agendar desde la agenda deja en la agenda: la cita se abre desde su bloque.
  await pagina.fill('input[name="fecha"]', ctx.fechaCita);
  await pagina.click('.bloque-cita:has-text("Implante dental")');

  // La cita abierta muestra el tratamiento previsto y su advertencia.
  await pagina.waitForSelector('h2:has-text("Cita #")');
  const previsto = pagina.locator('.tarjeta:has-text("Estado de la cita")');
  assert.match(await previsto.innerText(), /Tratamiento previsto:\s*Implante dental/);
  assert.match(await previsto.innerText(), /requiere consentimiento/i);

  // Y al registrarlo durante la atención, el modal se abre ya con él elegido.
  await pagina.click('button:has-text("En curso")');
  await esperarExito(/En curso/i);
  await pagina.waitForSelector('.eti.en_curso');
  await abrirModal('.tarjeta:has-text("Lo que se hizo en esta cita") button:has-text("➕ Anotar lo que se hizo")');
  assert.equal(await modal().locator('input[name="nombre"]').inputValue(), 'Implante dental');
  assert.equal(await modal().locator('select[name="catalogo_id"]').inputValue(), opcionImplante);
  await modal().locator('button:has-text("Cancelar")').click();
  await sinModales();
});

test('UI · Ningún botón muerto: «El paciente llegó» abre la atención y deja anotar', async () => {
  await pagina.goto(ctx.citaUrl, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Cita #")');
  assert.match(await pagina.locator('.eti.agendada').first().innerText(), /Agendada/);

  const tarjeta = '.tarjeta:has-text("Lo que se hizo en esta cita")';
  const btnLlego = pagina.locator(`${tarjeta} button:has-text("El paciente llegó")`);
  assert.equal(await btnLlego.count(), 1, 'con la cita agendada se ofrece empezar la atención');
  assert.equal(await btnLlego.isDisabled(), false, 'y el botón responde: no hay botones muertos');
  assert.match(await pagina.locator(`${tarjeta} .alerta-caja`).innerText(), /El paciente llegó/);

  // Un solo clic: abre la atención y deja el formulario de anotación listo.
  await btnLlego.click();
  await pagina.waitForSelector('.modal-fondo .modal-cuerpo');
  assert.match(await modal().locator('.modal-cab h3, h3').first().innerText(), /Anotar lo que se hizo/i);
  await modal().locator('button:has-text("Cancelar")').click();
  await sinModales();
  await pagina.waitForSelector('.eti.en_curso');
  await limpiarAvisos();

  // Ya en atención, el botón pasa a ser el de anotar.
  assert.equal(await pagina.locator(`${tarjeta} button:has-text("➕ Anotar lo que se hizo")`).count(), 1);
});

test('UI · Flujo 4: registrar tratamiento, subir 2 fotos y crear recordatorio', async () => {
  // Tratamiento (con consentimiento requerido, tomado del catálogo)
  await abrirModal('button:has-text("➕ Anotar lo que se hizo")');
  let m = modal();
  const opcionEndodoncia = await m.locator('select[name="catalogo_id"] option')
    .evaluateAll((ops) => ops.find((o) => o.textContent.startsWith('Endodoncia unirradicular'))?.value);
  assert.ok(opcionEndodoncia, 'el catálogo debe ofrecer la endodoncia');
  await m.locator('select[name="catalogo_id"]').selectOption(opcionEndodoncia);
  await m.locator('input[name="dientes"]').fill('36');
  await m.locator('select[name="estado_diente"]').selectOption('endodoncia');
  await m.locator('textarea[name="notas_clinicas"]').fill('Conducto instrumentado y obturado. Control en 30 días.');
  await m.locator('button:has-text("Guardar")').click();
  await esperarExito(/quedó anotado/);
  await pagina.waitForSelector('td:has-text("Endodoncia unirradicular")');

  // Dos fotos
  await abrirModal('button:has-text("➕ Subir radiografías o fotos")');
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

  // Las imágenes se cargan realmente (sin 404). Se espera a que terminen de
  // descargarse: recién insertadas en el DOM todavía no tienen dimensiones.
  await pagina.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.galeria img')];
    return imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, null, { timeout: 30000 }).catch(() => {
    throw new Error('las imágenes no se renderizaron desde /uploads');
  });

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

test('UI · Flujo 5: documento autocompletado y doble firma en pantalla', async () => {
  await pagina.waitForSelector('a:has-text("✍️ Firmar ahora")');
  await pagina.click('a:has-text("✍️ Firmar ahora")');
  await pagina.waitForSelector('.documento');
  ctx.consentUrl = pagina.url();

  // El documento se autocompleta: solo tres campos son editables.
  const texto = await pagina.locator('.documento').innerText();
  assert.match(texto, /CONSENTIMIENTO INFORMADO PARA TRATAMIENTO ODONTOLÓGICO/i);
  assert.match(texto, new RegExp(`Clínica UI ${sufijo}`), 'nombre del consultorio');
  assert.match(texto, /Av. de Pruebas 123/, 'dirección del consultorio');
  assert.match(texto, /Beatriz/, 'nombre del paciente');
  assert.match(texto, new RegExp(`09${sufijo}55`), 'cédula del paciente');
  assert.match(texto, new RegExp(`Dra. Prueba UI ${sufijo}`), 'doctor');
  assert.match(texto, /Endodoncia unirradicular/, 'tratamiento');
  assert.match(texto, /AUTORIZO/);
  assert.match(texto, /registro fotográfico y radiográfico/);

  const editables = await pagina.locator('.tarjeta:has-text("Datos del documento") input, .tarjeta:has-text("Datos del documento") select, .tarjeta:has-text("Datos del documento") textarea').count();
  assert.equal(editables, 4, 'catálogo + tratamiento + doctor + observaciones');

  // Se completa el tercer campo manual.
  await pagina.fill('textarea[name="observaciones"]', 'Paciente refiere alergia a la penicilina.');
  await pagina.click('button:has-text("💾 Guardar cambios")');
  await esperarExito(/actualizados/);
  await pagina.waitForSelector('.documento:has-text("alergia a la penicilina")');

  // Firmar exige AMBAS firmas.
  const lienzos = pagina.locator('canvas.firma-lienzo');
  assert.equal(await lienzos.count(), 2, 'hay lienzo de paciente y de doctor');

  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await pagina.waitForSelector('.aviso.error');
  assert.match(await pagina.locator('.aviso.error').last().innerText(), /Falta la firma del paciente/);
  await limpiarAvisos();

  await trazar(lienzos.nth(0));
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await pagina.waitForSelector('.aviso.error');
  assert.match(await pagina.locator('.aviso.error').last().innerText(), /Falta la firma del doctor/);
  await limpiarAvisos();

  await trazar(lienzos.nth(1));
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await esperarExito(/firmado y archivado/);

  // Documento firmado: inmutable, con ambas firmas visibles.
  await pagina.waitForSelector('.alerta-caja.ok:has-text("Documento firmado")');
  assert.equal(await pagina.locator('.firmas .firma-img').count(), 2, 'se archivan las dos firmas');
  assert.equal(await pagina.locator('.tarjeta:has-text("Datos del documento")').count(), 0,
    'ya no se puede editar');
  assert.equal(await pagina.locator('canvas.firma-lienzo').count(), 0, 'ya no se puede volver a firmar');
  const pie = await pagina.locator('.firmas').innerText();
  assert.match(pie, /Firma del paciente/);
  assert.match(pie, /Firma del doctor/);
});

/** Dibuja un trazo real sobre un lienzo de firma. */
async function trazar(lienzo) {
  await lienzo.scrollIntoViewIfNeeded();
  const caja = await lienzo.boundingBox();
  await pagina.mouse.move(caja.x + 40, caja.y + caja.height * 0.7);
  await pagina.mouse.down();
  await pagina.mouse.move(caja.x + caja.width * 0.3, caja.y + caja.height * 0.3, { steps: 12 });
  await pagina.mouse.move(caja.x + caja.width * 0.55, caja.y + caja.height * 0.75, { steps: 12 });
  await pagina.mouse.move(caja.x + caja.width * 0.8, caja.y + caja.height * 0.35, { steps: 12 });
  await pagina.mouse.up();
}

test('UI · Modo tablet e impresión del consentimiento', async () => {
  await pagina.goto(ctx.consentUrl, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.documento');

  await pagina.click('button:has-text("🖥️ Modo tablet")');
  assert.equal(await pagina.locator('.lateral').isVisible(), false, 'el menú lateral se oculta');
  assert.equal(await pagina.locator('.documento').isVisible(), true, 'el documento sigue visible y grande');
  // En modo tablet la única salida es el control flotante.
  const salir = pagina.locator('button:has-text("Salir del modo tablet")');
  assert.equal(await salir.isVisible(), true, 'siempre debe haber forma de volver');
  await salir.click();
  await pagina.waitForSelector('.lateral', { state: 'visible' });

  await pagina.click('a:has-text("🖨️ Imprimir / PDF")');
  await pagina.waitForSelector('.vista-impresion .documento');
  const impreso = await pagina.locator('.hoja').innerText();
  assert.match(impreso, /CONSENTIMIENTO INFORMADO/i);
  assert.match(impreso, /Firma del paciente/);
  assert.equal(await pagina.locator('.hoja .firma-img').count(), 2, 'el PDF incluye las firmas');
  assert.equal(await pagina.locator('.sello-borrador').count(), 0, 'un firmado no lleva sello de borrador');
});

test('UI · Flujo 6: agendar la cita de seguimiento desde la misma cita', async () => {
  await pagina.goto(ctx.citaUrl, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Cita #")');
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
  await esperarExito(/quedó agendada/);

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
  await esperarExito(/pago quedó registrado/);

  const cobros = await pagina.locator('.tarjeta:has-text("Cobros de esta cita")').innerText();
  assert.match(cobros, /\$120\.00/);
  assert.match(cobros, /\$100\.00/, 'saldo pendiente = 220 − 120');

  // Gasto del consultorio
  await pagina.click('a[href="#/contabilidad"]');
  await pagina.waitForSelector('button:has-text("🧾 Apuntar gasto")');
  await abrirModal('button:has-text("🧾 Apuntar gasto")');
  m = modal();
  // Lo de todos los días son tres campos; el resto vive tras «Más opciones».
  assert.equal(await m.locator('select[name="consultorio_id"]').isVisible(), false,
    'el gasto se apunta con tres campos a la vista');
  await m.locator('input[name="concepto"]').fill('Limas rotatorias y gutapercha');
  await m.locator('input[name="monto"]').fill('80');
  assert.equal(await m.locator('input[name="fecha"]').inputValue(), hoyIso(),
    'la fecha viene puesta en hoy');

  await m.locator('button:has-text("Más opciones")').click();
  await elegirOpcion('select[name="consultorio_id"]', `Clínica UI ${sufijo}`);
  await m.locator('select[name="categoria"]').selectOption('insumos');
  await m.locator('input[name="proveedor"]').fill('Depósito Dental Andino');
  await m.locator('button:has-text("Apuntar gasto")').last().click();
  await esperarExito(/quedó apuntado el gasto/);

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

test('UI · B2: todas las pestañas del expediente cambian el contenido', async () => {
  await pagina.goto(ctx.pacienteUrl, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.pestanas button');
  const pestanas = await pagina.locator('.pestanas button').allInnerTexts();
  assert.ok(pestanas.length >= 8, `hay ${pestanas.length} pestañas`);

  const vistos = new Set();
  for (const nombre of pestanas) {
    await pagina.locator('.pestanas button', { hasText: nombre }).first().click();
    await pagina.waitForFunction((n) => {
      const activa = document.querySelector('.pestanas button.activo');
      return activa && activa.innerText === n;
    }, nombre, { timeout: 10000 });
    // Cada pestaña, incluso vacía, muestra su propio encabezado.
    const titulo = await pagina.locator('.contenido .tarjeta h3').first().innerText();
    assert.ok(titulo.trim().length > 0, `la pestaña "${nombre}" debe mostrar un encabezado`);
    assert.ok(!vistos.has(titulo) || nombre.includes('Ficha'),
      `la pestaña "${nombre}" muestra un contenido distinto (título: "${titulo}")`);
    vistos.add(titulo);
  }
  assert.ok(vistos.size >= 6, `los paneles son distintos entre sí (${vistos.size} títulos únicos)`);
});

test('UI · Consentimiento manual desde el expediente, sin cita', async () => {
  await pagina.goto(ctx.pacienteUrl, { waitUntil: 'networkidle' });
  await pagina.click('button:has-text("📝 Consentimientos")');
  await pagina.waitForSelector('.tarjeta:has-text("Consentimientos informados")');

  await abrirModal('button:has-text("➕ Nuevo consentimiento")');
  await modal().locator('input[name="tratamiento"]').fill('Blanqueamiento dental en consultorio');
  await modal().locator('textarea[name="observaciones"]').fill('Se advierte sensibilidad transitoria.');
  await modal().locator('button:has-text("Generar consentimiento")').click();
  await esperarExito(/Complétalo y fírmalo/);

  await pagina.waitForSelector('.documento');
  const texto = await pagina.locator('.documento').innerText();
  assert.match(texto, /Blanqueamiento dental en consultorio/);
  assert.match(texto, /Beatriz/);
  assert.equal(await pagina.locator('.eti.pendiente').count() > 0, true, 'nace pendiente de firma');
  ctx.consentManualUrl = pagina.url();

  // Vuelve al expediente y aparece listado con su cita vacía.
  await pagina.goto(ctx.pacienteUrl, { waitUntil: 'networkidle' });
  await pagina.click('button:has-text("📝 Consentimientos")');
  await pagina.waitForSelector('td:has-text("Blanqueamiento dental en consultorio")');
  const fila = await pagina.locator('tr', { hasText: 'Blanqueamiento dental en consultorio' }).innerText();
  assert.match(fila, /Sin cita/);
});

test('UI · Paciente menor de edad: el documento pide representante legal', async () => {
  const anio = new Date().getFullYear() - 8;
  await pagina.goto(`${servidor.base}/#/pacientes`, { waitUntil: 'networkidle' });
  await abrirModal('button:has-text("➕ Nuevo paciente")');
  await modal().locator('input[name="nombre"]').fill('Tomás');
  await modal().locator('input[name="apellidos"]').fill(`Vera UI${sufijo}`);
  await modal().locator('input[name="telefono"]').fill('099-555-0102');
  await modal().locator('button:has-text("Llenar más datos ahora")').click();
  await modal().locator('input[name="cedula"]').fill(`08${sufijo}11`);
  await modal().locator('input[name="fecha_nacimiento"]').fill(`${anio}-04-02`);
  await modal().locator('button:has-text("Crear paciente")').click();
  await esperarExito(/ya está en la lista/);
  await pagina.waitForSelector('h2:has-text("Tomás")');

  await pagina.click('button:has-text("📝 Consentimientos")');
  await abrirModal('button:has-text("➕ Nuevo consentimiento")');
  await modal().locator('input[name="tratamiento"]').fill('Sellantes de fosas y fisuras');
  await modal().locator('button:has-text("Generar consentimiento")').click();
  await esperarExito(/Complétalo y fírmalo/);
  await pagina.waitForSelector('.documento');

  assert.match(await pagina.locator('.alerta-caja.aviso').first().innerText(), /menor de edad/);
  await pagina.waitForSelector('.tarjeta:has-text("Representante legal")');
  const texto = await pagina.locator('.documento').innerText();
  assert.match(texto, /mi representado\/a requiere el siguiente tratamiento/);

  // Sin la cédula del representante no deja firmar.
  const lienzos = pagina.locator('canvas.firma-lienzo');
  await trazar(lienzos.nth(0));
  await trazar(lienzos.nth(1));
  await pagina.fill('input[name="firma_paciente_nombre"]', 'Lucía Vera Andrade');
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await pagina.waitForSelector('.aviso.error');
  assert.match(await pagina.locator('.aviso.error').last().innerText(), /cédula del representante/i);
  await limpiarAvisos();

  await pagina.fill('input[name="representante_cedula"]', '1712000999');
  await pagina.selectOption('select[name="representante_parentesco"]', 'madre');
  await pagina.click('button:has-text("✍️ Firmar y archivar")');
  await esperarExito(/firmado y archivado/);

  const firmas = await pagina.locator('.firmas').innerText();
  assert.match(firmas, /Firma del representante legal/);
  assert.match(firmas, /Lucía Vera Andrade/);
  assert.match(firmas, /1712000999/);
  assert.match(firmas, /madre de Tomás/);
});

test('UI · Anulación de un consentimiento firmado, con reemplazo', async () => {
  await pagina.click('button:has-text("⛔ Anular y generar reemplazo")');
  await pagina.waitForSelector('.modal-fondo');
  await modal().locator('textarea[name="motivo"]').fill('Se cambió el tratamiento acordado con la madre.');
  await modal().locator('button:has-text("Anular")').click();
  await esperarExito(/anulado/);

  await pagina.waitForSelector('.documento');
  assert.match(await pagina.locator('.alerta-caja.aviso').first().innerText(), /reemplaza a uno anulado/);
  const enlaceAnterior = pagina.locator('a:has-text("Ver el anterior")');
  assert.equal(await enlaceAnterior.count(), 1);
  await enlaceAnterior.click();
  await pagina.waitForSelector('.alerta-caja:has-text("Consentimiento anulado")');
  const aviso = await pagina.locator('.alerta-caja').first().innerText();
  assert.match(aviso, /Se cambió el tratamiento/);
  assert.match(aviso, /anulado por Administrador/);
});

test('UI · Impresión del expediente y de la cita', async () => {
  await pagina.goto(`${servidor.base}/#/imprimir/expediente/${ctx.pacienteId}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.vista-impresion .hoja');
  const expediente = await pagina.locator('.hoja').innerText();
  assert.match(expediente, /Expediente clínico/);
  assert.match(expediente, /Beatriz/);
  assert.match(expediente, /Historia médica/i);
  assert.match(expediente, /Endodoncia unirradicular/);
  assert.match(expediente, /Estado de cuenta/i);
  assert.equal(await pagina.locator('.lateral').isVisible(), true, 'la barra lateral sigue en pantalla');
  assert.ok(await pagina.locator('button:has-text("Imprimir / Guardar PDF")').count());

  await pagina.goto(`${servidor.base}/#/imprimir/cita/${ctx.citaId}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.vista-impresion .hoja');
  const cita = await pagina.locator('.hoja').innerText();
  assert.match(cita, new RegExp(`Resumen de la cita #${ctx.citaId}`));
  assert.match(cita, /Tratamientos realizados/i);
  assert.match(cita, /Cobros/i);
  assert.match(cita, /Firma del doctor/);
});

test('UI · Contabilidad: ingresos por doctor, por método y exportación CSV', async () => {
  await pagina.goto(`${servidor.base}/#/contabilidad`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.kpi');

  await pagina.waitForSelector('.tarjeta:has-text("Ingresos por doctor")');
  const porDoctor = await pagina.locator('.tarjeta:has-text("Ingresos por doctor")').innerText();
  assert.match(porDoctor, new RegExp(`Dra. Prueba UI ${sufijo}`), 'atribuye el cobro a su doctora');
  assert.match(porDoctor, /\$120\.00/);

  const porMetodo = await pagina.locator('.tarjeta:has-text("Ingresos por método de pago")').innerText();
  assert.match(porMetodo, /tarjeta/);

  // La descarga del CSV se intercepta para comprobar su contenido real.
  const [descarga] = await Promise.all([
    pagina.waitForEvent('download'),
    pagina.click('button:has-text("Exportar cobros a Excel")'),
  ]);
  const ruta = await descarga.path();
  const csv = fs.readFileSync(ruta, 'utf8');
  assert.match(descarga.suggestedFilename(), /^pagos_.*\.csv$/);
  assert.match(csv, /Fecha;Paciente;Metodo;Nota;Monto/);
  assert.match(csv, /Nájera/);
  assert.match(csv, /tarjeta/);

  const [descargaGastos] = await Promise.all([
    pagina.waitForEvent('download'),
    pagina.click('button:has-text("Exportar gastos a Excel")'),
  ]);
  const csvGastos = fs.readFileSync(await descargaGastos.path(), 'utf8');
  assert.match(csvGastos, /Fecha;Consultorio;Categoria;Concepto;Proveedor;Monto/);
  assert.match(csvGastos, /Limas rotatorias/);
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

test('UI · Roles: recepción y doctor ven solo lo que les corresponde', async () => {
  // Recepción
  await pagina.click('.usuario-caja button');
  await pagina.waitForSelector('.login-caja');
  await pagina.fill('input[name="email"]', 'recepcion@clinica.com');
  await pagina.fill('input[name="password"]', 'recepcion123');
  await pagina.click('button[type="submit"]');
  await pagina.waitForSelector('.marco');
  assert.equal(await pagina.locator('a[href="#/configuracion"]').count(), 0, 'recepción no ve Configuración');
  assert.equal(await pagina.locator('a[href="#/contabilidad"]').count(), 0, 'recepción no ve Contabilidad');
  assert.equal(await pagina.locator('a[href="#/pacientes"]').count(), 1, 'recepción sí ve Pacientes');

  await pagina.goto(`${servidor.base}/#/cita/${ctx.citaId}`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('h2:has-text("Cita #")');
  assert.equal(
    await pagina.locator('.tarjeta:has-text("Lo que se hizo en esta cita") button:has-text("➕ Anotar lo que se hizo")').count(), 0,
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
  assert.equal(await pagina.locator('a[href="#/configuracion"]').count(), 0, 'ni Configuración');
  assert.equal(await pagina.locator('a[href="#/pacientes"]').count(), 1);

  // La agenda del doctor solo muestra sus propias citas.
  await pagina.goto(`${servidor.base}/#/agenda`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.agenda-tabla');
  await pagina.selectOption('select[name="agrupar"]', 'doctor');
  await pagina.waitForFunction(() => document.querySelectorAll('.agenda-tabla thead th').length === 2);
  const columnas = await pagina.locator('.agenda-tabla thead th').allInnerTexts();
  assert.equal(columnas.length, 2, 'solo la columna de horas y la suya');
  assert.match(columnas[1], /Ana Morales/);

  // Y su lista de pacientes se limita a los que atiende.
  await pagina.goto(`${servidor.base}/#/pacientes`, { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.tarjeta');
  const suyos = await pagina.locator('table.tabla tbody tr').count();
  assert.ok(suyos >= 1, 've a sus pacientes');
  const textoPacientes = await pagina.locator('.contenido').innerText();
  assert.ok(!textoPacientes.includes('Nájera'),
    'no ve a la paciente de otra doctora');
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
