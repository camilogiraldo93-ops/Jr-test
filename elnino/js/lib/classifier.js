/**
 * Motor de clasificación de alertas climáticas — módulo puro (sin DOM, sin red).
 *
 * Este mismo archivo lo importan:
 *   - el navegador (app web), y
 *   - el harness de backtest en Node (backtest/run.mjs).
 * Así la métrica publicada corresponde exactamente al código que corre en producción.
 *
 * Principio de diseño: los umbrales son PERCENTILES LOCALES derivados de la
 * climatología ERA5 1991-2020 de cada provincia, no números universales
 * inventados. Un "día de lluvia extrema" en Esmeraldas no es lo mismo que en Loja.
 */

export const CATEGORIES = ['lluvia_extrema', 'inundacion', 'ola_calor', 'sequia'];

export const CATEGORY_LABELS = {
  lluvia_extrema: 'Lluvia extrema',
  inundacion: 'Riesgo de inundación',
  ola_calor: 'Ola de calor',
  sequia: 'Sequía / déficit hídrico',
};

/** 0 = sin alerta. 1..3 = amarillo, naranja, rojo. */
export const SEVERITY_LABELS = ['sin alerta', 'amarilla', 'naranja', 'roja'];
export const SEVERITY_COLORS = ['#2f7d4f', '#e8b93b', '#e07a1f', '#c62828'];

/**
 * Configuración de umbrales. Se ajusta iterativamente contra el backtest real;
 * cada campo documenta qué percentil climatológico usa.
 */
export const DEFAULT_CONFIG = {
  // --- Lluvia extrema (acumulado diario) ---
  rain: {
    pctYellow: 'prP95',   // >= percentil 95 diario local
    pctOrange: 'prP99',   // >= percentil 99 diario local
    pctRed: 'prP995',     // >= percentil 99.5 diario local
    floorMm: 15,          // piso absoluto: por debajo de esto no se alerta nunca
  },
  // --- Riesgo de inundación (acumulado 3 días, proxy de saturación de suelo) ---
  flood: {
    pctYellow: 'pr3P95',
    pctOrange: 'pr3P99',
    pctRed: 'pr3P995',
    floorMm: 45,
  },
  // --- Ola de calor (temperatura máxima diaria) ---
  heat: {
    pctYellow: 'tmaxP95',
    pctOrange: 'tmaxP98',
    pctRed: 'tmaxP995',
    floorC: 0,            // sin piso absoluto: el calor extremo es relativo al clima local
  },
  // --- Sequía (acumulado móvil 30 días vs distribución climatológica) ---
  drought: {
    pctYellow: 'pr30P20',
    pctOrange: 'pr30P10',
    pctRed: 'pr30P05',
    minClimMm: 20,        // si la normal de 30 días es < 20 mm, la zona es árida por
                          // definición y no se declara "sequía" por ruido
  },
  /**
   * Modulación ENSO. Durante El Niño la costa y el occidente ecuatoriano tienden
   * a lluvias por encima de lo normal; durante La Niña, lo contrario. Esto NO
   * cambia el dato observado: sólo desplaza el umbral de disparo de la alerta,
   * y su efecto real se mide en el backtest (se puede desactivar con enabled:false).
   */
  enso: {
    enabled: true,
    // Multiplicador aplicado al umbral de lluvia/inundación por región,
    // por unidad de ONI (°C). Negativo = umbral más bajo (alerta más sensible).
    rainSensitivity: { costa: -0.10, insular: -0.08, sierra: -0.04, amazonia: 0.02 },
    droughtSensitivity: { costa: -0.08, insular: -0.06, sierra: 0.02, amazonia: 0.05 },
    heatSensitivity: { costa: -0.03, insular: -0.03, sierra: -0.01, amazonia: -0.01 },
    maxAdjust: 0.25, // tope: el ajuste nunca mueve el umbral más de ±25%
  },
};

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/**
 * Factor multiplicativo que ENSO aplica a un umbral.
 * @returns {number} 1 = sin ajuste; <1 = umbral más bajo (más sensible).
 */
export function ensoFactor(oni, region, sensitivityTable, cfg) {
  if (!cfg.enso.enabled || oni == null || !Number.isFinite(oni)) return 1;
  const s = sensitivityTable[region] ?? 0;
  return 1 + clamp(s * oni, -cfg.enso.maxAdjust, cfg.enso.maxAdjust);
}

/**
 * Decide el nivel de severidad comparando un valor contra tres umbrales
 * ascendentes, respetando un piso absoluto.
 */
function levelFor(value, thresholds, floor) {
  if (value == null || !Number.isFinite(value)) return 0;
  if (value < floor) return 0;
  const [y, o, r] = thresholds;
  if (Number.isFinite(r) && value >= r) return 3;
  if (Number.isFinite(o) && value >= o) return 2;
  if (Number.isFinite(y) && value >= y) return 1;
  return 0;
}

