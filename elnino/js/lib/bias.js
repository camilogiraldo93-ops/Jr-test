/**
 * Corrección de sesgo sistemático entre el modelo de pronóstico y ERA5.
 *
 * Por qué existe: los umbrales de alerta son percentiles calculados sobre ERA5,
 * pero el valor que se compara contra ellos viene de un modelo de pronóstico con
 * su propio clima. Si el modelo es sistemáticamente más lluvioso o más frío que
 * ERA5 en un punto, la alerta se dispara de más o de menos aunque el pronóstico
 * sea bueno. La corrección alinea ambas escalas antes de clasificar.
 *
 * Forma deliberadamente simple (un parámetro por provincia y variable):
 *   - temperatura: desplazamiento aditivo δ = media(ERA5) − media(pronóstico)
 *   - precipitación: factor multiplicativo ρ = media(ERA5) / media(pronóstico)
 * Con ~60 días de ajuste, un mapeo de cuantiles completo sería más flexible pero
 * mucho más ruidoso en la cola, que es justo donde viven las alertas.
 *
 * El ajuste se estima SIEMPRE en días anteriores a la ventana de verificación,
 * para que el backtest siga siendo fuera de muestra.
 */

/** Límites de seguridad: la corrección ajusta, no reinventa el pronóstico. */
export const LIMITES = { rhoMin: 0.5, rhoMax: 2.0, deltaMax: 3.0 };

/**
 * @param {object|null} bias  contenido de data/bias.json (o null para no corregir)
 * @param {string} provId
 * @returns {{rho: number, delta: number}}
 */
export function factoresDe(bias, provId) {
  const t = bias?.provincias?.[provId];
  if (!t) return { rho: 1, delta: 0 };
  return { rho: t.rho ?? 1, delta: t.delta ?? 0 };
}

/** Aplica la corrección a un valor de precipitación pronosticado (mm). */
export function corregirPr(v, rho) {
  if (v == null || !Number.isFinite(v)) return v;
  return v * rho;
}

/** Aplica la corrección a una temperatura máxima pronosticada (°C). */
export function corregirTmax(v, delta) {
  if (v == null || !Number.isFinite(v)) return v;
  return v + delta;
}
