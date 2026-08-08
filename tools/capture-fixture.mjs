/**
 * Captura las respuestas REALES de Open-Meteo que la app pide en una carga y las
 * guarda como fixture.
 *
 * Para qué sirve: permite verificar el renderizado completo de la interfaz en un
 * navegador de verdad (tools/render-check.mjs) desde un entorno sin salida a
 * internet, sin inventar datos. El fixture NO alimenta la app en producción; la
 * app siempre consulta la API en vivo.
 *
 * Las URLs se construyen con los mismos exportadores que usa el navegador
 * (sources.js), así que no pueden divergir de lo que realmente pide la app.
 *
 * Uso: node tools/capture-fixture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlDeterministic, urlEnsemble, urlMarine, trozos } from '../elnino/js/sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provincias = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'elnino/data/provinces.json'), 'utf8'),
).provincias;

const urls = [];
for (const chunk of trozos(provincias)) urls.push(urlDeterministic(chunk));
for (const chunk of trozos(provincias)) urls.push(urlEnsemble(chunk));
urls.push(urlMarine(provincias.filter((p) => p.sst_lat != null)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const respuestas = [];
for (const url of urls) {
  let ok = false;
  for (let intento = 0; intento < 8 && !ok; intento++) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      respuestas.push({ url, body });
      console.log(`  ok (${body.length} bytes) ${url.slice(0, 90)}…`);
      ok = true;
    } catch (e) {
      console.log(`  reintento ${intento}: ${e.message}`);
      await sleep(20000 * (intento + 1));
    }
  }
  if (!ok) throw new Error(`no se pudo capturar ${url}`);
  await sleep(800);
}

const dest = path.join(ROOT, 'backtest/fixtures/live-sample.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({
  _meta: {
    descripcion: 'Respuestas reales de Open-Meteo capturadas en una carga de la app.',
    uso: 'Sólo para verificar el renderizado de la interfaz en un navegador sin salida a internet. La app en producción nunca lee este archivo.',
    capturado: new Date().toISOString(),
    n_respuestas: respuestas.length,
  },
  respuestas,
}));
console.log(`\nEscrito ${dest} (${respuestas.length} respuestas, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
