/**
 * Construcción de alertas — módulo puro (sin DOM, sin red).
 *
 * Vive aparte de app.js para que la verificación en vivo (tools/smoke-live.mjs)
 * ejercite exactamente la misma lógica que el navegador, y no una reimplementación
 * que pueda divergir en silencio.
 */
import { classifyDay, CATEGORIES, DEFAULT_CONFIG } from './classifier.js';
import { doyIndexFromISO } from './doy.js';
import { oniForDate } from './oni.js';
import { factoresDe, corregirPr, corregirTmax } from './bias.js';

/** Variable del multi-modelo y unidad asociada a cada categoría. */
export const CAT_VAR = {
  lluvia_extrema: { variable: 'pr', unidad: 'mm' },
  inundacion: { variable: 'pr', unidad: 'mm' },
  ola_calor: { variable: 'tmax', unidad: '°C' },
  sequia: { variable: 'pr', unidad: 'mm' },
};

/** Ecuador continental es UTC-5 todo el año (no aplica horario de verano). */
export function horasDeAnticipacion(diaISO, ahora = Date.now()) {
  return Math.round((new Date(`${diaISO}T00:00:00-05:00`) - ahora) / 3600000);
}

export function climEn(clim, provId, iso) {
  const c = clim.provincias[provId];
  const d = doyIndexFromISO(iso);
  const out = {};
  for (const k of Object.keys(c)) out[k] = c[k][d];
  return out;
}

/** Suma de una ventana de la serie diaria; null si falta algún dato. */
export function suma(serie, desde, hasta) {
  let s = 0;
  for (let i = desde; i <= hasta; i++) {
    if (i < 0 || i >= serie.length || serie[i] == null) return null;
    s += serie[i];
  }
  return s;
}

/** Umbral de disparo (nivel amarillo) que se muestra en la tarjeta. */
export function umbralDisparo(cat, clim, cfg = DEFAULT_CONFIG) {
  if (cat === 'lluvia_extrema') return clim[cfg.rain.pctYellow];
  if (cat === 'inundacion') return clim[cfg.flood.pctYellow];
  if (cat === 'ola_calor') return clim[cfg.heat.pctYellow];
  return clim[cfg.drought.pctYellow];
}

/**
 * @param {object} p
 * @param {Array} p.provincias
 * @param {object} p.clim        climatology.json
 * @param {object} p.oni         oni.json
 * @param {object} p.det         salida de fetchDeterministic
 * @param {object|null} p.ens    salida de fetchEnsembleSpread
 * @param {string[]} p.dias      días a evaluar (ISO)
 * @param {Function} p.spreadStats  inyectado desde sources.js
 * @param {number} [p.ahora]
 * @returns {{alertas: Array, porProvinciaDia: object}}
 */
export function buildAlerts({ provincias, clim, oni, det, ens, dias, spreadStats, bias = null, ahora = Date.now(), cfg = DEFAULT_CONFIG }) {
  const alertas = [];
  const porProvinciaDia = {};
  const hoy = new Date(ahora).toISOString().slice(0, 10);

  for (const p of provincias) {
    const d = det[p.id];
    if (!d) continue;
    const idx = new Map(d.time.map((t, i) => [t, i]));
    const e = ens?.[p.id];
    const eIdx = e ? new Map(e.time.map((t, i) => [t, i])) : null;
    const { rho, delta } = factoresDe(bias, p.id);

    // La corrección de sesgo se aplica a los días pronosticados. Los días ya
    // transcurridos que alimentan los acumulados vienen del análisis y se dejan
    // como están: corregirlos introduciría un sesgo donde no lo hay.
    const prAjustada = d.time.map((t, i) => (t >= hoy ? corregirPr(d.pr[i], rho) : d.pr[i]));

    for (const dia of dias) {
      const i = idx.get(dia);
      if (i == null || d.pr[i] == null || d.tmax[i] == null) continue;

      const pr3 = suma(prAjustada, i - 2, i);
      const pr30 = suma(prAjustada, i - 29, i);
      const climDia = climEn(clim, p.id, dia);
      const entrada = oniForDate(oni, dia);
      const oniVal = entrada ? entrada.anom : null;

      const prDia = prAjustada[i];
      const tmaxDia = corregirTmax(d.tmax[i], delta);

      const r = classifyDay(
        { pr: prDia, pr3, pr30, tmax: tmaxDia, clim: climDia, region: p.region, oni: oniVal },
        cfg,
      );
      (porProvinciaDia[dia] ||= {})[p.id] = { max: r.max, active: r.active };

      const anticipacion = horasDeAnticipacion(dia, ahora);
      for (const cat of CATEGORIES) {
        if (r.levels[cat] === 0) continue;
        const { variable, unidad } = CAT_VAR[cat];
        const spread = eIdx && spreadStats ? spreadStats(e, eIdx, dia, variable) : null;
        const umbral = umbralDisparo(cat, climDia, cfg);

        let superan = 0;
        if (spread) {
          for (const m of spread.porModelo) {
            if (cat === 'sequia') { if (m.valor <= umbral) superan++; }
            else if (m.valor >= umbral) superan++;
          }
        }

        alertas.push({
          provinciaId: p.id, provincia: p.nombre, region: p.region,
          categoria: cat, nivel: r.levels[cat], dia,
          anticipacionHoras: anticipacion,
          unidad, spread, modelosQueSuperan: superan,
          oniAplicado: oniVal,
          sesgo: { rho, delta },
          evidencia: {
            pr: prDia, pr3, pr30, tmax: tmaxDia, umbral, pr30Mean: climDia.pr30Mean,
            prSinCorregir: d.pr[i], tmaxSinCorregir: d.tmax[i],
          },
        });
      }
    }
  }
  return { alertas, porProvinciaDia };
}
