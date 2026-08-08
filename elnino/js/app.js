/**
 * Orquestador de la app.
 *
 * Flujo en cada carga: descarga datos reales → clasifica con el mismo motor que
 * se verificó en el backtest → pinta mapa y tarjetas. Si una fuente falla, se
 * muestra el error; nunca se rellena con datos inventados ni cacheados.
 */
import { classifyDay, ensoPhase, CATEGORIES, CATEGORY_LABELS, DEFAULT_CONFIG, SEVERITY_LABELS } from './lib/classifier.js';
import { doyIndexFromISO } from './lib/doy.js';
import { oniForDate } from './lib/oni.js';
import { fetchDeterministic, fetchEnsembleSpread, fetchSST, spreadStats, UNCERTAINTY_MODELS } from './sources.js';
import { renderMap, renderLeyenda } from './map.js';
import { tarjetaAlerta, panelENSO, panelLimitaciones, fechaLarga } from './ui.js';

const $ = (sel) => document.querySelector(sel);

/** Unidad y variable del ensemble asociada a cada categoría. */
const CAT_VAR = {
  lluvia_extrema: { variable: 'pr', unidad: 'mm' },
  inundacion: { variable: 'pr', unidad: 'mm' },
  ola_calor: { variable: 'tmax', unidad: '°C' },
  sequia: { variable: 'pr', unidad: 'mm' },
};

const estado = {
  provincias: null, clim: null, geo: null, oni: null, backtest: null,
  det: null, ens: null, sst: null,
  dias: [], diaSel: null, alertas: [], porProvincia: {},
  provinciaSel: null, filtro: 'todas',
};

