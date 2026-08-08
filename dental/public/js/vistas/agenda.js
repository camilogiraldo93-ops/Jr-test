import { api } from '../api.js';
import { el, limpiar, selector, entrada, campo, etiquetaEstado, fmtHora, nombreDia, hoyIso,
  sumarDias, vacio, fmtFechaCorta, plural, nombreCompleto, ETIQUETAS_ESTADO } from '../ui.js';
import { abrirFormularioCita } from './formCita.js';

const estado = {
  vista: 'dia',        // dia | semana
  agrupar: 'cubiculo', // consultorio | cubiculo | doctor
  fecha: hoyIso(),
  consultorio_id: '',
  entidad: '',         // filtro de entidad concreta en vista semanal
};

const HORA_INICIO = 7;
const HORA_FIN = 21;
const PASO = 30;

function franjas() {
  const lista = [];
  for (let h = HORA_INICIO; h < HORA_FIN; h++) {
    for (let m = 0; m < 60; m += PASO) {
      lista.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return lista;
}

function bloqueCita(c, navegar) {
  return el('div', {
    clase: `bloque-cita estado-${c.estado}`,
    style: `border-left-color:${c.doctor_color || '#0d7d8f'}`,
    title: `${fmtHora(c.inicio)}–${fmtHora(c.fin)} · ${nombreCompleto(c.paciente_nombre, c.paciente_apellidos)} · ${c.doctor_nombre} · ${c.consultorio_nombre}/${c.cubiculo_nombre} · ${ETIQUETAS_ESTADO[c.estado] || c.estado}`,
    onclick: () => navegar(`#/cita/${c.id}`),
  }, [
    el('b', { clase: 'pac', texto: nombreCompleto(c.paciente_nombre, c.paciente_apellidos) }),
    el('span', { clase: 'det', texto: `${fmtHora(c.inicio)}–${fmtHora(c.fin)} · ${c.doctor_nombre}` }),
    el('span', { clase: 'det', texto: `${c.cubiculo_nombre} · ${c.motivo || 'Sin motivo'}` }),
  ]);
}

/** Vista de día: columnas = entidades del agrupamiento. */
function rejillaDia(datos, navegar) {
  const columnas = datos.columnas;
  if (!columnas.length) return vacio('No hay elementos que mostrar. Crea consultorios, cubículos o doctores en Configuración.');

  const cabecera = el('tr', {}, [
    el('th', { texto: 'Hora' }),
    ...columnas.map((c) => el('th', {}, [
      el('span', { texto: c.nombre }),
      c.subtitulo ? el('small', { texto: c.subtitulo }) : null,
    ])),
  ]);

  const cuerpo = franjas().map((f) => {
    const celdas = columnas.map((col) => {
      const citas = datos.citas.filter((c) =>
        String(c[col.clave]) === String(col.id) && c.inicio.slice(11, 16) >= f &&
        c.inicio.slice(11, 16) < sumarFranja(f));
      return el('td', {}, citas.map((c) => bloqueCita(c, navegar)));
    });
    return el('tr', {}, [el('td', { clase: 'hora', texto: f }), ...celdas]);
  });

  return el('div', { clase: 'agenda-rejilla' }, [
    el('table', { clase: 'agenda-tabla' }, [
      el('thead', {}, [cabecera]),
      el('tbody', {}, cuerpo),
    ]),
  ]);
}

function sumarFranja(f) {
  const [h, m] = f.split(':').map(Number);
  const t = h * 60 + m + PASO;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Vista de semana: columnas = días. */
function rejillaSemana(datos, navegar) {
  const cabecera = el('tr', {}, [
    el('th', { texto: 'Hora' }),
    ...datos.dias.map((d) => el('th', {}, [
      el('span', { texto: nombreDia(d) }),
      el('small', { texto: fmtFechaCorta(d) }),
    ])),
  ]);

  const cuerpo = franjas().map((f) => {
    const celdas = datos.dias.map((d) => {
      const citas = datos.citas.filter((c) =>
        c.inicio.slice(0, 10) === d && c.inicio.slice(11, 16) >= f && c.inicio.slice(11, 16) < sumarFranja(f));
      return el('td', {}, citas.map((c) => bloqueCita(c, navegar)));
    });
    return el('tr', {}, [el('td', { clase: 'hora', texto: f }), ...celdas]);
  });

  return el('div', { clase: 'agenda-rejilla' }, [
    el('table', { clase: 'agenda-tabla' }, [
      el('thead', {}, [cabecera]),
      el('tbody', {}, cuerpo),
    ]),
  ]);
}

export async function vistaAgenda({ navegar, usuario }) {
  const consultorios = await api.consultorios();
  const contenedor = el('div', {});
  const zona = el('div', {});

  const selVista = selector('vista', [
    { valor: 'dia', texto: 'Día' }, { valor: 'semana', texto: 'Semana' },
  ], estado.vista);
  const selAgrupar = selector('agrupar', [
    { valor: 'cubiculo', texto: 'Por cubículo' },
    { valor: 'doctor', texto: 'Por doctor' },
    { valor: 'consultorio', texto: 'Por consultorio' },
  ], estado.agrupar);
  const selConsultorio = selector('consultorio_id', [
    { valor: '', texto: 'Todos los consultorios' },
    ...consultorios.map((c) => ({ valor: c.id, texto: c.nombre })),
  ], estado.consultorio_id);
  const inFecha = entrada('fecha', { type: 'date', value: estado.fecha });
  const selEntidad = selector('entidad', [{ valor: '', texto: 'Todos' }], estado.entidad);
  const campoEntidad = campo('Filtrar', selEntidad);

  const btnAnterior = el('button', { clase: 'btn sec', type: 'button', texto: '‹' });
  const btnHoy = el('button', { clase: 'btn sec', type: 'button', texto: 'Hoy' });
  const btnSiguiente = el('button', { clase: 'btn sec', type: 'button', texto: '›' });

  async function cargar() {
    estado.vista = selVista.value;
    estado.agrupar = selAgrupar.value;
    estado.consultorio_id = selConsultorio.value;
    estado.fecha = inFecha.value || hoyIso();
    estado.entidad = selEntidad.value;

    const params = {
      vista: estado.vista, agrupar: estado.agrupar, fecha: estado.fecha,
      consultorio_id: estado.consultorio_id || undefined,
    };
    if (estado.vista === 'semana' && estado.entidad) {
      const clave = estado.agrupar === 'doctor' ? 'doctor_id'
        : estado.agrupar === 'cubiculo' ? 'cubiculo_id' : 'consultorio_id';
      params[clave] = estado.entidad;
    }

    const datos = await api.agenda(params);

    // Opciones del filtro de entidad (solo aplica a la vista semanal).
    const previo = selEntidad.value;
    limpiar(selEntidad);
    selEntidad.appendChild(el('option', { value: '', texto: 'Todos' }));
    for (const c of datos.columnas) {
      const op = el('option', { value: String(c.id), texto: c.subtitulo ? `${c.nombre} (${c.subtitulo})` : c.nombre });
      if (String(previo) === String(c.id)) op.selected = true;
      selEntidad.appendChild(op);
    }
    campoEntidad.style.display = estado.vista === 'semana' ? '' : 'none';

    limpiar(zona);
    const rango = estado.vista === 'semana'
      ? `Semana del ${fmtFechaCorta(datos.desde)} al ${fmtFechaCorta(datos.hasta)}`
      : nombreDia(datos.desde);
    zona.appendChild(el('div', { clase: 'cabecera', style: 'margin-bottom:10px' }, [
      el('div', {}, [
        el('h3', { texto: rango }),
        el('div', { clase: 'desc', texto: `${plural(datos.citas.length, 'cita', 'citas')} · agrupado ${
          estado.agrupar === 'cubiculo' ? 'por cubículo' : estado.agrupar === 'doctor' ? 'por doctor' : 'por consultorio'}` }),
      ]),
    ]));
    zona.appendChild(estado.vista === 'semana' ? rejillaSemana(datos, navegar) : rejillaDia(datos, navegar));

    if (!datos.citas.length) {
      zona.appendChild(vacio('No hay citas en este período con los filtros seleccionados.'));
    }
  }

  [selVista, selAgrupar, selConsultorio, inFecha, selEntidad].forEach((c) =>
    c.addEventListener('change', () => { cargar().catch(mostrarFallo); }));

  const mover = (dias) => {
    inFecha.value = sumarDias(inFecha.value || hoyIso(), dias);
    cargar().catch(mostrarFallo);
  };
  btnAnterior.onclick = () => mover(selVista.value === 'semana' ? -7 : -1);
  btnSiguiente.onclick = () => mover(selVista.value === 'semana' ? 7 : 1);
  btnHoy.onclick = () => { inFecha.value = hoyIso(); cargar().catch(mostrarFallo); };

  function mostrarFallo(e) {
    limpiar(zona);
    zona.appendChild(el('div', { clase: 'alerta-caja', texto: e?.message || 'No se pudo cargar la agenda.' }));
  }

  const puedeAgendar = ['admin', 'recepcion', 'doctor'].includes(usuario.rol);

  contenedor.appendChild(el('div', { clase: 'cabecera' }, [
    el('div', {}, [
      el('h2', { texto: 'Agenda' }),
      el('div', { clase: 'desc', texto: 'La semana o el día completos, por sede, por sillón o por doctor. Si dos citas chocan, la app lo avisa.' }),
    ]),
    puedeAgendar
      ? el('button', {
          clase: 'btn', type: 'button', texto: '➕ Nueva cita',
          onclick: () => abrirFormularioCita({
            fecha: inFecha.value || hoyIso(),
            consultorio_id: selConsultorio.value ? Number(selConsultorio.value) : null,
            alGuardar: () => cargar(),
          }),
        })
      : null,
  ]));

  contenedor.appendChild(el('div', { clase: 'agenda-controles' }, [
    campo('Vista', selVista),
    campo('Agrupar', selAgrupar),
    campo('Consultorio', selConsultorio),
    campo('Fecha', inFecha),
    campoEntidad,
    el('div', { clase: 'acciones' }, [btnAnterior, btnHoy, btnSiguiente]),
  ]));

  contenedor.appendChild(zona);
  await cargar();
  return contenedor;
}
