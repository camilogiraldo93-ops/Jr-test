import { api } from '../api.js';
import { el, fmtDinero, fmtHora, fmtFechaCorta, etiquetaEstado, vacio, hoyIso,
  ETIQUETAS_ESTADO, NOMBRE_ROL, NOMBRE_PRIORIDAD, plural, nombreCompleto } from '../ui.js';

export async function vistaPanel({ usuario }) {
  const puedeContabilidad = ['admin', 'recepcion'].includes(usuario.rol);
  const hoy = hoyIso();

  const [resumen, citasHoy, recordatorios, consentimientos] = await Promise.all([
    api.resumen(),
    api.citas({ desde: hoy, hasta: hoy }),
    api.recordatorios({ estado: 'pendiente' }),
    api.consentimientos({ estado: 'pendiente' }),
  ]);

  const kpi = (etq, val, pie, clase = '') => el('div', { clase: 'kpi' }, [
    el('div', { clase: 'etq', texto: etq }),
    el('div', { clase: `val ${clase}`, texto: val }),
    pie ? el('div', { clase: 'pie', texto: pie }) : null,
  ]);

  const balanceMes = resumen.ingresos_mes - resumen.gastos_mes;

  const kpis = el('div', { clase: 'rejilla c4', style: 'margin-bottom:18px' }, [
    kpi('Citas de hoy', String(resumen.citas_hoy), `${plural(resumen.citas_mes, 'cita', 'citas')} este mes`),
    kpi('Pacientes', String(resumen.pacientes),
          `${plural(resumen.doctores, 'doctor', 'doctores')} · ${plural(resumen.consultorios, 'consultorio', 'consultorios')}`),
    kpi('Cosas por hacer', String(resumen.recordatorios_pendientes), 'anotadas para dar seguimiento'),
    puedeContabilidad
      ? kpi('Lo que quedó este mes', fmtDinero(balanceMes),
          `Ingresos ${fmtDinero(resumen.ingresos_mes)} · Gastos ${fmtDinero(resumen.gastos_mes)}`,
          balanceMes >= 0 ? 'ok' : 'mal')
      : kpi('Consentimientos', String(resumen.consentimientos_pendientes), 'esperando firma'),
  ]);

  const filasCitas = citasHoy.map((c) => el('tr', {}, [
    el('td', { texto: `${fmtHora(c.inicio)} – ${fmtHora(c.fin)}` }),
    el('td', {}, [el('a', { href: `#/paciente/${c.paciente_id}`, texto: nombreCompleto(c.paciente_nombre, c.paciente_apellidos) })]),
    el('td', { texto: c.doctor_nombre }),
    el('td', { texto: `${c.consultorio_nombre} · ${c.cubiculo_nombre}` }),
    el('td', {}, [etiquetaEstado(c.estado)]),
    el('td', {}, [el('a', { clase: 'btn sec chico', href: `#/cita/${c.id}`, texto: 'Abrir' })]),
  ]));

  const tablaCitas = citasHoy.length
    ? el('div', { clase: 'tabla-envoltura' }, [
        el('table', { clase: 'tabla' }, [
          el('thead', {}, [el('tr', {}, ['Horario', 'Paciente', 'Doctor', 'Ubicación', 'Estado', ''].map(
            (t) => el('th', { texto: t })))]),
          el('tbody', {}, filasCitas),
        ]),
      ])
    : vacio('No hay citas programadas para hoy.');

  const listaRecordatorios = recordatorios.length
    ? el('ul', { clase: 'lista-simple' }, recordatorios.slice(0, 8).map((r) => el('li', {}, [
        el('div', {}, [
          el('div', { clase: 'tit' }, [
            el('a', { href: `#/paciente/${r.paciente_id}`, texto: r.titulo }),
          ]),
          el('div', { clase: 'det', texto: `${nombreCompleto(r.paciente_nombre, r.paciente_apellidos)} · ${r.fecha_objetivo ? `para el ${fmtFechaCorta(r.fecha_objetivo)}` : 'sin fecha'}` }),
        ]),
        el('span', { clase: `eti ${r.prioridad}`, texto: NOMBRE_PRIORIDAD[r.prioridad] || r.prioridad }),
      ])))
    : vacio('No hay recordatorios pendientes.');

  const listaConsent = consentimientos.length
    ? el('ul', { clase: 'lista-simple' }, consentimientos.slice(0, 8).map((c) => el('li', {}, [
        el('div', {}, [
          el('div', { clase: 'tit' }, [
            el('a', { href: `#/consentimiento/${c.id}`, texto: c.tratamiento }),
          ]),
          el('div', { clase: 'det', texto: `${c.paciente_nombre} · ${c.doctor_nombre}` }),
          el('div', { clase: 'mini', texto: c.cita_id ? 'Ligado a una cita' : 'Sin cita ligada' }),
        ]),
        el('a', { clase: 'btn chico', href: `#/consentimiento/${c.id}`, texto: '✍️ Firmar' }),
      ])))
    : vacio('No hay consentimientos pendientes de firma.');

  const porEstado = el('div', { clase: 'tarjeta' }, [
    el('h3', { texto: '📊 Cómo van las citas del mes' }),
    resumen.citas_por_estado.length
      ? el('div', { clase: 'acciones' }, resumen.citas_por_estado.map((e) =>
          el('span', { clase: `eti ${e.estado}`, texto: `${ETIQUETAS_ESTADO[e.estado] || e.estado}: ${e.n}` })))
      : vacio('Sin citas registradas este mes.'),
  ]);

  return el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: 'Resumen del consultorio' }),
        el('div', { clase: 'desc', texto: `${fmtFechaCorta(hoy)} · ${usuario.nombre} · ${NOMBRE_ROL[usuario.rol] || usuario.rol}` }),
      ]),
      el('a', { clase: 'btn', href: '#/agenda', texto: '📅 Ir a la agenda' }),
    ]),
    kpis,
    el('div', { clase: 'tarjeta' }, [el('h3', { texto: '🗓️ Citas de hoy' }), tablaCitas]),
    el('div', { clase: 'rejilla c2' }, [
      el('div', { clase: 'tarjeta' }, [el('h3', { texto: '🔔 Cosas por hacer' }), listaRecordatorios]),
      el('div', { clase: 'tarjeta' }, [el('h3', { texto: '📝 Consentimientos por firmar' }), listaConsent]),
    ]),
    porEstado,
  ]);
}