async function cargarJSON(ruta) {
  const res = await fetch(ruta);
  if (!res.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${res.status})`);
  return res.json();
}

/** Fecha de hoy en zona horaria de Ecuador, como 'YYYY-MM-DD'. */
function hoyEcuador() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Horas entre ahora y el inicio (00:00) del día indicado en hora de Ecuador. */
function horasDeAnticipacion(diaISO) {
  // Ecuador continental es UTC-5 todo el año (sin horario de verano).
  const inicio = new Date(`${diaISO}T00:00:00-05:00`);
  return Math.round((inicio - Date.now()) / 3600000);
}

function climEn(provId, iso) {
  const c = estado.clim.provincias[provId];
  const d = doyIndexFromISO(iso);
  const out = {};
  for (const k of Object.keys(c)) out[k] = c[k][d];
  return out;
}

/** Suma de una ventana de la serie diaria; null si falta algún dato. */
function suma(serie, desde, hasta) {
  let s = 0;
  for (let i = desde; i <= hasta; i++) {
    if (i < 0 || i >= serie.length || serie[i] == null) return null;
    s += serie[i];
  }
  return s;
}

/**
 * Clasifica cada provincia para cada día pronosticado y arma la lista de alertas.
 */
function construirAlertas() {
  const alertas = [];
  const porProvinciaDia = {};

  for (const p of estado.provincias) {
    const d = estado.det[p.id];
    if (!d) continue;
    const idx = new Map(d.time.map((t, i) => [t, i]));
    const ens = estado.ens?.[p.id];
    const ensIdx = ens ? new Map(ens.time.map((t, i) => [t, i])) : null;

    for (const dia of estado.dias) {
      const i = idx.get(dia);
      if (i == null || d.pr[i] == null || d.tmax[i] == null) continue;

      const pr3 = suma(d.pr, i - 2, i);
      const pr30 = suma(d.pr, i - 29, i);
      const clim = climEn(p.id, dia);
      const entrada = oniForDate(estado.oni, dia);
      const oniVal = entrada ? entrada.anom : null;

      const r = classifyDay(
        { pr: d.pr[i], pr3, pr30, tmax: d.tmax[i], clim, region: p.region, oni: oniVal },
        DEFAULT_CONFIG,
      );
      (porProvinciaDia[dia] ||= {})[p.id] = { max: r.max, active: r.active };

      const anticipacion = horasDeAnticipacion(dia);
      for (const cat of CATEGORIES) {
        if (r.levels[cat] === 0) continue;
        const { variable, unidad } = CAT_VAR[cat];
        const spread = ensIdx ? spreadStats(ens, ensIdx, dia, variable) : null;

        // Umbral efectivo mostrado en la tarjeta (el del nivel amarillo, que es
        // el que define "hay alerta o no").
        const cfg = DEFAULT_CONFIG;
        const umbral =
          cat === 'lluvia_extrema' ? clim[cfg.rain.pctYellow]
          : cat === 'inundacion' ? clim[cfg.flood.pctYellow]
          : cat === 'ola_calor' ? clim[cfg.heat.pctYellow]
          : clim[cfg.drought.pctYellow];

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
          unidad,
          spread,
          modelosQueSuperan: superan,
          evidencia: { pr: d.pr[i], pr3, pr30, tmax: d.tmax[i], umbral, pr30Mean: clim.pr30Mean },
        });
      }
    }
  }

  estado.alertas = alertas;
  estado.porProvincia = porProvinciaDia;
}

function pintarSelectorDias() {
  const host = $('#selector-dias');
  host.textContent = '';
  for (const dia of estado.dias) {
    const h = horasDeAnticipacion(dia);
    const b = document.createElement('button');
    b.className = 'dia' + (dia === estado.diaSel ? ' activo' : '') + (h < 24 ? ' sin-anticipacion' : '');
    const conAlerta = Object.values(estado.porProvincia[dia] || {}).filter((v) => v.max > 0).length;
    b.innerHTML =
      `<span class="dia-fecha">${fechaLarga(dia).replace(/^\w/, (c) => c.toUpperCase())}</span>` +
      `<span class="dia-meta">${h >= 24 ? `+${h} h` : 'menos de 24 h'} · ${conAlerta} prov. con alerta</span>`;
    b.addEventListener('click', () => { estado.diaSel = dia; pintarTodo(); });
    host.appendChild(b);
  }
}

function pintarMapa() {
  renderMap(
    $('#mapa'), estado.geo, estado.provincias,
    estado.porProvincia[estado.diaSel] || {},
    (id) => { estado.provinciaSel = estado.provinciaSel === id ? null : id; pintarAlertas(); pintarMapa(); },
  );
  document.querySelectorAll('#mapa .provincia').forEach((n) => {
    n.classList.toggle('seleccionada', n.dataset.id === estado.provinciaSel);
  });
}

function pintarAlertas() {
  const host = $('#lista-alertas');
  host.textContent = '';

  let lista = estado.alertas.filter((a) => a.dia === estado.diaSel);
  if (estado.provinciaSel) lista = lista.filter((a) => a.provinciaId === estado.provinciaSel);
  if (estado.filtro !== 'todas') lista = lista.filter((a) => a.categoria === estado.filtro);
  lista.sort((a, b) => b.nivel - a.nivel || a.provincia.localeCompare(b.provincia));

  const cab = $('#resumen-alertas');
  const anticip = horasDeAnticipacion(estado.diaSel);
  cab.innerHTML =
    `<strong>${lista.length}</strong> alerta(s) para el ${fechaLarga(estado.diaSel)}` +
    (estado.provinciaSel ? ` en ${estado.provincias.find((p) => p.id === estado.provinciaSel).nombre}` : '') +
    ` · anticipación ${anticip >= 0 ? '+' : ''}${anticip} h` +
    (anticip < 24 ? ' <span class="aviso-anticipacion">(por debajo del umbral de 24 h que este sistema verifica)</span>' : '');

  if (!lista.length) {
    const p = document.createElement('p');
    p.className = 'vacio';
    p.textContent = estado.provinciaSel
      ? 'Sin alertas para esta provincia en el día seleccionado. Haz clic de nuevo en el mapa para ver todas.'
      : 'Ninguna provincia supera hoy los umbrales climatológicos locales para este día.';
    host.appendChild(p);
    return;
  }
  for (const a of lista) host.appendChild(tarjetaAlerta(a, estado.backtest));
}

function pintarFiltros() {
  const host = $('#filtros');
  host.textContent = '';
  const opciones = [['todas', 'Todas las categorías'], ...CATEGORIES.map((c) => [c, CATEGORY_LABELS[c]])];
  for (const [val, txt] of opciones) {
    const b = document.createElement('button');
    b.className = 'filtro' + (estado.filtro === val ? ' activo' : '');
    const n = val === 'todas'
      ? estado.alertas.filter((a) => a.dia === estado.diaSel).length
      : estado.alertas.filter((a) => a.dia === estado.diaSel && a.categoria === val).length;
    b.textContent = `${txt} (${n})`;
    b.addEventListener('click', () => { estado.filtro = val; pintarFiltros(); pintarAlertas(); });
    host.appendChild(b);
  }
}

function pintarTodo() {
  pintarSelectorDias();
  pintarMapa();
  pintarFiltros();
  pintarAlertas();
}

function mostrarError(e) {
  $('#cargando').hidden = true;
  const box = $('#error');
  box.hidden = false;
  box.innerHTML =
    `<h2>No se pudieron obtener los datos</h2>` +
    `<p>${e.message}</p>` +
    `<p>Esta aplicación depende de las APIs abiertas de Open-Meteo. No muestra alertas con ` +
    `datos antiguos ni generados: si la fuente no responde, no hay alerta que mostrar.</p>` +
    `<button id="reintentar">Reintentar</button>`;
  $('#reintentar').addEventListener('click', () => location.reload());
}

async function main() {
  try {
    const [provinciasDoc, clim, geo, oni] = await Promise.all([
      cargarJSON('data/provinces.json'),
      cargarJSON('data/climatology.json'),
      cargarJSON('data/provinces.geo.json'),
      cargarJSON('data/oni.json'),
    ]);
    estado.provincias = provinciasDoc.provincias;
    estado.clim = clim;
    estado.geo = geo;
    estado.oni = oni;
    estado.backtest = await cargarJSON('data/backtest.json').catch(() => null);

    $('#estado-carga').textContent = 'Consultando Open-Meteo…';
    const [det, ens, sst] = await Promise.all([
      fetchDeterministic(estado.provincias),
      fetchEnsembleSpread(estado.provincias).catch((e) => {
        console.warn('Sin dispersión entre modelos:', e.message);
        return null;
      }),
      fetchSST(estado.provincias).catch(() => ({})),
    ]);
    estado.det = det;
    estado.ens = ens;
    estado.sst = sst;

    const hoy = hoyEcuador();
    const cualquiera = det[estado.provincias[0].id];
    estado.dias = cualquiera.time.filter((t) => t >= hoy);
    estado.diaSel = estado.dias.find((d) => horasDeAnticipacion(d) >= 24) || estado.dias[0];

    construirAlertas();

    const entrada = oniForDate(oni, hoy) || oni.latest;
    const sstLista = Object.entries(sst).map(([id, s]) => ({
      provincia: estado.provincias.find((p) => p.id === id)?.nombre || id,
      valor: s.max?.[0],
    })).filter((s) => s.valor != null);
    panelENSO($('#enso'), { oni, entrada, fase: ensoPhase(entrada.anom), sst: sstLista });
    panelLimitaciones($('#limitaciones-body'), estado.backtest);
    renderLeyenda($('#leyenda'));

    $('#actualizado').textContent =
      `Datos descargados el ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })} ` +
      `(hora de Ecuador), directamente desde el navegador.`;

    $('#cargando').hidden = true;
    $('#contenido').hidden = false;
    pintarTodo();
  } catch (e) {
    console.error(e);
    mostrarError(e);
  }
}

main();
