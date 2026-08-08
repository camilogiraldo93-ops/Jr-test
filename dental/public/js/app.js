import { api, sesion, ErrorApi } from './api.js';
import { el, limpiar, error, campo, entrada, exito, nombreCompleto } from './ui.js';
import { botonAyuda } from './ayuda.js';
import { vistaHoy } from './vistas/hoy.js';
import { vistaPanel } from './vistas/panel.js';
import { vistaAgenda } from './vistas/agenda.js';
import { vistaPacientes } from './vistas/pacientes.js';
import { vistaExpediente } from './vistas/expediente.js';
import { vistaCita } from './vistas/cita.js';
import { vistaContabilidad } from './vistas/contabilidad.js';
import { vistaRecordatorios } from './vistas/recordatorios.js';
import { vistaConfiguracion } from './vistas/configuracion.js';
import { vistaConsentimiento } from './vistas/consentimiento.js';
import { vistaImprimir } from './vistas/imprimir.js';

const app = document.getElementById('app');

const MENU = [
  { ruta: 'hoy', texto: 'El día de hoy', icono: '📖', roles: ['admin', 'doctor', 'recepcion'] },
  { ruta: 'agenda', texto: 'Agenda completa', icono: '📅', roles: ['admin', 'doctor', 'recepcion'] },
  { ruta: 'pacientes', texto: 'Pacientes', icono: '🧑‍⚕️', roles: ['admin', 'doctor', 'recepcion'] },
  { ruta: 'recordatorios', texto: 'Pendientes', icono: '🔔', roles: ['admin', 'doctor', 'recepcion'] },
  { ruta: 'contabilidad', texto: 'Dinero', icono: '💰', roles: ['admin'] },
  { ruta: 'panel', texto: 'Resumen', icono: '📊', roles: ['admin', 'doctor', 'recepcion'] },
  { ruta: 'configuracion', texto: 'Configuración', icono: '⚙️', roles: ['admin'] },
];

const VISTAS = {
  hoy: vistaHoy,
  panel: vistaPanel,
  agenda: vistaAgenda,
  pacientes: vistaPacientes,
  paciente: vistaExpediente,
  cita: vistaCita,
  recordatorios: vistaRecordatorios,
  contabilidad: vistaContabilidad,
  configuracion: vistaConfiguracion,
  consentimiento: vistaConsentimiento,
  imprimir: vistaImprimir,
};

/* --------------------------------- Login -------------------------------- */

function pantallaLogin() {
  const email = entrada('email', { type: 'email', required: true, placeholder: 'correo@clinica.com', autocomplete: 'username' });
  const pass = entrada('password', { type: 'password', required: true, placeholder: '••••••••', autocomplete: 'current-password' });
  const boton = el('button', { clase: 'btn', type: 'submit', texto: 'Entrar', style: 'width:100%' });
  const msg = el('div', { clase: 'alerta-caja', style: 'display:none' });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      msg.style.display = 'none';
      boton.disabled = true;
      boton.textContent = 'Entrando…';
      try {
        const r = await api.login(email.value, pass.value);
        sesion.token = r.token;
        sesion.usuario = r.usuario;
        location.hash = '#/hoy';
        await dibujar();
        exito(`Bienvenido/a, ${r.usuario.nombre}.`);
      } catch (err) {
        msg.textContent = err instanceof ErrorApi ? err.message : 'Error inesperado al iniciar sesión.';
        msg.style.display = 'block';
      } finally {
        boton.disabled = false;
        boton.textContent = 'Entrar';
      }
    },
  }, [
    campo('Correo electrónico', email),
    campo('Contraseña', pass),
    boton,
  ]);

  const rapido = (correo, clave, etiqueta) => el('button', {
    type: 'button', texto: etiqueta,
    onclick: () => { email.value = correo; pass.value = clave; form.requestSubmit(); },
  });

  return el('div', { clase: 'login-fondo' }, [
    el('div', { clase: 'login-caja' }, [
      el('h1', { texto: '🦷 DentalGest' }),
      el('p', { clase: 'sub', texto: 'Sistema de gestión para consultorios dentales' }),
      msg, form,
      el('div', { clase: 'demo-accesos' }, [
        el('div', { texto: 'Accesos de demostración:' }),
        rapido('admin@clinica.com', 'admin123', '👑 Administrador — admin@clinica.com'),
        rapido('ana.morales@clinica.com', 'doctor123', '🦷 Doctora — ana.morales@clinica.com'),
        rapido('recepcion@clinica.com', 'recepcion123', '💁 Recepción — recepcion@clinica.com'),
      ]),
    ]),
  ]);
}

