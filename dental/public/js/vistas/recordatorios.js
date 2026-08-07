import { api, ErrorApi } from '../api.js';
import { el, limpiar, selector, campo, exito, error, vacio, fmtFechaCorta } from '../ui.js';

export async function vistaRecordatorios({ refrescar }) {
  const selEstado = selector('estado', [
    { valor: 'pendiente', texto: 'Pendientes' },
    { valor: 'completado', texto: 'Completados' },
    { valor: 'cancelado', texto: 'Cancelados' },
    { valor: '', texto: 'Todos' },
  ], 'pendiente');

  const zona = el('div', {});

  async function cargar() {
    const lista = await api.recordatorios({ estado: selEstado.value || undefined });
    limpiar(zona);
    if (!lista.length) { zona.appendChild(vacio('No hay recordatorios con ese filtro.')); return; }
    zona.appendChild(el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
      el('thead', {}, [el('tr', {}, ['Paciente', 'Recordatorio', 'Fecha objetivo', 'Prioridad', 'Estado', ''].map(
        (t) => el('th', { texto: t })))]),
      el('tbody', {}, lista.map((r) => el('tr', {}, [
        el('td', {}, [el('a', { href: `#/paciente/${r.paciente_id}`, texto: `${r.paciente_apellidos}, ${r.paciente_nombre}` })]),
        el('td', {}, [
          el('b', { texto: r.titulo }),
          r.descripcion ? el('div', { clase: 'mini', texto: r.descripcion }) : null,
          r.cita_id ? el('div', {}, [el('a', { clase: 'mini', href: `#/cita/${r.cita_id}`, texto: `Cita #${r.cita_id}` })]) : null,
        ]),
        el('td', { texto: r.fecha_objetivo ? fmtFechaCorta(r.fecha_objetivo) : '—' }),
        el('td', {}, [el('span', { clase: `eti ${r.prioridad}`, texto: r.prioridad })]),
        el('td', {}, [el('span', { clase: `eti ${r.estado}`, texto: r.estado })]),
        el('td', {}, [
          r.estado === 'pendiente'
            ? el('button', {
                clase: 'btn sec chico', type: 'button', texto: 'Completar',
                onclick: async () => {
                  try {
                    await api.actualizarRecordatorio(r.id, { estado: 'completado' });
                    exito('Recordatorio completado.');
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
        el('h2', { texto: 'Recordatorios' }),
        el('div', { clase: 'desc', texto: 'Tratamientos pendientes y seguimientos creados desde las citas.' }),
      ]),
    ]),
    el('div', { clase: 'agenda-controles' }, [campo('Estado', selEstado)]),
    el('div', { clase: 'tarjeta' }, [zona]),
  ]);

  await cargar();
  return contenedor;
}
