/**
 * Ajusta la corrección de sesgo modelo→ERA5 y escribe elnino/data/bias.json.
 *
 * IMPORTANTE — fuera de muestra: el ajuste se hace sobre días ESTRICTAMENTE
 * anteriores a la ventana que después verifica el backtest. Por defecto, los 60
 * días que terminan un día antes del inicio de esa ventana. run.mjs aborta si
 * detecta solapamiento, así que este invariante no depende de recordarlo.
 *
 * Uso:
 *   node tools/build-bias.mjs --test-start 2026-07-03 [--train-days 60]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, fetchObserved, fetchForecastD1 } from '../backtest/run.mjs';
import { LIMITES } from '../elnino/js/lib/bias.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const provincias = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'elnino/data/provinces.json'), 'utf8'),
).provincias;

const testStart = arg('--test-start', null);
if (!testStart) throw new Error('Falta --test-start (inicio de la ventana de verificación)');
const trainDays = Number(arg('--train-days', '60'));
const trainEnd = addDays(testStart, -1);
const trainStart = addDays(trainEnd, -(trainDays - 1));

console.log(`Ajustando corrección de sesgo sobre ${trainStart} → ${trainEnd} (${trainDays} días).`);
console.log(`La ventana de verificación empieza el ${testStart}: sin solapamiento.\n`);

const obs = await fetchObserved(trainStart, trainEnd);
const fcst = await fetchForecastD1(trainStart, trainEnd);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

const tabla = {};
const resumen = [];
for (const p of provincias) {
  const o = obs[p.id];
  const f = fcst[p.id];
  if (!o || !f) continue;
  const oIdx = new Map(o.time.map((t, i) => [t, i]));

  const prO = [], prF = [], tO = [], tF = [];
  for (let i = 0; i < f.time.length; i++) {
    const oi = oIdx.get(f.time[i]);
    if (oi == null) continue;
    if (o.pr[oi] != null && f.pr[i] != null) { prO.push(o.pr[oi]); prF.push(f.pr[i]); }
    if (o.tmax[oi] != null && f.tmax[i] != null) { tO.push(o.tmax[oi]); tF.push(f.tmax[i]); }
  }

  const mFpr = media(prF);
  const rhoCrudo = mFpr > 0.05 ? media(prO) / mFpr : 1;
  const rho = clamp(Number.isFinite(rhoCrudo) ? rhoCrudo : 1, LIMITES.rhoMin, LIMITES.rhoMax);
  const deltaCrudo = media(tO) - media(tF);
  const delta = clamp(Number.isFinite(deltaCrudo) ? deltaCrudo : 0, -LIMITES.deltaMax, LIMITES.deltaMax);

  tabla[p.id] = {
    rho: Math.round(rho * 1000) / 1000,
    delta: Math.round(delta * 100) / 100,
    n_dias: Math.min(prO.length, tO.length),
    rho_sin_limitar: Math.round((Number.isFinite(rhoCrudo) ? rhoCrudo : 1) * 1000) / 1000,
    delta_sin_limitar: Math.round((Number.isFinite(deltaCrudo) ? deltaCrudo : 0) * 100) / 100,
  };
  resumen.push([p.nombre, tabla[p.id].rho, tabla[p.id].delta, tabla[p.id].n_dias]);
}

console.log('provincia                          ρ lluvia   δ temp (°C)   días');
for (const [n, r, d, k] of resumen) {
  console.log(`${n.padEnd(34)} ${String(r).padStart(8)} ${String(d).padStart(12)} ${String(k).padStart(6)}`);
}

const out = {
  _meta: {
    descripcion: 'Corrección de sesgo sistemático entre el pronóstico a 24 h y el reanálisis ERA5, por provincia.',
    metodo: 'ρ = media(ERA5)/media(pronóstico) para precipitación; δ = media(ERA5) − media(pronóstico) para temperatura máxima.',
    entrenamiento_inicio: trainStart,
    entrenamiento_fin: trainEnd,
    dias_entrenamiento: trainDays,
    limites: LIMITES,
    advertencia: 'Ajuste de un solo parámetro por variable y provincia sobre una ventana corta. Corrige sesgo medio, no errores de temporización ni de cola.',
    generado: new Date().toISOString(),
  },
  provincias: tabla,
};
const dest = path.join(ROOT, 'elnino/data/bias.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`\nEscrito ${dest}`);
