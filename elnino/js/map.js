/**
 * Mapa de provincias en SVG puro, sin librerías ni CDN.
 * Los polígonos vienen pre-proyectados en data/provinces.geo.json.
 */
import { SEVERITY_COLORS, SEVERITY_LABELS, CATEGORY_LABELS } from './lib/classifier.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * @param {HTMLElement} host
 * @param {object} geo         contenido de provinces.geo.json
 * @param {Array} provincias
 * @param {Record<string,{max:number, active:string[]}>} estado  por id de provincia
 * @param {(id:string)=>void} onSelect
 */
export function renderMap(host, geo, provincias, estado, onSelect) {
  host.textContent = '';

  const [, , mw, mh] = geo._meta.viewBox_continental.split(' ').map(Number);
  const svg = el('svg', {
    viewBox: `0 0 ${mw} ${mh}`,
    class: 'mapa-svg',
    role: 'img',
    'aria-label': 'Mapa de severidad de alertas por provincia del Ecuador continental',
  });

  const nombreDe = Object.fromEntries(provincias.map((p) => [p.id, p.nombre]));

  for (const p of provincias) {
    const info = geo.paths[p.id];
    if (!info || info.inset) continue;
    const st = estado[p.id] || { max: 0, active: [] };
    const path = el('path', {
      d: info.d,
      fill: SEVERITY_COLORS[st.max],
      class: 'provincia' + (st.max > 0 ? ' con-alerta' : ''),
      'data-id': p.id,
      tabindex: '0',
      role: 'button',
    });
    const cats = st.active.map((c) => CATEGORY_LABELS[c]).join(', ');
    const title = el('title');
    title.textContent =
      `${p.nombre} — alerta ${SEVERITY_LABELS[st.max]}` + (cats ? ` (${cats})` : '');
    path.appendChild(title);
    path.addEventListener('click', () => onSelect(p.id));
    path.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(p.id); }
    });
    svg.appendChild(path);
  }

  // Etiquetas: sólo en provincias con alerta, para no saturar el mapa.
  for (const p of provincias) {
    const info = geo.paths[p.id];
    if (!info || info.inset) continue;
    const st = estado[p.id] || { max: 0 };
    if (st.max === 0) continue;
    const t = el('text', {
      x: info.centro[0], y: info.centro[1],
      class: 'etiqueta-provincia',
      'text-anchor': 'middle',
    });
    t.textContent = nombreDe[p.id];
    svg.appendChild(t);
  }

  host.appendChild(svg);

  // Recuadro de Galápagos con su propia escala.
  const g = geo.paths.galapagos;
  if (g) {
    const [, , iw, ih] = geo._meta.viewBox_insular.split(' ').map(Number);
    const wrap = document.createElement('div');
    wrap.className = 'inset-galapagos';
    const isvg = el('svg', { viewBox: `0 0 ${iw} ${ih}`, role: 'img', 'aria-label': 'Galápagos' });
    const st = estado.galapagos || { max: 0, active: [] };
    const path = el('path', {
      d: g.d, fill: SEVERITY_COLORS[st.max],
      class: 'provincia' + (st.max > 0 ? ' con-alerta' : ''),
      'data-id': 'galapagos', tabindex: '0', role: 'button',
    });
    const title = el('title');
    title.textContent = `Galápagos — alerta ${SEVERITY_LABELS[st.max]}`;
    path.appendChild(title);
    path.addEventListener('click', () => onSelect('galapagos'));
    isvg.appendChild(path);
    wrap.appendChild(isvg);
    const cap = document.createElement('span');
    cap.className = 'inset-caption';
    cap.textContent = 'Galápagos (escala distinta)';
    wrap.appendChild(cap);
    host.appendChild(wrap);
  }
}

export function renderLeyenda(host) {
  host.textContent = '';
  SEVERITY_LABELS.forEach((label, i) => {
    const item = document.createElement('span');
    item.className = 'leyenda-item';
    const sw = document.createElement('span');
    sw.className = 'leyenda-color';
    sw.style.background = SEVERITY_COLORS[i];
    item.appendChild(sw);
    item.appendChild(document.createTextNode(i === 0 ? 'Sin alerta' : `Alerta ${label}`));
    host.appendChild(item);
  });
}