/* --------------------------------- Marco -------------------------------- */

/**
 * Buscador de pacientes siempre a la vista. Muestra el teléfono en el propio
 * resultado: para llamar a alguien no hace falta entrar a su expediente.
 */
function buscadorGlobal() {
  const caja = entrada('busqueda_global', {
    type: 'search', placeholder: 'Buscar paciente por nombre o teléfono…', autocomplete: 'off',
  });
  const resultados = el('div', { clase: 'resultados-busqueda', style: 'display:none' });
  let temporizador = null;

  const cerrar = () => { resultados.style.display = 'none'; limpiar(resultados); };

  async function buscar() {
    const q = caja.value.trim();
    if (q.length < 2) { cerrar(); return; }
    let lista = [];
    try {
      lista = await api.pacientes(q);
    } catch {
      limpiar(resultados);
      resultados.appendChild(el('div', { clase: 'mini', texto: 'No se pudo buscar en este momento.' }));
      resultados.style.display = 'block';
      return;
    }
    limpiar(resultados);
    if (!lista.length) {
      resultados.appendChild(el('div', { clase: 'mini', texto: `Nadie se llama así: "${q}".` }));
    } else {
      for (const p of lista.slice(0, 8)) {
        resultados.appendChild(el('a', {
          clase: 'resultado', href: `#/paciente/${p.id}`,
          onclick: () => { caja.value = ''; cerrar(); },
        }, [
          el('span', { clase: 'r-nom', texto: nombreCompleto(p.nombre, p.apellidos) }),
          el('span', { clase: 'r-tel', texto: p.telefono ? `📞 ${p.telefono}` : 'sin teléfono anotado' }),
        ]));
      }
    }
    resultados.style.display = 'block';
  }

  caja.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { buscar(); }, 220);
  });
  caja.addEventListener('keydown', (e) => { if (e.key === 'Escape') { caja.value = ''; cerrar(); } });
  document.addEventListener('click', (e) => {
    if (!caja.contains(e.target) && !resultados.contains(e.target)) cerrar();
  });

  return el('div', { clase: 'buscador-global' }, [caja, resultados]);
}

function armarMarco() {
  const nav = el('nav', { clase: 'nav' },
    MENU.filter((m) => m.roles.includes(sesion.usuario.rol)).map((m) =>
      el('a', { href: `#/${m.ruta}`, datos: { ruta: m.ruta } }, [
        el('span', { clase: 'icono', texto: m.icono }),
        el('span', { clase: 'txt', texto: m.texto }),
      ])));

  const lateral = el('aside', { clase: 'lateral' }, [
    el('div', { clase: 'marca', html: '🦷 Dental<span>Gest</span>' }),
    buscadorGlobal(),
    nav,
    el('div', { clase: 'usuario-caja' }, [
      el('div', { clase: 'nom', texto: sesion.usuario.nombre }),
      el('div', { clase: 'rol', texto: sesion.usuario.rol }),
      el('button', {
        type: 'button', texto: 'Cerrar sesión',
        onclick: async () => {
          try { await api.logout(); } catch { /* la sesión local se limpia igual */ }
          sesion.token = null;
          sesion.usuario = null;
          location.hash = '';
          await dibujar();
        },
      }),
    ]),
  ]);

  const contenido = el('main', { clase: 'contenido', id: 'contenido' });
  return {
    marco: el('div', { clase: 'marco' }, [lateral, contenido, botonAyuda()]),
    contenido, nav,
  };
}

/* -------------------------------- Router -------------------------------- */

