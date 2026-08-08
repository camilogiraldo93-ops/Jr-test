import { api } from '../api.js';
import { el, limpiar, fmtDinero, fmtHora, etiquetaEstado, hoyIso, sumarDias, nombreDia,
  nombreCompleto } from '../ui.js';
import { abrirFormularioCita } from './formCita.js';
import { habituales } from '../preferencias.js';

/**
 * La página del día: una línea por media hora, de arriba abajo, como la agenda
 * de papel que ya usan. Las horas libres se pulsan para agendar ahí mismo.
 */
const PRIMERA_HORA = 7;
const ULTIMA_HORA = 20;
const PASO = 30;

function franjas() {
  const lista = [];
  for (let h = PRIMERA_HORA; h < ULTIMA_HORA; h++) {
    for (let m = 0; m < 60; m += PASO) {
      lista.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return lista;
}

function tituloDia(fecha) {
  const dia = nombreDia(fecha);
  return dia.charAt(0).toUpperCase() + dia.slice(1);
}

export async function vistaHoy({ usuario, navegar }) {
  const estado = { fecha: hoyIso() };
  const puedeAgendar = ['admin', 'recepcion', 'doctor'].includes(usuario.rol);
  const puedeVerDinero = ['admin', 'recepcion'].includes(usuario.rol);

  const zona = el('div', {});
  const tituloFecha = el('h2', {});
  const resumenDia = el('div', { clase: 'desc' });

  function nuevaCitaEn(hora) {
    const h = habituales();
    abrirFormularioCita({
      fecha: estado.fecha,
      hora,
      consultorio_id: h.consultorio_id ?? null,
      cubiculo_id: h.cubiculo_id ?? null,
      doctor_id: h.doctor_id ?? null,
      titulo: `Nueva cita — ${tituloDia(estado.fecha)} a las ${hora}`,
      alGuardar: (c) => navegar(`#/cita/${c.id}`),
    });
  }

  function lineaCita(c) {
    return el('button', {
      clase: `linea-cita estado-${c.estado}`, type: 'button',
      style: `border-left-color:${c.doctor_color || '#0d7d8f'}`,
      onclick: () => navegar(`#/cita/${c.id}`),
    }, [
      el('span', { clase: 'lc-pac', texto: nombreCompleto(c.paciente_nombre, c.paciente_apellidos) }),
      el('span', { clase: 'lc-det', texto: c.catalogo_nombre || c.motivo || 'Sin motivo anotado' }),
      el('span', { clase: 'lc-det', texto: `${c.doctor_nombre} · ${c.cubiculo_nombre}` }),
      el('span', { clase: 'lc-tel', texto: c.paciente_telefono || '' }),
      etiquetaEstado(c.estado),
    ]);
  }

  function lineaLibre(hora) {
    if (!puedeAgendar) return el('span', { clase: 'hora-libre-txt', texto: 'Libre' });
    return el('button', {
      clase: 'hora-libre', type: 'button',
      texto: `＋ Agendar a las ${hora}`,
      onclick: () => nuevaCitaEn(hora),
    });
  }

  async function cargar() {
    const fecha = estado.fecha;
    const peticiones = [api.citas({ desde: fecha, hasta: fecha })];
    peticiones.push(puedeVerDinero ? api.pagos({ desde: fecha, hasta: fecha }) : Promise.resolve([]));
    const [citas, pagos] = await Promise.all(peticiones);

    tituloFecha.textContent = `${tituloDia(fecha)}${fecha === hoyIso() ? ' (hoy)' : ''}`;
    const atendidas = citas.filter((c) => c.estado === 'completada').length;
    const cobrado = pagos.reduce((s, p) => s + p.monto, 0);
    resumenDia.textContent = puedeVerDinero
      ? `${citas.length} cita(s) · ${atendidas} ya atendida(s) · cobrado en el día: ${fmtDinero(cobrado)}`
      : `${citas.length} cita(s) · ${atendidas} ya atendida(s)`;

    limpiar(zona);
    const filas = franjas().map((f) => {
      const siguiente = franjaSiguiente(f);
      const enFranja = citas.filter((c) => {
        const hora = c.inicio.slice(11, 16);
        return hora >= f && hora < siguiente;
      });
      return el('div', { clase: `renglon-dia${enFranja.length ? '' : ' vacia'}` }, [
        el('div', { clase: 'renglon-hora', texto: f }),
        el('div', { clase: 'renglon-cont' },
          enFranja.length ? enFranja.map(lineaCita) : [lineaLibre(f)]),
      ]);
    });
    zona.appendChild(el('div', { clase: 'hoja-dia' }, filas));

    if (!citas.length) {
      zona.appendChild(el('p', { clase: 'mini', style: 'margin-top:12px', texto:
        'No hay ninguna cita este día. Pulsa la hora en la que quieras atender a alguien.' }));
    }
  }

  function mover(dias) {
    estado.fecha = sumarDias(estado.fecha, dias);
    cargar().catch(mostrarFallo);
  }

  function mostrarFallo(e) {
    limpiar(zona);
    zona.appendChild(el('div', { clase: 'alerta-caja', texto:
      e?.message || 'No se pudo cargar el día. Vuelve a intentarlo en un momento.' }));
  }

  const contenedor = el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [tituloFecha, resumenDia]),
      el('div', { clase: 'acciones' }, [
        el('button', { clase: 'btn sec', type: 'button', texto: '‹ Día anterior', onclick: () => mover(-1) }),
        el('button', {
          clase: 'btn sec', type: 'button', texto: 'Hoy',
          onclick: () => { estado.fecha = hoyIso(); cargar().catch(mostrarFallo); },
        }),
        el('button', { clase: 'btn sec', type: 'button', texto: 'Día siguiente ›', onclick: () => mover(1) }),
        el('button', {
          clase: 'btn sec', type: 'button', texto: '🖨️ Imprimir este día',
          onclick: () => navegar(`#/imprimir/dia/${estado.fecha}`),
        }),
        puedeAgendar
          ? el('button', { clase: 'btn', type: 'button', texto: '➕ Nueva cita', onclick: () => nuevaCitaEn('09:00') })
          : null,
      ]),
    ]),
    zona,
  ]);

  await cargar();
  return contenedor;
}

function franjaSiguiente(f) {
  const [h, m] = f.split(':').map(Number);
  const t = h * 60 + m + PASO;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
