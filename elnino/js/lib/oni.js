/**
 * Utilidades para el índice ONI (Oceanic Niño Index) de NOAA CPC.
 *
 * IMPORTANTE: los servidores de NOAA (cpc.ncep.noaa.gov, psl.noaa.gov) NO envían
 * cabeceras CORS, por lo que un navegador no puede descargarlos directamente.
 * La app usa un snapshot versionado en data/oni.json, generado por
 * tools/build-oni.mjs, y muestra siempre la fecha de ese snapshot.
 * Nunca se interpola ni se inventa un valor más reciente.
 */

/** Mes central de cada temporada trimestral del ONI (1-12). */
const SEASON_CENTER = {
  DJF: 1, JFM: 2, FMA: 3, MAM: 4, AMJ: 5, MJJ: 6,
  JJA: 7, JAS: 8, ASO: 9, SON: 10, OND: 11, NDJ: 12,
};

/** Convierte una temporada ONI a un número ordenable año*12+mes del centro. */
function seasonOrder(s) {
  const c = SEASON_CENTER[s.seas];
  // DJF está centrado en enero del año etiquetado; NDJ en diciembre del mismo.
  return s.year * 12 + c;
}

/**
 * Devuelve la entrada ONI vigente para una fecha dada: la temporada más reciente
 * cuyo mes central no sea posterior al mes de la fecha.
 * @param {{seasons: Array<{seas:string,year:number,anom:number}>}} oni
 * @param {string} isoDate 'YYYY-MM-DD'
 */
export function oniForDate(oni, isoDate) {
  const target = Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7));
  let best = null;
  for (const s of oni.seasons) {
    const o = seasonOrder(s);
    if (o <= target && (!best || o > seasonOrder(best))) best = s;
  }
  return best;
}

/** Latencia en meses entre la fecha consultada y el centro del ONI aplicable. */
export function oniLagMonths(entry, isoDate) {
  if (!entry) return null;
  const target = Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7));
  return target - seasonOrder(entry);
}