function rutaActual() {
  const h = location.hash.replace(/^#\/?/, '');
  const partes = h.split('/').filter(Boolean);
  return { nombre: partes[0] || 'hoy', param: partes[1] || null, param2: partes[2] || null };
}

let contenidoRef = null;
let navRef = null;

export async function navegar(hash) {
  location.hash = hash;
}

export async function refrescar() {
  await renderVista();
}

async function renderVista() {
  const { nombre, param, param2 } = rutaActual();
  const vista = VISTAS[nombre] || VISTAS.hoy;
  // Al salir de una pantalla de firma se recupera la interfaz completa.
  if (nombre !== 'consentimiento') document.body.classList.remove('modo-tablet');
  document.body.classList.toggle('imprimiendo', nombre === 'imprimir');

  if (navRef) {
    navRef.querySelectorAll('a').forEach((a) => {
      a.classList.toggle('activo', a.dataset.ruta === nombre ||
        (nombre === 'paciente' && a.dataset.ruta === 'pacientes') ||
        (nombre === 'consentimiento' && a.dataset.ruta === 'pacientes') ||
        (nombre === 'cita' && a.dataset.ruta === 'agenda'));
    });
  }

  limpiar(contenidoRef);
  contenidoRef.appendChild(el('div', { clase: 'vacio', texto: 'Cargando…' }));
  try {
    const nodo = await vista({ param, param2, usuario: sesion.usuario, refrescar, navegar });
    limpiar(contenidoRef);
    contenidoRef.appendChild(nodo);
    window.scrollTo(0, 0);
  } catch (err) {
    limpiar(contenidoRef);
    if (err instanceof ErrorApi && err.estado === 401) {
      sesion.token = null;
      sesion.usuario = null;
      await dibujar();
      return;
    }
    const mensaje = err instanceof ErrorApi ? err.message : 'Ocurrió un error al cargar la vista.';
    contenidoRef.appendChild(el('div', { clase: 'alerta-caja' }, [
      el('b', { texto: 'No se pudo cargar esta sección. ' }),
      el('span', { texto: mensaje }),
    ]));
    console.warn('[vista]', mensaje);
  }
}

export async function dibujar() {
  limpiar(app);
  app.classList.remove('cargando');
  if (!sesion.usuario) {
    contenidoRef = null;
    navRef = null;
    app.appendChild(pantallaLogin());
    return;
  }
  const { marco, contenido, nav } = armarMarco();
  contenidoRef = contenido;
  navRef = nav;
  app.appendChild(marco);
  if (!location.hash) location.hash = '#/hoy';
  await renderVista();
}

/* ---------------------------- Red de seguridad --------------------------- */

/**
 * Última barrera contra la pantalla en blanco. Si algo falla tan arriba que ni
 * siquiera se pudo armar la pantalla, aquí se muestra un mensaje en español con
 * una salida clara, en vez de dejar a la persona mirando un rectángulo vacío.
 */
function pantallaFallo(detalle) {
  limpiar(app);
  app.classList.remove('cargando');
  app.appendChild(el('div', { clase: 'login-fondo' }, [
    el('div', { clase: 'login-caja' }, [
      el('h1', { texto: '🦷 DentalGest' }),
      el('p', { clase: 'sub', texto: 'Algo se interrumpió y esta pantalla no se pudo mostrar.' }),
      el('div', { clase: 'alerta-caja aviso' }, [
        el('div', { texto: 'No se perdió nada de lo que ya estaba guardado. Vuelve al inicio y sigue trabajando; si vuelve a pasar, avísale a quien te da soporte.' }),
        detalle ? el('div', { clase: 'mini', style: 'margin-top:8px', texto: `Detalle técnico: ${detalle}` }) : null,
      ]),
      el('button', {
        clase: 'btn', type: 'button', texto: '← Volver al inicio', style: 'width:100%',
        onclick: () => { location.hash = '#/hoy'; location.reload(); },
      }),
    ]),
  ]));
}

/** ¿Quedó la pantalla vacía? Entonces la persona está viendo un vacío inexplicable. */
function pantallaVacia() {
  return !app.firstElementChild || (app.innerText || '').trim().length === 0;
}

window.addEventListener('error', (e) => {
  if (pantallaVacia()) pantallaFallo(e?.message || 'error inesperado');
});

window.addEventListener('hashchange', () => {
  if (sesion.usuario && contenidoRef) renderVista();
});

window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (err instanceof ErrorApi) {
    e.preventDefault();
    error(err.message);
    return;
  }
  if (pantallaVacia()) pantallaFallo(err?.message || 'error inesperado');
});

/* -------------------------------- Arranque ------------------------------ */

(async function iniciar() {
  try {
    if (sesion.token) {
      try {
        sesion.usuario = await api.yo();
      } catch {
        sesion.token = null;
        sesion.usuario = null;
      }
    }
    await dibujar();
  } catch (e) {
    pantallaFallo(e?.message || 'no se pudo abrir la aplicación');
  }
})();
