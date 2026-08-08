/** Utilidades de interfaz: creación de nodos, modales, avisos y formatos. */

export function el(etiqueta, props = {}, hijos = []) {
  const nodo = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'clase') nodo.className = v;
    else if (k === 'html') nodo.innerHTML = v;
    else if (k === 'texto') nodo.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2), v);
    else if (k === 'datos') Object.entries(v).forEach(([dk, dv]) => { nodo.dataset[dk] = dv; });
    else if (k in nodo && k !== 'list' && k !== 'form') nodo[k] = v;
    else nodo.setAttribute(k, v);
  }
  for (const h of [].concat(hijos)) {
    if (h === null || h === undefined || h === false) continue;
    nodo.appendChild(typeof h === 'string' || typeof h === 'number' ? document.createTextNode(String(h)) : h);
  }
  return nodo;
}

export function limpiar(nodo) {
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  return nodo;
}

/* -------------------------------- Avisos -------------------------------- */

export function aviso(mensaje, tipo = 'info', titulo = '') {
  const cont = document.getElementById('avisos');
  const n = el('div', { clase: `aviso ${tipo}` }, [
    titulo ? el('b', { texto: titulo }) : null,
    el('span', { texto: mensaje }),
  ]);
  cont.appendChild(n);
  setTimeout(() => {
    n.style.opacity = '0';
    n.style.transition = 'opacity .3s';
    setTimeout(() => n.remove(), 320);
  }, tipo === 'error' ? 7000 : 4000);
}

export const exito = (m, t = 'Listo') => aviso(m, 'exito', t);
export const error = (m, t = 'No se pudo completar') => aviso(m, 'error', t);

/* -------------------------------- Modales ------------------------------- */

export function modal({ titulo, cuerpo, pie = [], ancho = false, alCerrar }) {
  const cont = document.getElementById('modales');
  const cerrar = () => {
    fondo.remove();
    document.removeEventListener('keydown', esc);
    if (alCerrar) alCerrar();
  };
  const esc = (e) => { if (e.key === 'Escape') cerrar(); };

  const caja = el('div', { clase: `modal${ancho ? ' ancho' : ''}` }, [
    el('div', { clase: 'modal-cab' }, [
      el('h3', { texto: titulo }),
      el('button', { type: 'button', texto: '×', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: cerrar }),
    ]),
    el('div', { clase: 'modal-cuerpo' }, [cuerpo]),
    pie.length ? el('div', { clase: 'modal-pie' }, pie) : null,
  ]);

  const fondo = el('div', {
    clase: 'modal-fondo',
    onclick: (e) => { if (e.target === fondo) cerrar(); },
  }, [caja]);

  cont.appendChild(fondo);
  document.addEventListener('keydown', esc);
  // El foco se coloca de inmediato, no con un temporizador: si se difiere, quien
  // empieza a escribir en otro campo antes de que salte ve cómo el texto se le va
  // al primero.
  const primer = caja.querySelector('input, select, textarea');
  if (primer) primer.focus({ preventScroll: true });
  return { cerrar, caja, fondo };
}

export function confirmar(titulo, mensaje) {
  return new Promise((resolver) => {
    let decidido = false;
    const m = modal({
      titulo,
      cuerpo: el('p', { texto: mensaje }),
      alCerrar: () => { if (!decidido) resolver(false); },
      pie: [
        el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => { decidido = true; m.cerrar(); resolver(false); } }),
        el('button', { clase: 'btn', type: 'button', texto: 'Confirmar', onclick: () => { decidido = true; m.cerrar(); resolver(true); } }),
      ],
    });
  });
}

/* -------------------------------- Campos -------------------------------- */

export function campo(etiqueta, entrada, ayuda) {
  return el('div', { clase: 'campo' }, [
    el('label', { texto: etiqueta, for: entrada.id || undefined }),
    entrada,
    ayuda ? el('div', { clase: 'ayuda', texto: ayuda }) : null,
  ]);
}

export function entrada(nombre, props = {}) {
  return el('input', { name: nombre, id: `c_${nombre}_${Math.random().toString(36).slice(2, 7)}`, ...props });
}

export function area(nombre, props = {}) {
  return el('textarea', { name: nombre, ...props });
}

export function selector(nombre, opciones, valor, props = {}) {
  const s = el('select', { name: nombre, ...props });
  for (const o of opciones) {
    const op = el('option', { value: String(o.valor), texto: o.texto });
    if (String(o.valor) === String(valor)) op.selected = true;
    s.appendChild(op);
  }
  return s;
}

/**
 * Comprueba los campos obligatorios y avisa con nuestras palabras.
 *
 * El globo nativo del navegador sale en el idioma del navegador —«Please fill
 * out this field» en un Chrome en inglés— y desaparece al primer clic. Aquí se
 * nombra el campo que falta, se lleva el foco hasta él y el aviso se queda.
 * Devuelve true si el formulario está listo para enviarse.
 */
