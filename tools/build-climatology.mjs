/**
 * Construye elnino/data/climatology.json a partir de ERA5 1991-2020 (Open-Meteo Archive API).
 *
 * Para cada provincia y cada día del año calcula percentiles locales usando una
 * ventana móvil de ±10 días alrededor del día del año, sobre los 30 años del
 * período de referencia (≈630 muestras por ranura).
 *
 * Uso:  node tools/build-climatology.mjs
 * Requiere salida a internet (archive-api.open-meteo.com).
 * Cachea las descargas crudas en tools/.cache/ para poder re-ejecutar sin volver
 * a golpear la API (que aplica rate limiting agresivo en rangos de 30 años).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doyIndexFromISO, DOY_SLOTS } from '../elnino/js/lib/doy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

/**
 * Período de referencia. Por defecto la normal móvil de 30 años más reciente
 * disponible (1996-2025), no 1991-2020: con la primera, el percentil 95 de
 * temperatura máxima describe el clima actual; con la segunda, el calentamiento
 * observado hace que un día normal de 2026 supere el p95 de los años noventa y
 * la categoría "ola de calor" se dispare más de la mitad de los días.
 */
const START = arg('--start', '1996-01-01');
const END = arg('--end', '2025-12-31');
const WINDOW = 10; // ±10 días
const CHUNK = 3;   // provincias por petición (compromiso peso/rate-limit)
const TAG = `${START.slice(0, 4)}_${END.slice(0, 4)}`;

const provinces = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'elnino/data/provinces.json'), 'utf8'),
).provincias;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(chunk, i) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `clim_${TAG}_${String(i).padStart(2, '0')}.json`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10000) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const url =
    'https://archive-api.open-meteo.com/v1/archive' +
    `?latitude=${chunk.map((p) => p.lat).join(',')}` +
    `&longitude=${chunk.map((p) => p.lon).join(',')}` +
    `&start_date=${START}&end_date=${END}` +
    '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min' +
    '&timezone=UTC&models=era5';
  let delay = 30000;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 10000) throw new Error('respuesta demasiado corta');
      fs.writeFileSync(file, text);
      console.log(`  descargado bloque ${i} (${text.length} bytes)`);
      return JSON.parse(text);
    } catch (e) {
      console.log(`  reintento bloque ${i} #${attempt}: ${e.message}`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 240000);
    }
  }
  throw new Error(`no se pudo descargar el bloque ${i}`);
}

/** Percentil empírico con interpolación lineal. `sorted` debe venir ordenado asc. */
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function rolling(series, n) {
  const out = new Array(series.length).fill(null);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v != null) { sum += v; valid++; }
    if (i >= n) {
      const old = series[i - n];
      if (old != null) { sum -= old; valid--; }
    }
    if (i >= n - 1 && valid === n) out[i] = sum;
  }
  return out;
}

function buildForSeries(time, pr, tmax) {
  const pr3 = rolling(pr, 3);
  const pr30 = rolling(pr, 30);

  // Acumular muestras por ranura de día del año.
  const bucketsPr = Array.from({ length: DOY_SLOTS }, () => []);
  const bucketsPr3 = Array.from({ length: DOY_SLOTS }, () => []);
  const bucketsPr30 = Array.from({ length: DOY_SLOTS }, () => []);
  const bucketsTmax = Array.from({ length: DOY_SLOTS }, () => []);

  for (let i = 0; i < time.length; i++) {
    const d = doyIndexFromISO(time[i]);
    if (pr[i] != null) bucketsPr[d].push(pr[i]);
    if (pr3[i] != null) bucketsPr3[d].push(pr3[i]);
    if (pr30[i] != null) bucketsPr30[d].push(pr30[i]);
    if (tmax[i] != null) bucketsTmax[d].push(tmax[i]);
  }

  const gather = (buckets, d) => {
    const out = [];
    for (let k = -WINDOW; k <= WINDOW; k++) {
      const idx = (d + k + DOY_SLOTS) % DOY_SLOTS;
      for (const v of buckets[idx]) out.push(v);
    }
    return out.sort((a, b) => a - b);
  };
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

  const keys = [
    'prP95', 'prP99', 'prP995', 'prMean',
    'pr3P95', 'pr3P99', 'pr3P995',
    'tmaxP95', 'tmaxP98', 'tmaxP995', 'tmaxMean',
    'pr30P05', 'pr30P10', 'pr30P20', 'pr30Mean',
  ];
  const out = Object.fromEntries(keys.map((k) => [k, new Array(DOY_SLOTS)]));

  for (let d = 0; d < DOY_SLOTS; d++) {
    const sp = gather(bucketsPr, d);
    const s3 = gather(bucketsPr3, d);
    const s30 = gather(bucketsPr30, d);
    const st = gather(bucketsTmax, d);
    out.prP95[d] = r1(quantile(sp, 0.95));
    out.prP99[d] = r1(quantile(sp, 0.99));
    out.prP995[d] = r1(quantile(sp, 0.995));
    out.prMean[d] = r1(mean(sp));
    out.pr3P95[d] = r1(quantile(s3, 0.95));
    out.pr3P99[d] = r1(quantile(s3, 0.99));
    out.pr3P995[d] = r1(quantile(s3, 0.995));
    out.tmaxP95[d] = r1(quantile(st, 0.95));
    out.tmaxP98[d] = r1(quantile(st, 0.98));
    out.tmaxP995[d] = r1(quantile(st, 0.995));
    out.tmaxMean[d] = r1(mean(st));
    out.pr30P05[d] = r1(quantile(s30, 0.05));
    out.pr30P10[d] = r1(quantile(s30, 0.10));
    out.pr30P20[d] = r1(quantile(s30, 0.20));
    out.pr30Mean[d] = r1(mean(s30));
  }
  return out;
}

async function main() {
  const byProvince = {};
  for (let i = 0; i < provinces.length; i += CHUNK) {
    const chunk = provinces.slice(i, i + CHUNK);
    console.log(`Bloque ${i}: ${chunk.map((p) => p.nombre).join(', ')}`);
    const data = await fetchChunk(chunk, i);
    const arr = Array.isArray(data) ? data : [data];
    arr.forEach((loc, j) => {
      const p = chunk[j];
      byProvince[p.id] = buildForSeries(
        loc.daily.time,
        loc.daily.precipitation_sum,
        loc.daily.temperature_2m_max,
      );
      console.log(`  ${p.nombre}: ${loc.daily.time.length} días ERA5`);
    });
  }

  const out = {
    _meta: {
      fuente: 'ERA5 reanálisis (ECMWF) vía Open-Meteo Archive API',
      url: 'https://archive-api.open-meteo.com/v1/archive',
      periodo_referencia: `${START} a ${END}`,
      motivo_periodo: 'Normal móvil de 30 años más reciente. Se descartó 1991-2020 porque, con el calentamiento observado, su percentil 95 de temperatura máxima ya no representa un extremo en 2026 y la categoría "ola de calor" se disparaba en el 53 % de los días.',
      ventana_dia_del_anio: `±${WINDOW} días`,
      muestras_por_ranura: (2 * WINDOW + 1) * 30,
      generado: new Date().toISOString().slice(0, 10),
      nota: 'Percentiles calculados por provincia sobre el punto de su capital. No representan la variabilidad interna de la provincia.',
    },
    provincias: byProvince,
  };
  const dest = path.join(ROOT, 'elnino/data/climatology.json');
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`\nEscrito ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
