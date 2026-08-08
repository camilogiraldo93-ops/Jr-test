import { el } from './ui.js';

/**
 * Descarga una tabla como archivo que Excel abre de un doble clic.
 *
 * Se usa punto y coma como separador y se antepone el BOM porque es lo que Excel
 * espera en configuraciones regionales de habla hispana: con coma y sin BOM, la
 * hoja se abre con todo en una sola columna y los acentos rotos.
 */
export function descargarExcel(nombreArchivo, encabezados, filas) {
  const escapar = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const contenido = [encabezados, ...filas].map((f) => f.map(escapar).join(';')).join('\r\n');
  const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nombreArchivo });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Botón estándar «Exportar a Excel» para cualquier tabla de la app. */
export function botonExcel(nombreArchivo, encabezados, obtenerFilas, clase = 'btn sec chico') {
  return el('button', {
    clase, type: 'button', texto: '⬇️ Exportar a Excel',
    onclick: () => descargarExcel(nombreArchivo, encabezados, obtenerFilas()),
  });
}
