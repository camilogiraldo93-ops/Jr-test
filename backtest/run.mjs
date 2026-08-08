/**
 * BACKTEST CON DATOS REALES — 24 h de anticipación, 30 días, 24 provincias.
 *
 * Qué compara exactamente:
 *   PREDICHO  = clasificación aplicada al pronóstico que el modelo emitió el día
 *               anterior (Open-Meteo `previous-runs-api`, variables
 *               `*_previous_day1`, es decir la corrida de hace 1 día).
 *   OBSERVADO = clasificación aplicada al reanálisis ERA5 del día
 *               (Open-Meteo `archive-api` con `models=era5`).
 *
 * No hay ningún dato simulado ni sintético: ambas series se descargan de la API.
 *
 * Construcción operativa de los acumulados en el lado PREDICHO: al emitir la
 * alerta en D-1 se conocen las precipitaciones ya ocurridas hasta D-1 y sólo se
 * pronostica el día D. Por eso:
 *     pr3_pred(D)  = obs(D-2) + obs(D-1) + fcst(D)
 *     pr30_pred(D) = suma(obs(D-29..D-1)) + fcst(D)
 * Esto es lo que haría un sistema real, y se documenta como limitación porque
 * hace que la categoría "sequía" dependa casi por completo de datos ya conocidos.
 *
 * Uso:
 *   node backtest/run.mjs                  # corrida estándar
 *   node backtest/run.mjs --no-enso        # desactiva la modulación ENSO
 *   node backtest/run.mjs --days 30        # tamaño de ventana
 *   node backtest/run.mjs --out elnino/data/backtest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDay, CATEGORIES, DEFAULT_CONFIG } from '../elnino/js/lib/classifier.js';
import { doyIndexFromISO } from '../elnino/js/lib/doy.js';
import { oniForDate } from '../elnino/js/lib/oni.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'backtest', '.cache');
const TZ = 'America/Guayaquil';
const SPINUP = 35; // días previos necesarios para acumulados de 30 días

const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const hasFlag = (name) => argv.includes(name);

const provinces = JSON.parse(fs.readFileSync(path.join(ROOT, 'elnino/data/provinces.json'), 'utf8')).provincias;
const climatology = JSON.parse(fs.readFileSync(path.join(ROOT, 'elnino/data/climatology.json'), 'utf8'));
const oni = JSON.parse(fs.readFileSync(path.join(ROOT, 'elnino/data/oni.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function getJSON(url, cacheKey) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, cacheKey + '.json');
  if (fs.existsSync(file) && fs.statSync(file).size > 500) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  let delay = 20000;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      const parsed = JSON.parse(text);
      if (parsed.error) throw new Error(parsed.reason || 'error de la API');
      fs.writeFileSync(file, text);
      return parsed;
    } catch (e) {
      console.log(`    reintento ${cacheKey} #${attempt}: ${e.message.slice(0, 100)}`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 180000);
    }
  }
  throw new Error(`no se pudo descargar ${cacheKey}`);
}

/** Último día con reanálisis ERA5 definitivo disponible. */
async function detectLastEra5Day() {
  const today = new Date().toISOString().slice(0, 10);
  const p = provinces[0];
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${p.lat}&longitude=${p.lon}` +
    `&start_date=${addDays(today, -25)}&end_date=${today}` +
    `&daily=precipitation_sum&timezone=${TZ}&models=era5`;
  const d = await getJSON(url, `era5probe_${today}`);
  const t = d.daily.time;
  const v = d.daily.precipitation_sum;
  for (let i = t.length - 1; i >= 0; i--) if (v[i] != null) return t[i];
  throw new Error('archive-api no devolvió ningún día ERA5 con dato');
}

/** Observado ERA5 diario para todas las provincias. */
async function fetchObserved(start, end) {
  const out = {};
  const CH = 6;
  for (let i = 0; i < provinces.length; i += CH) {
    const chunk = provinces.slice(i, i + CH);
    const url =
      'https://archive-api.open-meteo.com/v1/archive' +
      `?latitude=${chunk.map((p) => p.lat).join(',')}` +
      `&longitude=${chunk.map((p) => p.lon).join(',')}` +
      `&start_date=${start}&end_date=${end}` +
      '&daily=precipitation_sum,temperature_2m_max' +
      `&timezone=${TZ}&models=era5`;
    const data = await getJSON(url, `obs_${start}_${end}_${i}`);
    const arr = Array.isArray(data) ? data : [data];
    arr.forEach((loc, j) => {
      out[chunk[j].id] = {
        time: loc.daily.time,
        pr: loc.daily.precipitation_sum,
        tmax: loc.daily.temperature_2m_max,
      };
    });
    console.log(`  observado ERA5: ${i + chunk.length}/${provinces.length} provincias`);
    await sleep(1500);
  }
  return out;
}

/**
 * Pronóstico emitido D-1, agregado a valores diarios desde la serie horaria
 * `*_previous_day1` de previous-runs-api.
 */
async function fetchForecastD1(start, end) {
  const out = {};
  const CH = 3;
  for (let i = 0; i < provinces.length; i += CH) {
    const chunk = provinces.slice(i, i + CH);
    const url =
      'https://previous-runs-api.open-meteo.com/v1/forecast' +
      `?latitude=${chunk.map((p) => p.lat).join(',')}` +
      `&longitude=${chunk.map((p) => p.lon).join(',')}` +
      `&start_date=${start}&end_date=${end}` +
      '&hourly=precipitation_previous_day1,temperature_2m_previous_day1' +
      `&timezone=${TZ}`;
    const data = await getJSON(url, `fcst_${start}_${end}_${i}`);
    const arr = Array.isArray(data) ? data : [data];
    arr.forEach((loc, j) => {
      const h = loc.hourly;
      const days = new Map();
      for (let k = 0; k < h.time.length; k++) {
        const day = h.time[k].slice(0, 10);
        if (!days.has(day)) days.set(day, { pr: 0, prN: 0, tmax: -Infinity });
        const e = days.get(day);
        const p = h.precipitation_previous_day1[k];
        const t = h.temperature_2m_previous_day1[k];
        if (p != null) { e.pr += p; e.prN++; }
        if (t != null) e.tmax = Math.max(e.tmax, t);
      }
      const time = [...days.keys()].sort();
      out[chunk[j].id] = {
        time,
        // Sólo se acepta un día si el pronóstico cubre las 24 horas completas.
        pr: time.map((d) => (days.get(d).prN >= 24 ? Math.round(days.get(d).pr * 100) / 100 : null)),
        tmax: time.map((d) => (Number.isFinite(days.get(d).tmax) ? days.get(d).tmax : null)),
      };
    });
    console.log(`  pronóstico D-1: ${i + chunk.length}/${provinces.length} provincias`);
    await sleep(2500);
  }
  return out;
}

function climFor(provId, iso) {
  const c = climatology.provincias[provId];
  const d = doyIndexFromISO(iso);
  const out = {};
  for (const k of Object.keys(c)) out[k] = c[k][d];
  return out;
}

/** Métricas de contingencia para una categoría binaria. */
function contingency() {
  return { hits: 0, misses: 0, falseAlarms: 0, correctNegatives: 0 };
}
function scores(c) {
  const { hits: H, misses: M, falseAlarms: F, correctNegatives: N } = c;
  const total = H + M + F + N;
  return {
    ...c,
    total,
    acuerdo: total ? (H + N) / total : null,
    POD: H + M ? H / (H + M) : null,          // probabilidad de detección
    FAR: H + F ? F / (H + F) : null,          // tasa de falsas alarmas
    CSI: H + M + F ? H / (H + M + F) : null,  // critical success index
    eventos_observados: H + M,
    eventos_predichos: H + F,
  };
}

export function runBacktest({ obs, fcst, window, cfg }) {
  const perCategory = Object.fromEntries(CATEGORIES.map((k) => [k, contingency()]));
  const perProvince = {};
  let exact = 0;
  let anyAlertAgree = 0;
  let n = 0;
  let eventSubsetTotal = 0;
  let eventSubsetExact = 0;
  let neverAlertCorrect = 0;
  const disagreements = [];

  for (const p of provinces) {
    const o = obs[p.id];
    const f = fcst[p.id];
    const oIdx = new Map(o.time.map((t, i) => [t, i]));
    const fIdx = new Map(f.time.map((t, i) => [t, i]));
    perProvince[p.id] = { n: 0, exact: 0 };

    for (const day of window) {
      const oi = oIdx.get(day);
      const fi = fIdx.get(day);
      if (oi == null || fi == null) continue;
      if (o.pr[oi] == null || o.tmax[oi] == null) continue;
      if (f.pr[fi] == null || f.tmax[fi] == null) continue;

      // Acumulados observados (para el lado OBSERVADO, todo es ERA5).
      const sumObs = (from, to) => {
        let s = 0;
        for (let k = from; k <= to; k++) {
          if (k < 0 || o.pr[k] == null) return null;
          s += o.pr[k];
        }
        return s;
      };
      const pr3Obs = sumObs(oi - 2, oi);
      const pr30Obs = sumObs(oi - 29, oi);
      // Antecedentes conocidos al emitir la alerta (hasta D-1) + pronóstico de D.
      const ante2 = sumObs(oi - 2, oi - 1);
      const ante29 = sumObs(oi - 29, oi - 1);
      if (pr3Obs == null || pr30Obs == null || ante2 == null || ante29 == null) continue;

      const clim = climFor(p.id, day);
      const oniEntry = oniForDate(oni, day);
      const oniVal = oniEntry ? oniEntry.anom : null;

      const pred = classifyDay(
        { pr: f.pr[fi], pr3: ante2 + f.pr[fi], pr30: ante29 + f.pr[fi], tmax: f.tmax[fi], clim, region: p.region, oni: oniVal },
        cfg,
      );
      const real = classifyDay(
        { pr: o.pr[oi], pr3: pr3Obs, pr30: pr30Obs, tmax: o.tmax[oi], clim, region: p.region, oni: oniVal },
        cfg,
      );

      n++;
      perProvince[p.id].n++;
      const isExact = CATEGORIES.every((k) => pred.levels[k] === real.levels[k]);
      if (isExact) { exact++; perProvince[p.id].exact++; }

      const predAny = pred.max > 0;
      const realAny = real.max > 0;
      if (predAny === realAny) anyAlertAgree++;
      if (!realAny) neverAlertCorrect++;

      if (predAny || realAny) {
        eventSubsetTotal++;
        if (isExact) eventSubsetExact++;
        if (!isExact) {
          disagreements.push({
            provincia: p.nombre, dia: day,
            predicho: { ...pred.levels }, observado: { ...real.levels },
            pr_pred: f.pr[fi], pr_obs: o.pr[oi],
            tmax_pred: f.tmax[fi], tmax_obs: o.tmax[oi],
          });
        }
      }

      for (const k of CATEGORIES) {
        const c = perCategory[k];
        const pAlert = pred.levels[k] > 0;
        const rAlert = real.levels[k] > 0;
        if (pAlert && rAlert) c.hits++;
        else if (!pAlert && rAlert) c.misses++;
        else if (pAlert && !rAlert) c.falseAlarms++;
        else c.correctNegatives++;
      }
    }
  }

  return {
    n_casos: n,
    exactitud_estado_completo: n ? exact / n : null,
    exactitud_alerta_binaria: n ? anyAlertAgree / n : null,
    baseline_nunca_alertar: n ? neverAlertCorrect / n : null,
    subconjunto_con_evento: {
      n: eventSubsetTotal,
      exactitud: eventSubsetTotal ? eventSubsetExact / eventSubsetTotal : null,
    },
    por_categoria: Object.fromEntries(CATEGORIES.map((k) => [k, scores(perCategory[k])])),
    por_provincia: Object.fromEntries(
      provinces.map((p) => [p.nombre, perProvince[p.id].n ? perProvince[p.id].exact / perProvince[p.id].n : null]),
    ),
    desacuerdos: disagreements,
  };
}

const pct = (v) => (v == null ? 'n/d' : (v * 100).toFixed(1) + ' %');

function report(r, meta) {
  const L = [];
  L.push('');
  L.push('═'.repeat(72));
  L.push('BACKTEST — alertas a 24 h contra observación real');
  L.push('═'.repeat(72));
  L.push(`Ventana:            ${meta.start} → ${meta.end} (${meta.days} días)`);
  L.push(`Provincias:         ${provinces.length}`);
  L.push(`Casos evaluados:    ${r.n_casos} pares provincia-día`);
  L.push(`Predicho:           pronóstico emitido D-1 (previous-runs-api, corrida de hace 1 día)`);
  L.push(`Observado:          reanálisis ERA5 (archive-api, models=era5)`);
  L.push(`ONI aplicado:       ${meta.oniSeason} = ${meta.oniValue} °C (NOAA CPC)`);
  L.push(`Modulación ENSO:    ${meta.ensoEnabled ? 'activada' : 'DESACTIVADA'}`);
  L.push('');
  L.push('MÉTRICA PRINCIPAL');
  L.push(`  Coincidencia exacta del estado de alerta:  ${pct(r.exactitud_estado_completo)}`);
  L.push(`  (las 4 categorías con la misma severidad, predicho vs observado)`);
  L.push('');
  L.push('CONTEXTO HONESTO — sin esto la métrica principal se malinterpreta');
  L.push(`  Acuerdo binario "hay/no hay alerta":       ${pct(r.exactitud_alerta_binaria)}`);
  L.push(`  Baseline trivial "nunca alertar":          ${pct(r.baseline_nunca_alertar)}`);
  L.push(`  Exactitud SOLO en días con evento:         ${pct(r.subconjunto_con_evento.exactitud)}  (n=${r.subconjunto_con_evento.n})`);
  L.push('');
  L.push('POR CATEGORÍA');
  L.push('  categoría              obs   pred    POD     FAR     CSI   acuerdo');
  for (const k of CATEGORIES) {
    const s = r.por_categoria[k];
    L.push(
      `  ${k.padEnd(20)} ${String(s.eventos_observados).padStart(5)} ${String(s.eventos_predichos).padStart(6)}` +
      ` ${(s.POD == null ? '  n/d' : (s.POD * 100).toFixed(0) + '%').padStart(6)}` +
      ` ${(s.FAR == null ? '  n/d' : (s.FAR * 100).toFixed(0) + '%').padStart(7)}` +
      ` ${(s.CSI == null ? '  n/d' : (s.CSI * 100).toFixed(0) + '%').padStart(7)}` +
      ` ${pct(s.acuerdo).padStart(9)}`,
    );
  }
  L.push('');
  return L.join('\n');
}

async function main() {
  const days = Number(getArg('--days', '30'));
  const ensoEnabled = !hasFlag('--no-enso');

  console.log('Detectando último día con ERA5 definitivo…');
  const end = getArg('--end', await detectLastEra5Day());
  const start = addDays(end, -(days - 1));
  const obsStart = addDays(start, -SPINUP);
  console.log(`Ventana de verificación: ${start} → ${end}`);
  console.log(`Descargando observado ERA5 desde ${obsStart} (incluye ${SPINUP} días de arranque)…`);
  const obs = await fetchObserved(obsStart, end);
  console.log('Descargando pronóstico emitido D-1…');
  const fcst = await fetchForecastD1(start, end);

  const window = [];
  for (let i = 0; i < days; i++) window.push(addDays(start, i));

  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.enso.enabled = ensoEnabled;

  const r = runBacktest({ obs, fcst, window, cfg });
  const oniEntry = oniForDate(oni, end);
  const meta = {
    start, end, days,
    oniSeason: oniEntry ? `${oniEntry.seas} ${oniEntry.year}` : 'n/d',
    oniValue: oniEntry ? oniEntry.anom : null,
    ensoEnabled,
    generado: new Date().toISOString(),
    fuentes: {
      predicho: 'https://previous-runs-api.open-meteo.com/v1/forecast (variables *_previous_day1)',
      observado: 'https://archive-api.open-meteo.com/v1/archive (models=era5)',
      climatologia: 'ERA5 1991-2020 vía Open-Meteo Archive API',
      oni: 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt',
    },
  };

  console.log(report(r, meta));

  const outPath = getArg('--out', null);
  if (outPath) {
    const dest = path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify({ _meta: meta, resultado: { ...r, desacuerdos: r.desacuerdos.slice(0, 40) } }, null, 1));
    console.log(`Resultado escrito en ${outPath}`);
  }
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
