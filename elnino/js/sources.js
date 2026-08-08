/**
 * Capa de acceso a datos abiertos. Todo ocurre en el navegador del usuario:
 * no hay backend propio, así que no hay ninguna capa donde un dato pueda
 * "inventarse" entre la fuente y la pantalla.
 *
 * Fuentes:
 *   - Open-Meteo Forecast API   → pronóstico determinista (motor de la alerta)
 *   - Open-Meteo Forecast API   → mismo pronóstico en 5 modelos (incertidumbre)
 *   - Open-Meteo Marine API     → temperatura superficial del mar en la costa
 *   - NOAA CPC ONI              → snapshot versionado (NOAA no permite CORS)
 */

export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';

/**
 * Modelos usados para estimar la incertidumbre. La alerta NO se emite con
 * estos: se emite con el pronóstico determinista por defecto de Open-Meteo
 * (`best_match`), que es exactamente el que se verificó en el backtest.
 * Estos modelos sirven para responder "¿cuánto discrepan las fuentes?".
 */
export const UNCERTAINTY_MODELS = [
  { id: 'ecmwf_ifs025', nombre: 'ECMWF IFS 0.25°', centro: 'ECMWF (Europa)' },
  { id: 'gfs_seamless', nombre: 'GFS', centro: 'NOAA NCEP (EE. UU.)' },
  { id: 'icon_seamless', nombre: 'ICON', centro: 'DWD (Alemania)' },
  { id: 'meteofrance_seamless', nombre: 'ARPEGE/AROME', centro: 'Météo-France' },
  { id: 'jma_seamless', nombre: 'GSM/MSM', centro: 'JMA (Japón)' },
];

const TZ = 'America/Guayaquil';
const PAST_DAYS = 31;      // necesario para el acumulado móvil de 30 días
const FORECAST_DAYS = 7;
export const CHUNK = 8;    // provincias por petición

/**
 * Constructores de URL exportados para que las herramientas de captura de
 * fixtures pidan exactamente las mismas URLs que pide el navegador, sin
 * reimplementar la construcción de la consulta.
 */
export function urlDeterministic(chunk) {
  return `${OPEN_METEO_FORECAST}?latitude=${chunk.map((p) => p.lat).join(',')}` +
    `&longitude=${chunk.map((p) => p.lon).join(',')}` +
    '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min' +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=${TZ}`;
}

export function urlEnsemble(chunk) {
  const models = UNCERTAINTY_MODELS.map((m) => m.id).join(',');
  return `${OPEN_METEO_FORECAST}?latitude=${chunk.map((p) => p.lat).join(',')}` +
    `&longitude=${chunk.map((p) => p.lon).join(',')}` +
    '&daily=precipitation_sum,temperature_2m_max' +
    `&forecast_days=${FORECAST_DAYS}&timezone=${TZ}&models=${models}`;
}

export function urlMarine(costeras) {
  return `${OPEN_METEO_MARINE}?latitude=${costeras.map((p) => p.sst_lat).join(',')}` +
    `&longitude=${costeras.map((p) => p.sst_lon).join(',')}` +
    '&daily=sea_surface_temperature_max,sea_surface_temperature_min' +
    `&forecast_days=3&timezone=${TZ}`;
}

/** Trocea la lista de provincias igual que lo hacen las funciones de descarga. */
export function trozos(provincias) {
  const out = [];
  for (let i = 0; i < provincias.length; i += CHUNK) out.push(provincias.slice(i, i + CHUNK));
  return out;
}

async function getJSON(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error(data.reason || 'error de la API');
      return data;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

const asArray = (d) => (Array.isArray(d) ? d : [d]);

/**
 * Pronóstico determinista + histórico reciente para todas las provincias.
 * @returns {Promise<Record<string, {time:string[], pr:number[], tmax:number[], tmin:number[]}>>}
 */
export async function fetchDeterministic(provincias) {
  const out = {};
  for (const chunk of trozos(provincias)) {
    const data = await getJSON(urlDeterministic(chunk));
    asArray(data).forEach((loc, j) => {
      out[chunk[j].id] = {
        time: loc.daily.time,
        pr: loc.daily.precipitation_sum,
        tmax: loc.daily.temperature_2m_max,
        tmin: loc.daily.temperature_2m_min,
        generado_ms: loc.generationtime_ms,
      };
    });
  }
  return out;
}

/**
 * El mismo pronóstico según 5 centros meteorológicos distintos.
 * La dispersión entre ellos es la medida de incertidumbre que muestra la app:
 * es un dato observable, no una probabilidad inventada por esta aplicación.
 */
export async function fetchEnsembleSpread(provincias) {
  const out = {};
  for (const chunk of trozos(provincias)) {
    const data = await getJSON(urlEnsemble(chunk));
    asArray(data).forEach((loc, j) => {
      const d = loc.daily;
      const perModel = {};
      for (const m of UNCERTAINTY_MODELS) {
        const prKey = `precipitation_sum_${m.id}`;
        const tKey = `temperature_2m_max_${m.id}`;
        if (d[prKey] || d[tKey]) {
          perModel[m.id] = { pr: d[prKey] || [], tmax: d[tKey] || [] };
        }
      }
      out[chunk[j].id] = { time: d.time, modelos: perModel };
    });
  }
  return out;
}

/** Temperatura superficial del mar en los puntos oceánicos costeros. */
export async function fetchSST(provincias) {
  const costeras = provincias.filter((p) => p.sst_lat != null);
  if (!costeras.length) return {};
  const out = {};
  try {
    const data = await getJSON(urlMarine(costeras), { retries: 1 });
    asArray(data).forEach((loc, j) => {
      out[costeras[j].id] = {
        time: loc.daily.time,
        max: loc.daily.sea_surface_temperature_max,
        min: loc.daily.sea_surface_temperature_min,
      };
    });
  } catch (e) {
    console.warn('Marine API no disponible:', e.message);
  }
  return out;
}

/** Estadísticos de dispersión entre modelos para un día concreto. */
export function spreadStats(ensemble, dayIndexByTime, day, variable) {
  if (!ensemble) return null;
  const idx = dayIndexByTime.get(day);
  if (idx == null) return null;
  const vals = [];
  const porModelo = [];
  for (const m of UNCERTAINTY_MODELS) {
    const serie = ensemble.modelos[m.id];
    if (!serie) continue;
    const v = serie[variable]?.[idx];
    if (v == null || !Number.isFinite(v)) continue;
    vals.push(v);
    porModelo.push({ modelo: m.nombre, centro: m.centro, valor: v });
  }
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n: vals.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mediana: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    porModelo,
  };
}
