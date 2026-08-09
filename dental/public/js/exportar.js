import { el, exito } from './ui.js';

/**
 * Descarga una tabla como archivo que Excel abre de un doble clic.
 *
 * Las tres convenciones tienen que ir juntas o el archivo no sirve:
 *   · BOM al principio, para que los acentos no se rompan;
 *   · punto y coma entre columnas;
 *   · coma como separador decimal.
 * Un Excel en español reparte columnas por `;` y espera `210,75`. Si se mezcla
 * `;` con `210.75` —como estaba— no funciona en ninguna configuración: en
 * español la columna de dinero entra como texto y deja de sumar, y en inglés
 * toda la fila cae en una sola celda.
 */
export function descargarExcel(nombreArchivo, encabezados, filas) {
  const celda = (v) => {
    if (v === null || v === undefined) return '';
    // Los números se escriben con coma decimal; el texto se escapa.
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const contenido = [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
  const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nombreArchivo });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // Sin aviso, lo único que confirma la descarga es la barra del navegador.
  exito(`Listo, se descargó «${nombreArchivo}». Ábrelo con Excel.`);
}

/** Botón estándar «Exportar a Excel» para cualquier tabla de la app. */
export function botonExcel(nombreArchivo, encabezados, obtenerFilas, clase = 'btn sec chico') {
  return el('button', {
    clase, type: 'button', texto: '⬇️ Exportar a Excel',
    onclick: () => descargarExcel(nombreArchivo, encabezados, obtenerFilas()),
  });
}