/** Igual que levelFor pero para déficit: alerta cuando el valor está POR DEBAJO. */
function levelForDeficit(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return 0;
  const [y, o, r] = thresholds;
  if (Number.isFinite(r) && value <= r) return 3;
  if (Number.isFinite(o) && value <= o) return 2;
  if (Number.isFinite(y) && value <= y) return 1;
  return 0;
}

/**
 * Clasifica un día para una provincia.
 *
 * @param {object} d
 * @param {number} d.pr      precipitación acumulada del día (mm)
 * @param {number} d.pr3     precipitación acumulada de 3 días terminando ese día (mm)
 * @param {number} d.pr30    precipitación acumulada de 30 días terminando ese día (mm)
 * @param {number} d.tmax    temperatura máxima del día (°C)
 * @param {object} d.clim    percentiles climatológicos ERA5 1991-2020 para ese día del año
 * @param {string} d.region  'costa' | 'sierra' | 'amazonia' | 'insular'
 * @param {number} d.oni     índice ONI vigente (°C), o null
 * @param {object} [cfg]
 * @returns {{levels: Record<string, number>, max: number, active: string[]}}
 */
export function classifyDay(d, cfg = DEFAULT_CONFIG) {
  const c = d.clim || {};
  const region = d.region || 'costa';

  const fRain = ensoFactor(d.oni, region, cfg.enso.rainSensitivity, cfg);
  const fHeat = ensoFactor(d.oni, region, cfg.enso.heatSensitivity, cfg);
  const fDry = ensoFactor(d.oni, region, cfg.enso.droughtSensitivity, cfg);

  const levels = {
    lluvia_extrema: levelFor(
      d.pr,
      [c[cfg.rain.pctYellow] * fRain, c[cfg.rain.pctOrange] * fRain, c[cfg.rain.pctRed] * fRain],
      cfg.rain.floorMm,
    ),
    inundacion: levelFor(
      d.pr3,
      [c[cfg.flood.pctYellow] * fRain, c[cfg.flood.pctOrange] * fRain, c[cfg.flood.pctRed] * fRain],
      cfg.flood.floorMm,
    ),
    ola_calor: levelFor(
      d.tmax,
      [c[cfg.heat.pctYellow] * fHeat, c[cfg.heat.pctOrange] * fHeat, c[cfg.heat.pctRed] * fHeat],
      cfg.heat.floorC,
    ),
    sequia: 0,
  };

  // Sequía: sólo tiene sentido donde la normal de 30 días es no trivial.
  if (Number.isFinite(c.pr30Mean) && c.pr30Mean >= cfg.drought.minClimMm) {
    // Para déficit, un factor <1 endurece el umbral (menos alertas); por eso se
    // aplica multiplicando el umbral de acumulado mínimo esperado.
    levels.sequia = levelForDeficit(d.pr30, [
      c[cfg.drought.pctYellow] / fDry,
      c[cfg.drought.pctOrange] / fDry,
      c[cfg.drought.pctRed] / fDry,
    ]);
  }

  // Una inundación implica que hubo lluvia relevante; si no hay ninguna señal de
  // lluvia en el día ni en los 3 días, no se sostiene la alerta de inundación.
  if (levels.inundacion > 0 && !Number.isFinite(d.pr3)) levels.inundacion = 0;

  const active = CATEGORIES.filter((k) => levels[k] > 0);
  const max = Math.max(0, ...CATEGORIES.map((k) => levels[k]));
  return { levels, max, active };
}

/** Clave canónica del estado de alertas de un día, para comparar predicho vs observado. */
export function stateKey(result) {
  return CATEGORIES.map((k) => result.levels[k]).join('');
}

/** Clasificación ENSO textual a partir del ONI, según la definición operativa de NOAA CPC. */
export function ensoPhase(oni) {
  if (oni == null || !Number.isFinite(oni)) return { phase: 'desconocida', strength: '' };
  if (oni >= 2.0) return { phase: 'El Niño', strength: 'muy fuerte' };
  if (oni >= 1.5) return { phase: 'El Niño', strength: 'fuerte' };
  if (oni >= 1.0) return { phase: 'El Niño', strength: 'moderado' };
  if (oni >= 0.5) return { phase: 'El Niño', strength: 'débil' };
  if (oni <= -1.5) return { phase: 'La Niña', strength: 'fuerte' };
  if (oni <= -1.0) return { phase: 'La Niña', strength: 'moderada' };
  if (oni <= -0.5) return { phase: 'La Niña', strength: 'débil' };
  return { phase: 'Neutral', strength: '' };
}
