/**
 * Genera elnino/data/provinces.geo.json: los polígonos de las 24 provincias del
 * Ecuador ya simplificados y proyectados a coordenadas SVG, para que la app no
 * dependa de ninguna librería de mapas ni de un CDN externo en tiempo de carga.
 *
 * Fuente: geoBoundaries (gbOpen), ADM1 de ECU — dominio público / CC-BY 4.0.
 *   https://www.geoboundaries.org/
 *
 * Galápagos se proyecta aparte (recuadro), porque su longitud (~-89.6°) deformaría
 * la escala del territorio continental si compartieran el mismo viewBox.
 *
 * Uso: node tools/build-geo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://www.geoboundaries.org/api/current/gbOpen/ECU/ADM1/';

const provinces = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'elnino/data/provinces.json'), 'utf8'),
).provincias;

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Alias para nombres que geoBoundaries escribe distinto.
const ALIASES = {
  santodomingodelostsachilas: 'santo-domingo',
  santodomingodelostsachila: 'santo-domingo',
  santodomingo: 'santo-domingo',
  losrios: 'los-rios',
  eloro: 'el-oro',
  moronasantiago: 'morona-santiago',
  zamorachinchipe: 'zamora-chinchipe',
  santaelena: 'santa-elena',
  galapagos: 'galapagos',
  sucumbios: 'sucumbios',
  canar: 'canar',
  bolivar: 'bolivar',
};

function idFor(shapeName) {
  const n = norm(shapeName);
  if (ALIASES[n]) return ALIASES[n];
  const hit = provinces.find((p) => norm(p.nombre) === n || norm(p.id) === n);
  return hit ? hit.id : null;
}

/** Distancia perpendicular de P al segmento AB (o a A si AB es degenerado). */
function perpDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const den = Math.hypot(dx, dy);
  if (den < 1e-12) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / den;
}

/** Ramer–Douglas–Peucker sobre una polilínea abierta. */
function rdpOpen(points, eps) {
  if (points.length < 3) return points;
  let maxD = -1;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...rdpOpen(points.slice(0, idx + 1), eps).slice(0, -1), ...rdpOpen(points.slice(idx), eps)];
}

/**
 * RDP sobre un anillo cerrado. Aplicarlo directamente lo destruiría: como el
 * primer y el último punto coinciden, la recta de referencia es degenerada y
 * todas las distancias salen cero, colapsando el polígono a un segmento. Por eso
 * el anillo se parte en dos polilíneas por el vértice más alejado del inicial.
 */
function rdp(ring, eps) {
  const pts = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  if (pts.length < 4) return ring;

  let far = 1;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = rdpOpen(pts.slice(0, far + 1), eps);
  const b = rdpOpen(pts.slice(far), eps);
  const out = [...a.slice(0, -1), ...b];
  out.push(out[0]); // volver a cerrar
  return out;
}

function ringsOf(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.map((r) => r);
  if (geom.type === 'MultiPolygon') return geom.coordinates.flatMap((poly) => poly.map((r) => r));
  return [];
}

/** Proyección equirectangular con corrección de longitud por latitud media. */
function makeProjector(bounds, width, height, pad) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const w = (maxLon - minLon) * kx;
  const h = maxLat - minLat;
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const offX = (width - w * scale) / 2;
  const offY = (height - h * scale) / 2;
  return ([lon, lat]) => [
    offX + (lon - minLon) * kx * scale,
    offY + (maxLat - lat) * scale,
  ];
}

function boundsOf(rings) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const r of rings) for (const [lon, lat] of r) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function toPath(rings, project) {
  return rings
    .map((r) => {
      const pts = r.map(project).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
      return 'M' + pts.join('L') + 'Z';
    })
    .join('');
}

const MAIN = { width: 620, height: 780, pad: 12 };
const INSET = { width: 190, height: 130, pad: 8 };

async function main() {
  const meta = await (await fetch(API)).json();
  const entry = Array.isArray(meta) ? meta[0] : meta;
  const url = entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL;
  console.log('Descargando', url);
  const gj = await (await fetch(url)).json();

  const byId = {};
  const unmatched = [];
  for (const f of gj.features) {
    const name = f.properties.shapeName;
    const id = idFor(name);
    if (!id) { unmatched.push(name); continue; }
    // Descartar islotes minúsculos: se conservan los anillos con área relativa útil.
    let rings = ringsOf(f.geometry)
      .map((r) => rdp(r, 0.008))
      .filter((r) => r.length >= 4);
    const areaOf = (r) => {
      let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
      }
      return Math.abs(a / 2);
    };
    const maxA = Math.max(...rings.map(areaOf));
    rings = rings.filter((r) => areaOf(r) >= maxA * 0.02);
    byId[id] = rings;
  }
  if (unmatched.length) console.log('SIN EMPAREJAR:', unmatched);
  const missing = provinces.filter((p) => !byId[p.id]).map((p) => p.nombre);
  if (missing.length) throw new Error('Faltan provincias en el GeoJSON: ' + missing.join(', '));

  const mainlandIds = provinces.filter((p) => p.id !== 'galapagos').map((p) => p.id);
  const mainRings = mainlandIds.flatMap((id) => byId[id]);
  const projMain = makeProjector(boundsOf(mainRings), MAIN.width, MAIN.height, MAIN.pad);
  const projIns = makeProjector(boundsOf(byId.galapagos), INSET.width, INSET.height, INSET.pad);

  const paths = {};
  for (const p of provinces) {
    const isG = p.id === 'galapagos';
    paths[p.id] = {
      d: toPath(byId[p.id], isG ? projIns : projMain),
      inset: isG,
      centro: (isG ? projIns : projMain)([p.lon, p.lat]).map((v) => Math.round(v * 10) / 10),
    };
  }

  const out = {
    _meta: {
      fuente: 'geoBoundaries gbOpen ADM1 ECU (https://www.geoboundaries.org/)',
      licencia: 'Open Data — geoBoundaries, CC BY 4.0',
      procesamiento: 'Simplificación Ramer–Douglas–Peucker (ε=0.008°) y proyección equirectangular a coordenadas SVG.',
      advertencia: 'Geometría simplificada para visualización; no apta para uso catastral ni legal.',
      generado: new Date().toISOString().slice(0, 10),
      viewBox_continental: `0 0 ${MAIN.width} ${MAIN.height}`,
      viewBox_insular: `0 0 ${INSET.width} ${INSET.height}`,
    },
    paths,
  };
  const dest = path.join(ROOT, 'elnino/data/provinces.geo.json');
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`Escrito ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
