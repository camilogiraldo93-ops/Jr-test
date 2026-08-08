import { api, ErrorApi } from '../api.js';
import { el, limpiar, selector, campo, exito, error, vacio, fmtFechaCorta, nombreLista,
  NOMBRE_PRIORIDAD, NOMBRE_ESTADO_PENDIENTE } from '../ui.js';

export async function vistaRecordatorios({ refrescar }) {
  const selEstado = selector('estado', [
    { valor: 'pendiente', texto: 'Por hacer' },
    { valor: 'completado', texto: 'Ya hechas' },
    { valor: 'cancelado', texto: 'Ya no aplican' },
    { valor: '', texto: 'Todas' },
  ], 'pendiente');

  const zona = el('div', {});

  async function cargar() {
    const lista = await api.recordatorios({ estado: selEstado.value || undefined });
    limpiar(zona);
    if (!lista.length) { zona.appendChild(vacio('No hay nada anotado con ese filtro.')); return; }
    zona.appendChild(el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
      el('thead', {}, [el('tr', {}, ['Paciente', 'Qué hay que hacer', 'Para cuándo', 'Urgencia', 'Cómo va', ''].map(
        (t) => el('th', { texto: t })))]),
      el('tbody', {}, lista.map((r) => el('tr', {}, [
        el('td', {}, [el('a', { href: `#/paciente/${r.paciente_id}`, texto: nombreLista(r.paciente_nombre, r.paciente_apellidos) })]),
        el('td', {}, [
          el('b', { texto: r.titulo }),
          r.descripcion ? el('div', { clase: 'mini', texto: r.descripcion }) : null,
          r.cita_id ? el('div', {}, [el('a', { clase: 'mini', href: `#/cita/${r.cita_id}`, texto: 'Ver la cita' })]) : null,
        ]),
        el('td', { texto: r.fecha_objetivo ? fmtFechaCorta(r.fecha_objetivo) : '—' }),
        el('td', {}, [el('span', { clase: `eti ${r.prioridad}`, texto: NOMBRE_PRIORIDAD[r.prioridad] || r.prioridad })]),
        el('td', {}, [el('span', { clase: `eti ${r.estado}`, texto: NOMBRE_ESTADO_PENDIENTE[r.estado] || r.estado })]),
        el('td', {}, [
          r.estado === 'pendiente'
            ? el('button', {
                clase: 'btn sec chico', type: 'button', texto: 'Marcar como hecha',
                onclick: async () => {
                  try {
                    await api.actualizarRecordatorio(r.id, { estado: 'completado' });
                    exito('Listo, quedó marcada como hecha.');
                    await cargar();
                  } catch (e) { error(e instanceof ErrorApi ? e.message : 'No se pudo actualizar.'); }
                },
              })
            : null,
        ]),
      ]))),
    ])]));
  }

  selEstado.addEventListener('change', () => { cargar().catch((e) => error(e?.message || 'Error')); });

  const contenedor = el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: 'Cosas por hacer' }),
        el('div', { clase: 'desc', texto: 'Lo que quedó anotado para dar seguimiento, con el paciente y para cuándo.' }),
      ]),
    ]),
    el('div', { clase: 'agenda-controles' }, [campo('Mostrar', selEstado)]),
    el('div', { clase: 'tarjeta' }, [zona]),
  ]);

  await cargar();
  return contenedor;
}
