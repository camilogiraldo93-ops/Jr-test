/**
 * Descarga la serie ONI de NOAA CPC y la guarda como snapshot versionado en
 * elnino/data/oni.json.
 *
 * Se necesita un snapshot porque NOAA no envía cabeceras CORS: el navegador no
 * puede leer ese archivo directamente. La app muestra siempre la fecha del
 * snapshot y la temporada más reciente disponible, sin extrapolar.
 *
 * Uso: node tools/build-oni.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';

const res = await fetch(SRC);
if (!res.ok) throw new Error(`NOAA CPC devolvió HTTP ${res.status}`);
const text = await res.text();

const seasons = [];
for (const line of text.split('\n')) {
  const m = line.trim().match(/^([A-Z]{3})\s+(\d{4})\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)$/);
  if (!m) continue;
  seasons.push({ seas: m[1], year: Number(m[2]), total: Number(m[3]), anom: Number(m[4]) });
}
if (seasons.length < 100) throw new Error(`parseo sospechoso: sólo ${seasons.length} temporadas`);

const out = {
  _meta: {
    fuente: 'NOAA Climate Prediction Center — Oceanic Niño Index (ONI)',
    url: SRC,
    definicion: 'Media móvil de 3 meses de la anomalía de TSM en la región Niño 3.4 (5N-5S, 170W-120W), base ERSSTv5 con climatología centrada móvil de 30 años.',
    descargado: new Date().toISOString(),
    motivo_snapshot: 'NOAA CPC no envía cabeceras CORS; un navegador no puede descargar este archivo directamente. La app muestra la fecha de este snapshot y no extrapola valores más recientes.',
    umbrales_noaa: 'El Niño: ONI >= +0.5 durante 5 trimestres solapados consecutivos. La Niña: ONI <= -0.5.',
  },
  seasons,
  latest: seasons[seasons.length - 1],
};

const dest = path.join(ROOT, 'elnino/data/oni.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`ONI: ${seasons.length} temporadas, última ${out.latest.seas} ${out.latest.year} = ${out.latest.anom} °C`);
console.log(`Escrito ${dest}`);
