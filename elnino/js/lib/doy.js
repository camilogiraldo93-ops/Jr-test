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
