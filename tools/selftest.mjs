/**
 * Pruebas de coherencia que NO necesitan red. No sustituyen al backtest: sólo
 * verifican que los datos vendidos con la app estén completos y que el motor de
 * clasificación se comporte como dice su documentación.
 *
 * Uso: node tools/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDay, DEFAULT_CONFIG, ensoPhase, CATEGORIES } from '../elnino/js/lib/classifier.js';
import { doyIndexFromISO, DOY_SLOTS } from '../elnino/js/lib/doy.js';
import { oniForDate } from '../elnino/js/lib/oni.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

let fallos = 0;
const check = (nombre, cond, detalle = '') => {
  if (cond) { console.log(`  ok   ${nombre}`); }
  else { console.log(`  FALLA ${nombre} ${detalle}`); fallos++; }
};

console.log('\n== Datos estáticos ==');
const provincias = leer('elnino/data/provinces.json').provincias;
const clim = leer('elnino/data/climatology.json');
const geo = leer('elnino/data/provinces.geo.json');
const oni = leer('elnino/data/oni.json');

check('24 provincias definidas', provincias.length === 24, `(${provincias.length})`);
check('toda provincia tiene climatología',
  provincias.every((p) => clim.provincias[p.id]));
check('toda provincia tiene geometría no vacía',
  provincias.every((p) => geo.paths[p.id]?.d?.length > 50));

const claves = ['prP95', 'prP99', 'prP995', 'pr3P95', 'pr3P99', 'pr3P995',
  'tmaxP95', 'tmaxP98', 'tmaxP995', 'pr30P05', 'pr30P10', 'pr30P20', 'pr30Mean', 'prMean', 'tmaxMean'];
let huecos = 0;
let noMonotono = 0;
for (const p of provincias) {
  const c = clim.provincias[p.id];
  for (const k of claves) {
    if (!Array.isArray(c[k]) || c[k].length !== DOY_SLOTS) { huecos++; continue; }
    if (c[k].some((v) => v == null || !Number.isFinite(v))) huecos++;
  }
  for (let d = 0; d < DOY_SLOTS; d++) {
    if (!(c.prP95[d] <= c.prP99[d] + 1e-9 && c.prP99[d] <= c.prP995[d] + 1e-9)) noMonotono++;
    if (!(c.tmaxP95[d] <= c.tmaxP98[d] + 1e-9 && c.tmaxP98[d] <= c.tmaxP995[d] + 1e-9)) noMonotono++;
    if (!(c.pr30P05[d] <= c.pr30P10[d] + 1e-9 && c.pr30P10[d] <= c.pr30P20[d] + 1e-9)) noMonotono++;
  }
}
check('climatología sin huecos ni series incompletas', huecos === 0, `(${huecos} series con problema)`);
check('percentiles monótonos en todos los días del año', noMonotono === 0, `(${noMonotono} violaciones)`);

console.log('\n== Índice ONI ==');
check('serie ONI extensa', oni.seasons.length > 800, `(${oni.seasons.length})`);
check('ONI de una fecha conocida resuelve a una temporada',
  oniForDate(oni, '2026-08-01') != null);
check('El Niño 1997-98 clasificado como fuerte o muy fuerte',
  ['fuerte', 'muy fuerte'].includes(ensoPhase(oniForDate(oni, '1997-12-15').anom).strength),
  `(ONI=${oniForDate(oni, '1997-12-15')?.anom})`);
check('La Niña 1999-2000 clasificada como La Niña',
  ensoPhase(oniForDate(oni, '2000-01-15').anom).phase === 'La Niña',
  `(ONI=${oniForDate(oni, '2000-01-15')?.anom})`);

console.log('\n== Motor de clasificación ==');
const guayas = provincias.find((p) => p.id === 'guayas');
const cFeb = (() => {
  const c = clim.provincias.guayas;
  const d = doyIndexFromISO('2026-02-15');
  return Object.fromEntries(Object.keys(c).map((k) => [k, c[k][d]]));
})();

const base = { clim: cFeb, region: guayas.region, oni: 0, pr: 0, pr3: 0, pr30: cFeb.pr30Mean, tmax: cFeb.tmaxMean };

check('día normal no dispara ninguna alerta',
  classifyDay(base, DEFAULT_CONFIG).max === 0,
  JSON.stringify(classifyDay(base, DEFAULT_CONFIG).levels));

const lluvia = classifyDay({ ...base, pr: cFeb.prP995 * 1.4, pr3: cFeb.prP995 * 1.4 }, DEFAULT_CONFIG);
check('lluvia muy por encima del p99.5 dispara alerta roja de lluvia',
  lluvia.levels.lluvia_extrema === 3, JSON.stringify(lluvia.levels));

const calor = classifyDay({ ...base, tmax: cFeb.tmaxP995 + 3 }, DEFAULT_CONFIG);
check('tmax por encima del p99.5 dispara alerta roja de calor',
  calor.levels.ola_calor === 3, JSON.stringify(calor.levels));

const seco = classifyDay({ ...base, pr30: cFeb.pr30P05 * 0.5 }, DEFAULT_CONFIG);
check('acumulado de 30 días muy por debajo del p5 dispara sequía roja',
  seco.levels.sequia === 3, JSON.stringify(seco.levels));

// Escalera de severidad monótona para lluvia.
const niveles = [cFeb.prP95, cFeb.prP99, cFeb.prP995].map(
  (v) => classifyDay({ ...base, pr: v }, DEFAULT_CONFIG).levels.lluvia_extrema,
);
check('la severidad de lluvia crece con el percentil superado',
  niveles[0] <= niveles[1] && niveles[1] <= niveles[2] && niveles[2] === 3, JSON.stringify(niveles));

console.log('\n== Dirección de la modulación ENSO ==');
const prMedio = (cFeb.prP95 + cFeb.prP99) / 2;
const costaNino = classifyDay({ ...base, pr: prMedio, oni: 1.4 }, DEFAULT_CONFIG).levels.lluvia_extrema;
const costaNeutro = classifyDay({ ...base, pr: prMedio, oni: 0 }, DEFAULT_CONFIG).levels.lluvia_extrema;
check('El Niño no reduce la sensibilidad a lluvia en la costa',
  costaNino >= costaNeutro, `(niño=${costaNino}, neutro=${costaNeutro})`);

const sequiaBorde = cFeb.pr30P20 * 0.98;
const seqNino = classifyDay({ ...base, pr30: sequiaBorde, oni: 1.4 }, DEFAULT_CONFIG).levels.sequia;
const seqNeutro = classifyDay({ ...base, pr30: sequiaBorde, oni: 0 }, DEFAULT_CONFIG).levels.sequia;
check('El Niño no aumenta las alertas de sequía en la costa (patrón real: costa más húmeda)',
  seqNino <= seqNeutro, `(niño=${seqNino}, neutro=${seqNeutro})`);

const amazonia = provincias.find((p) => p.id === 'napo');
const cNapo = (() => {
  const c = clim.provincias.napo;
  const d = doyIndexFromISO('2026-02-15');
  return Object.fromEntries(Object.keys(c).map((k) => [k, c[k][d]]));
})();
const baseA = { clim: cNapo, region: amazonia.region, oni: 0, pr: 0, pr3: 0, pr30: cNapo.pr30P20 * 0.98, tmax: cNapo.tmaxMean };
const seqAmzNino = classifyDay({ ...baseA, oni: 1.4 }, DEFAULT_CONFIG).levels.sequia;
const seqAmzNeutro = classifyDay({ ...baseA, oni: 0 }, DEFAULT_CONFIG).levels.sequia;
check('El Niño no reduce las alertas de sequía en la Amazonía',
  seqAmzNino >= seqAmzNeutro, `(niño=${seqAmzNino}, neutro=${seqAmzNeutro})`);

console.log('\n== Robustez ante datos faltantes ==');
const conNulos = classifyDay({ ...base, pr: null, tmax: null, pr3: null, pr30: null }, DEFAULT_CONFIG);
check('datos nulos no producen alertas fantasma',
  conNulos.max === 0 && CATEGORIES.every((k) => conNulos.levels[k] === 0));

console.log(`\n${fallos === 0 ? 'TODAS LAS PRUEBAS PASAN' : `${fallos} PRUEBA(S) FALLAN`}\n`);
process.exit(fallos === 0 ? 0 : 1);