export function formularioCompleto(form) {
  const faltan = [...form.querySelectorAll('input, select, textarea')].filter((c) => !c.checkValidity());
  if (!faltan.length) return true;

  const primero = faltan[0];
  const etiqueta = primero.closest('.campo')?.querySelector('label')?.textContent
    ?.replace(/\s*\*\s*$/, '').trim();
  const nombre = etiqueta || primero.name || 'un dato';
  error(primero.validity.valueMissing
    ? `Falta llenar «${nombre}». Escríbelo y vuelve a guardar.`
    : `«${nombre}» no está bien escrito. Revísalo y vuelve a guardar.`, 'Falta un dato');
  primero.focus({ preventScroll: false });
  primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return false;
}

/** Lee un formulario como objeto plano. */
export function datosFormulario(form) {
  const d = {};
  for (const [k, v] of new FormData(form).entries()) d[k] = typeof v === 'string' ? v.trim() : v;
  return d;
}

/* --------------------------- Palabras del consultorio -------------------- */

// La base de datos guarda códigos ('recepcion', 'nomina', 'ause'). En pantalla
// nunca se muestra un código: se muestra lo que la gente dice en voz alta.

export const NOMBRE_ROL = {
  admin: 'Administradora', doctor: 'Doctor o doctora', recepcion: 'Recepción',
};

export const NOMBRE_CATEGORIA_GASTO = {
  insumos: 'Insumos y materiales', nomina: 'Sueldos', alquiler: 'Arriendo del local',
  servicios: 'Luz, agua, internet', equipos: 'Equipos',
  mantenimiento: 'Mantenimiento y reparaciones', marketing: 'Publicidad', otro: 'Otro',
};

export const NOMBRE_METODO_PAGO = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  seguro: 'Seguro', otro: 'Otro',
};

export const NOMBRE_PRIORIDAD = { baja: 'Puede esperar', media: 'Normal', alta: 'Urgente' };

export const NOMBRE_ESTADO_PENDIENTE = {
  pendiente: 'Por hacer', completado: 'Hecho', cancelado: 'Ya no aplica',
};

export const NOMBRE_DIENTE = {
  sano: 'Sano', caries: 'Caries', obturado: 'Con calza', corona: 'Con corona',
  ausente: 'Falta', endodoncia: 'Con tratamiento de conducto', implante: 'Con implante',
  fractura: 'Fracturado', sellante: 'Con sellante',
};

/**
 * «1 cita» / «2 citas», sin el «(s)» de programador.
 * El plural se pasa entero porque en español no siempre basta con añadir una s.
 */
export function plural(n, singular, muchos) {
  return `${n} ${n === 1 ? singular : muchos}`;
}

/* ---------------------------- Nombres de personas ------------------------ */

// Los apellidos son opcionales: quien llama por teléfono a veces solo deja el
// nombre. Estas dos funciones evitan que eso se vea como ", Juan" o "Juan ".

/** Para listas ordenadas alfabéticamente: «González Pérez, María». */
export function nombreLista(nombre, apellidos) {
  return apellidos ? `${apellidos}, ${nombre}` : String(nombre || '');
}

/** Para títulos y saludos: «María González Pérez». */
export function nombreCompleto(nombre, apellidos) {
  return [nombre, apellidos].filter(Boolean).join(' ');
}

/* -------------------------------- Formato ------------------------------- */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * Formato monetario fijo (USD): $1,234.56.
 * No usa toLocaleString a propósito: los datos de configuración regional varían entre
 * navegadores y darían separadores distintos en un mismo consultorio.
 */
export function fmtDinero(n) {
  const v = Number(n) || 0;
  const signo = v < 0 ? '-' : '';
  const abs = Math.abs(v).toFixed(2);
  const [entero, decimales] = abs.split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${conMiles}.${decimales}`;
}

export function fmtFecha(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [a, m, d] = s.split('-').map(Number);
  if (!a || !m || !d) return s;
  return `${d} ${MESES[m - 1]} ${a}`;
}

export function fmtFechaCorta(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10).split('-').reverse().join('/');
}

export function fmtHora(iso) {
  if (!iso) return '';
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

export function fmtFechaHora(iso) {
  if (!iso) return '—';
  const h = fmtHora(iso);
  return h ? `${fmtFechaCorta(iso)} ${h}` : fmtFechaCorta(iso);
}

export function fmtMarca(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function nombreDia(fechaIso) {
  const d = new Date(`${String(fechaIso).slice(0, 10)}T12:00:00`);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
}

export function hoyIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Suma minutos a una hora 'HH:MM'. */
export function sumarMinutos(hora, minutos) {
  const [h, m] = hora.split(':').map(Number);
  const total = h * 60 + m + Number(minutos);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
}

export const ETIQUETAS_ESTADO = {
  agendada: 'Agendada', confirmada: 'Confirmada', en_curso: 'En curso',
  completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió',
};

export function etiquetaEstado(estado) {
  return el('span', { clase: `eti ${estado}`, texto: ETIQUETAS_ESTADO[estado] || estado });
}

export function vacio(mensaje) {
  return el('div', { clase: 'vacio', texto: mensaje });
}
