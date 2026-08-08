/**
 * Verificación en vivo del pipeline de datos de la app.
 *
 * Importa los MISMOS módulos que ejecuta el navegador (sources.js y lib/alerts.js,
 * ambos libres de DOM) y los corre contra las APIs reales. Sirve para comprobar,
 * en cada iteración, que "la app corre sin errores y consume datos reales en cada
 * carga" sin depender de una captura de pantalla.
 *
 * Uso: node tools/smoke-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDeterministic, fetchEnsembleSpread, fetchSST, spreadStats, UNCERTAINTY_MODELS } from '../elnino/js/sources.js';
import { buildAlerts, horasDeAnticipacion } from '../elnino/js/lib/alerts.js';
import { oniForDate } from '../elnino/js/lib/oni.js';
import { ensoPhase, CATEGORY_LABELS, SEVERITY_LABELS } from '../elnino/js/lib/classifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const provincias = leer('elnino/data/provinces.json').provincias;
const clim = leer('elnino/data/climatology.json');
const oni = leer('elnino/data/oni.json');
const bias = fs.existsSync(path.join(ROOT, 'elnino/data/bias.json')) ? leer('elnino/data/bias.json') : null;

const hoy = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

let fallos = 0;
const check = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FALLA'} ${nombre} ${detalle}`);
  if (!cond) fallos++;
};

console.log('\n== Descarga en vivo (las mismas llamadas que hace el navegador) ==');
const t0 = Date.now();
const det = await fetchDeterministic(provincias);
console.log(`  pronóstico determinista: ${Object.keys(det).length} provincias en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const ens = await fetchEnsembleSpread(provincias).catch((e) => {
  console.log('  aviso: multi-modelo no disponible:', e.message);
  return null;
});
const sst = await fetchSST(provincias).catch(() => ({}));

check('todas las provincias traen pronóstico', Object.keys(det).length === provincias.length);
check('la serie diaria incluye pasado y futuro',
  provincias.every((p) => det[p.id].time.length >= 35), `(${det[provincias[0].id].time.length} días)`);
check('hay valores no nulos de precipitación',
  provincias.every((p) => det[p.id].pr.some((v) => v != null)));
check('multi-modelo disponible', ens != null && Object.keys(ens).length === provincias.length,
  ens ? `(${Object.keys(ens).length} provincias)` : '(sin datos)');
if (ens) {
  const m = Object.keys(ens[provincias[0].id].modelos);
  check('al menos 3 centros meteorológicos respondieron', m.length >= 3, `(${m.length}: ${m.join(', ')})`);
}
check('TSM costera disponible', Object.keys(sst).length > 0, `(${Object.keys(sst).length} puntos)`);

console.log('\n== Clasificación con el mismo motor que la app ==');
const dias = det[provincias[0].id].time.filter((t) => t >= hoy);
const { alertas, porProvinciaDia } = buildAlerts({ provincias, clim, oni, det, ens, dias, spreadStats, bias });
console.log(`  climatología: ${clim._meta.periodo_referencia}`);
console.log(`  corrección de sesgo: ${bias ? `${bias._meta.entrenamiento_inicio} → ${bias._meta.entrenamiento_fin}` : 'no aplicada'}`);

const diaVerificado = dias.find((d) => horasDeAnticipacion(d) >= 24);
check('existe al menos un día con 24 h o más de anticipación', diaVerificado != null, `(${diaVerificado})`);
check('la clasificación cubre las 24 provincias en ese día',
  Object.keys(porProvinciaDia[diaVerificado] || {}).length === provincias.length);

const entrada = oniForDate(oni, hoy);
const fase = ensoPhase(entrada.anom);
console.log(`\n  ENSO vigente: ${fase.phase} ${fase.strength} — ONI ${entrada.seas} ${entrada.year} = ${entrada.anom} °C`);

console.log(`\n  Alertas para ${diaVerificado} (anticipación +${horasDeAnticipacion(diaVerificado)} h):`);
const delDia = alertas.filter((a) => a.dia === diaVerificado);
if (!delDia.length) {
  console.log('    ninguna provincia supera hoy sus umbrales climatológicos locales');
} else {
  for (const a of delDia.sort((x, y) => y.nivel - x.nivel)) {
    const sp = a.spread
      ? `${a.spread.min.toFixed(1)}–${a.spread.max.toFixed(1)} ${a.unidad} entre ${a.spread.n} modelos, ${a.modelosQueSuperan} superan el umbral`
      : 'sin dispersión disponible';
    console.log(
      `    ${a.provincia.padEnd(32)} ${CATEGORY_LABELS[a.categoria].padEnd(24)} ` +
      `${SEVERITY_LABELS[a.nivel].padEnd(8)} | umbral ${a.evidencia.umbral} | ${sp}`,
    );
  }
}

const conSpread = delDia.filter((a) => a.spread).length;
check('toda alerta lleva su margen de incertidumbre',
  delDia.length === 0 || conSpread === delDia.length, `(${conSpread}/${delDia.length})`);

const totalPorDia = dias.map((d) => `${d}:${alertas.filter((a) => a.dia === d).length}`).join('  ');
console.log(`\n  Alertas por día: ${totalPorDia}`);

console.log(`\n${fallos === 0 ? 'PIPELINE EN VIVO OK' : `${fallos} COMPROBACIÓN(ES) FALLAN`}\n`);
process.exit(fallos === 0 ? 0 : 1);
