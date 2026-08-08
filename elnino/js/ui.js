/**
 * Renderizado de tarjetas de alerta, panel ENSO y bloque de limitaciones.
 *
 * Regla que gobierna todo este archivo: cada número mostrado debe poder
 * rastrearse a una fuente citada en la misma tarjeta. Esta app no genera
 * probabilidades propias; cuando expresa confianza, la expresa como (a) el
 * desacuerdo observable entre modelos y (b) el desempeño verificado del propio
 * sistema en el backtest.
 */
import {
  CATEGORY_LABELS, SEVERITY_LABELS, SEVERITY_COLORS, CATEGORIES,
} from './lib/classifier.js';

const n1 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const n0 = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toString());
const pctTxt = (v) => (v == null ? 'n/d' : `${(v * 100).toFixed(0)} %`);

const FECHA_FMT = new Intl.DateTimeFormat('es-EC', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});
export const fechaLarga = (iso) => FECHA_FMT.format(new Date(iso + 'T12:00:00Z'));

/** Descripción de la evidencia que sostiene cada categoría. */
const EVIDENCIA = {
  lluvia_extrema: (d) => ({
    titulo: 'Lluvia acumulada en 24 h',
    valor: `${n1(d.pr)} mm`,
    umbral: `${n1(d.umbral)} mm`,
    umbralNota: 'percentil 95 local para esta época del año (ERA5 1991-2020)',
  }),
  inundacion: (d) => ({
    titulo: 'Lluvia acumulada en 3 días',
    valor: `${n1(d.pr3)} mm`,
    umbral: `${n1(d.umbral)} mm`,
    umbralNota: 'percentil 95 local del acumulado de 3 días (ERA5 1991-2020)',
  }),
  ola_calor: (d) => ({
    titulo: 'Temperatura máxima',
    valor: `${n1(d.tmax)} °C`,
    umbral: `${n1(d.umbral)} °C`,
    umbralNota: 'percentil 95 local de temperatura máxima para esta época (ERA5 1991-2020)',
  }),
  sequia: (d) => ({
    titulo: 'Lluvia acumulada en 30 días',
    valor: `${n1(d.pr30)} mm`,
    umbral: `${n1(d.umbral)} mm`,
    umbralNota: 'percentil 20 local del acumulado de 30 días; la normal es ' + n1(d.pr30Mean) + ' mm',
  }),
};

function chip(texto, clase) {
  const s = document.createElement('span');
  s.className = 'chip ' + (clase || '');
  s.textContent = texto;
  return s;
}

/**
 * Tarjeta de una alerta.
 * @param {object} a  alerta enriquecida (ver app.js: construirAlertas)
 * @param {object} backtest  contenido de data/backtest.json (puede ser null)
 */
export function tarjetaAlerta(a, backtest) {
  const card = document.createElement('article');
  card.className = 'alerta';
  card.style.setProperty('--sev', SEVERITY_COLORS[a.nivel]);

  const head = document.createElement('header');
  const h = document.createElement('h3');
  h.textContent = `${a.provincia} — ${CATEGORY_LABELS[a.categoria]}`;
  head.appendChild(h);
  head.appendChild(chip(`Alerta ${SEVERITY_LABELS[a.nivel]}`, `sev-${a.nivel}`));
  card.appendChild(head);

  const sub = document.createElement('p');
  sub.className = 'alerta-sub';
  sub.textContent = `Para el ${fechaLarga(a.dia)} · emitida con ${a.anticipacionHoras} h de anticipación`;
  card.appendChild(sub);

  // --- Evidencia numérica ---
  const ev = EVIDENCIA[a.categoria](a.evidencia);
  const dl = document.createElement('dl');
  dl.className = 'evidencia';
  const fila = (dt, dd, extra) => {
    const a1 = document.createElement('dt'); a1.textContent = dt;
    const a2 = document.createElement('dd');
    a2.textContent = dd;
    if (extra) {
      const small = document.createElement('small');
      small.textContent = extra;
      a2.appendChild(small);
    }
    dl.append(a1, a2);
  };
  fila(ev.titulo, ev.valor);
  fila(a.categoria === 'sequia' ? 'Umbral de déficit' : 'Umbral de disparo', ev.umbral, ev.umbralNota);
  card.appendChild(dl);

  // --- Incertidumbre observable ---
  const inc = document.createElement('div');
  inc.className = 'incertidumbre';
  const it = document.createElement('h4');
  it.textContent = 'Incertidumbre del pronóstico fuente';
  inc.appendChild(it);

  if (a.spread) {
    const p = document.createElement('p');
    p.innerHTML =
      `<strong>${a.spread.n} modelos independientes</strong> pronostican entre ` +
      `<strong>${n1(a.spread.min)}</strong> y <strong>${n1(a.spread.max)}</strong> ${a.unidad} ` +
      `(mediana ${n1(a.spread.mediana)} ${a.unidad}).`;
    inc.appendChild(p);

    const ac = document.createElement('p');
    ac.className = 'acuerdo';
    ac.textContent =
      `${a.modelosQueSuperan} de ${a.spread.n} superan el umbral de esta alerta.`;
    inc.appendChild(ac);

    const barra = document.createElement('div');
    barra.className = 'barra-acuerdo';
    const relleno = document.createElement('div');
    relleno.style.width = `${(a.modelosQueSuperan / a.spread.n) * 100}%`;
    barra.appendChild(relleno);
    inc.appendChild(barra);

    const det = document.createElement('details');
    const sm = document.createElement('summary');
    sm.textContent = 'Ver cada modelo';
    det.appendChild(sm);
    const ul = document.createElement('ul');
    for (const m of a.spread.porModelo) {
      const li = document.createElement('li');
      li.textContent = `${m.modelo} (${m.centro}): ${n1(m.valor)} ${a.unidad}`;
      ul.appendChild(li);
    }
    det.appendChild(ul);
    inc.appendChild(det);
  } else {
    const p = document.createElement('p');
    p.className = 'sin-dato';
    p.textContent =
      'No se pudo obtener la comparación entre modelos para esta alerta. ' +
      'Se muestra sólo el pronóstico determinista, sin estimación de dispersión.';
    inc.appendChild(p);
  }

  // --- Desempeño verificado de ESTA categoría (del backtest real) ---
  const bt = backtest?.resultado?.por_categoria?.[a.categoria];
  if (bt) {
    const p = document.createElement('p');
    p.className = 'skill';
    p.innerHTML =
      `Desempeño verificado de esta categoría a 24 h (backtest ${backtest._meta.start} → ${backtest._meta.end}): ` +
      `detectó <strong>${pctTxt(bt.POD)}</strong> de los eventos observados, ` +
      `con <strong>${pctTxt(bt.FAR)}</strong> de falsas alarmas ` +
      `(${bt.eventos_observados} eventos observados en ${bt.total} casos).`;
    inc.appendChild(p);
  }
  card.appendChild(inc);

  // --- Fuentes ---
  const src = document.createElement('footer');
  src.className = 'fuentes';
  src.innerHTML =
    'Fuente del disparo: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> ' +
    `Forecast API (modelo <code>best_match</code>, corrida ${a.corrida || 'más reciente disponible'}). ` +
    'Umbrales: reanálisis ERA5 1991-2020 (ECMWF). ' +
    'Contexto ENSO: <a href="https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt" target="_blank" rel="noopener">NOAA CPC ONI</a>.';
  card.appendChild(src);

  return card;
}

