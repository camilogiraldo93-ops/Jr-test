/**
 * Índice de día del año estable entre años bisiestos y no bisiestos.
 *
 * Se usa un calendario fijo de 366 ranuras basado en año bisiesto, de modo que
 * el 1 de marzo siempre cae en el índice 60, exista o no el 29 de febrero ese
 * año. Esto evita que la climatología se desfase medio día en la mitad del año.
 */
const CUM = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/** @param {number} month 1-12 @param {number} day 1-31 @returns {number} 0..365 */
export function doyIndex(month, day) {
  return CUM[month - 1] + (day - 1);
}

/** @param {string} iso 'YYYY-MM-DD' */
export function doyIndexFromISO(iso) {
  return doyIndex(Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
}

export const DOY_SLOTS = 366;

/**
 * Resolución con la que se almacena la climatología: una muestra cada 5 días
 * del año (74 ranuras que cubren 0..365).
 *
 * Por qué no se guardan los 366 días: cada percentil se calcula sobre una
 * ventana de ±10 días, así que dos días contiguos comparten el 95 % de sus
 * muestras y sus valores son casi idénticos. Guardar 366 no aporta información,
 * sólo quintuplica el archivo que descarga el usuario.
 */
export const CLIM_STEP = 5;
export const CLIM_SLOTS = Math.ceil(DOY_SLOTS / CLIM_STEP) + 1; // 74

/** Índice de ranura climatológica (float) para un día del año. */
export function climSlot(doy) {
  return doy / CLIM_STEP;
}

/**
 * Lee una serie climatológica almacenada cada 5 días, interpolando linealmente.
 * @param {number[]} serie  longitud CLIM_SLOTS
 * @param {number} doy      0..365
 */
export function interpClim(serie, doy) {
  if (!Array.isArray(serie) || !serie.length) return NaN;
  const pos = climSlot(doy);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, serie.length - 1);
  const a = serie[lo];
  const b = serie[hi];
  if (a == null) return b ?? NaN;
  if (b == null) return a;
  return a + (b - a) * (pos - lo);
}