/** Panel de estado ENSO con el ONI real y su fecha. */
export function panelENSO(host, { oni, entrada, fase, sst }) {
  host.textContent = '';
  const box = document.createElement('div');
  box.className = 'enso-box';

  const val = document.createElement('div');
  val.className = 'enso-valor';
  val.innerHTML =
    `<span class="enso-num">${entrada.anom > 0 ? '+' : ''}${entrada.anom.toFixed(2)} °C</span>` +
    `<span class="enso-label">ONI ${entrada.seas} ${entrada.year}</span>`;
  box.appendChild(val);

  const desc = document.createElement('div');
  desc.className = 'enso-desc';
  const fuerte = fase.strength ? ` ${fase.strength}` : '';
  desc.innerHTML =
    `<strong>Fase ENSO: ${fase.phase}${fuerte}</strong>` +
    `<p>Anomalía de temperatura superficial del mar en la región Niño 3.4 (5°N-5°S, 170°O-120°O), ` +
    `media móvil de 3 meses. Publicado por NOAA CPC.</p>` +
    `<p class="nota-snapshot">Snapshot descargado el ${oni._meta.descargado.slice(0, 10)}. ` +
    `NOAA no permite lectura directa desde el navegador (sin CORS), por eso el dato se versiona ` +
    `en el repositorio y se muestra su fecha en lugar de simular una consulta en vivo. ` +
    `El ONI se publica mensualmente: es normal que la última temporada disponible tenga 1-2 meses de rezago.</p>`;
  box.appendChild(desc);
  host.appendChild(box);

  if (sst && sst.length) {
    const t = document.createElement('div');
    t.className = 'sst-box';
    t.innerHTML = '<h4>Temperatura superficial del mar frente a la costa (hoy)</h4>';
    const ul = document.createElement('ul');
    ul.className = 'sst-lista';
    for (const s of sst) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${s.provincia}</span><strong>${n1(s.valor)} °C</strong>`;
      ul.appendChild(li);
    }
    t.appendChild(ul);
    const nota = document.createElement('p');
    nota.className = 'nota-snapshot';
    nota.textContent =
      'Valores absolutos de la Marine API de Open-Meteo. No se muestran como anomalía porque la ' +
      'fuente abierta usada no entrega una climatología local de TSM; la anomalía oceánica ' +
      'autoritativa que sí se usa en la clasificación es el ONI de NOAA, arriba.';
    t.appendChild(nota);
    host.appendChild(t);
  }
}

/** Bloque de limitaciones, alimentado con las métricas reales del backtest. */
export function panelLimitaciones(host, backtest) {
  host.textContent = '';

  const intro = document.createElement('p');
  intro.className = 'lim-intro';
  intro.textContent =
    'Esta aplicación reempaqueta pronósticos de terceros. No produce predicción propia y no ' +
    'sustituye a los avisos oficiales del INAMHI ni del Servicio Nacional de Gestión de Riesgos. ' +
    'Las limitaciones siguientes son parte del producto, no una advertencia legal de relleno.';
  host.appendChild(intro);

  if (backtest) {
    const m = backtest._meta;
    const r = backtest.resultado;
    const box = document.createElement('div');
    box.className = 'metricas';
    box.innerHTML = `
      <h4>Qué tan bien acierta este sistema (medición real, no estimada)</h4>
      <p class="met-sub">Ventana verificada: ${m.start} → ${m.end} (${m.days} días) ·
        ${r.n_casos} pares provincia-día · pronóstico emitido con 24 h de anticipación
        contra reanálisis ERA5 del día.</p>
      <div class="met-grid">
        <div class="met"><span class="met-num">${pctTxt(r.exactitud_estado_completo)}</span>
          <span class="met-lab">coincidencia exacta del estado de alerta</span></div>
        <div class="met"><span class="met-num">${pctTxt(r.exactitud_alerta_binaria)}</span>
          <span class="met-lab">acuerdo en "hay / no hay alerta"</span></div>
        <div class="met met-warn"><span class="met-num">${pctTxt(r.baseline_nunca_alertar)}</span>
          <span class="met-lab">acierto de no alertar nunca (baseline trivial)</span></div>
        <div class="met"><span class="met-num">${pctTxt(r.subconjunto_con_evento?.exactitud)}</span>
          <span class="met-lab">acierto sólo en días con evento (n=${r.subconjunto_con_evento?.n ?? 0})</span></div>
      </div>
      <p class="met-aviso"><strong>Cómo leer esto:</strong> los eventos extremos son raros, así que
      una exactitud global alta se consigue casi con no alertar nunca. La cifra que de verdad mide
      utilidad es la de los días con evento y el POD/FAR por categoría de abajo. Se publican las
      cuatro juntas a propósito.</p>`;

    const tabla = document.createElement('table');
    tabla.className = 'tabla-cat';
    tabla.innerHTML =
      '<thead><tr><th>Categoría</th><th>Eventos observados</th><th>Detección (POD)</th>' +
      '<th>Falsas alarmas (FAR)</th><th>CSI</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const k of CATEGORIES) {
      const s = r.por_categoria[k];
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${CATEGORY_LABELS[k]}</td><td>${s.eventos_observados}</td>` +
        `<td>${pctTxt(s.POD)}</td><td>${pctTxt(s.FAR)}</td><td>${pctTxt(s.CSI)}</td>`;
      tb.appendChild(tr);
    }
    tabla.appendChild(tb);
    box.appendChild(tabla);
    host.appendChild(box);
  }

  const lista = document.createElement('ul');
  lista.className = 'limitaciones';
  const items = [
    ['Un punto por provincia', 'El pronóstico se muestrea en la capital provincial. Provincias grandes o con fuerte gradiente altitudinal (Pichincha, Loja, Morona Santiago) pueden tener condiciones muy distintas a pocos kilómetros. La alerta NO es válida a nivel cantonal aunque el mapa pinte toda la provincia.'],
    ['Verificado contra reanálisis, no contra pluviómetros', 'El "observado" del backtest es ERA5 (ECMWF), un reanálisis de ~28 km. En terreno montañoso subestima la lluvia orográfica y suaviza los extremos. Comparar contra estaciones del INAMHI daría un resultado distinto, probablemente peor para lluvia extrema.'],
    ['La sequía casi no se pronostica: se arrastra', 'El acumulado de 30 días depende sobre todo de lluvia ya ocurrida. Su alto acierto a 24 h refleja persistencia, no habilidad predictiva. No se debe leer como "el sistema predice sequías".'],
    ['Sólo la anticipación de 24 h está verificada', 'La app muestra hasta 7 días, pero la métrica publicada corresponde exclusivamente al pronóstico emitido con 24 h de anticipación. A mayor plazo el desempeño baja y no se ha medido aquí.'],
    ['El ONI es mensual y llega con rezago', 'La fase ENSO usada para modular umbrales tiene 1-2 meses de retraso respecto al día pronosticado. Es contexto estacional, no una señal del día.'],
    ['La modulación ENSO es una hipótesis, no un hecho medido por provincia', 'Los coeficientes que ajustan los umbrales según el ONI reflejan el patrón documentado (El Niño → más lluvia en la costa ecuatoriana). Su efecto neto se mide en el backtest, pero no está calibrado provincia por provincia.'],
    ['Sin datos de exposición ni vulnerabilidad', 'Una alerta naranja indica una anomalía meteorológica poco frecuente, no un impacto. No incorpora población, infraestructura, cauces, pendientes ni capacidad de respuesta. El riesgo de inundación real depende de todo eso.'],
    ['Depende de servicios de terceros', 'Si Open-Meteo no responde, la app lo dice y no muestra alertas. Nunca rellena con el último valor conocido ni con datos generados.'],
  ];
  for (const [t, d] of items) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${t}.</strong> ${d}`;
    lista.appendChild(li);
  }
  host.appendChild(lista);
}
