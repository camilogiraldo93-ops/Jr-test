import { el, modal } from './ui.js';

/**
 * «¿Cómo hago…?»: las tareas de todos los días explicadas en pasos numerados,
 * con las palabras que aparecen en pantalla. Está siempre a mano para que nadie
 * tenga que acordarse de una capacitación que nunca hubo.
 */
const TAREAS = [
  {
    titulo: 'Agendar una cita',
    pasos: [
      'En «El día de hoy», busca la hora que quieres y pulsa «＋ Agendar a las …».',
      'Elige al paciente en la primera lista (si es nuevo, créalo antes desde Pacientes).',
      'Pulsa «Agendar cita». Si esa hora está ocupada, la app te lo dice antes de guardar.',
    ],
  },
  {
    titulo: 'Anotar un paciente nuevo que llama',
    pasos: [
      'Entra a «Pacientes» y pulsa «➕ Nuevo paciente».',
      'Escribe el nombre y el teléfono. Con eso basta para agendarle.',
      'Pulsa «Crear paciente». Lo demás se llena cuando la persona venga.',
    ],
  },
  {
    titulo: 'Atender a alguien y cobrarle',
    pasos: [
      'Abre la cita desde la página del día.',
      'Pulsa «El paciente llegó — empezar»: se abre solo el cuadro para anotar.',
      'Escribe qué se hizo y cuánto se cobra, y pulsa «Guardar».',
      'Baja hasta «Cobros de esta cita» y pulsa «Cobrar» en la línea correspondiente.',
    ],
  },
  {
    titulo: 'Hacer firmar un consentimiento',
    pasos: [
      'Si el tratamiento lo necesita, el documento aparece solo al anotarlo.',
      'También lo encuentras en «Resumen», en el recuadro «Consentimientos por firmar».',
      'Pásale la tablet al paciente, que firme con el dedo y pulse «Confirmar».',
      'Firma tú también y pulsa «✍️ Firmar y archivar».',
    ],
  },
  {
    titulo: 'Apuntar un gasto',
    pasos: [
      'Entra a «Dinero» y pulsa «🧾 Apuntar gasto».',
      'Escribe en qué se gastó y cuánto. El día ya viene puesto en hoy.',
      'Pulsa «Apuntar gasto».',
    ],
  },
  {
    titulo: 'Ver cuánto se cobró hoy',
    pasos: [
      'En «El día de hoy», debajo del título dice «cobrado en el día».',
      'Para el detalle, entra a «Dinero» y elige «Día» en el primer selector.',
    ],
  },
  {
    titulo: 'Buscar el teléfono de un paciente',
    pasos: [
      'Escribe su nombre en la caja de búsqueda de arriba a la izquierda.',
      'El teléfono aparece junto al nombre, sin tener que entrar a la ficha.',
    ],
  },
  {
    titulo: 'Imprimir la agenda del día o llevar algo a Excel',
    pasos: [
      'En «El día de hoy» pulsa «🖨️ Imprimir este día» y luego «Imprimir / Guardar PDF».',
      'En Pacientes y en Dinero hay un botón «⬇️ Exportar a Excel» sobre cada tabla.',
    ],
  },
];

export function botonAyuda() {
  return el('button', {
    clase: 'boton-ayuda', type: 'button', texto: '❓ ¿Cómo hago…?',
    title: 'Pasos para las tareas de todos los días',
    onclick: abrirAyuda,
  });
}

function abrirAyuda() {
  const m = modal({
    titulo: '¿Cómo hago…?',
    ancho: true,
    cuerpo: el('div', { clase: 'lista-ayuda' }, TAREAS.map((t) => el('details', {}, [
      el('summary', { texto: t.titulo }),
      el('ol', {}, t.pasos.map((p) => el('li', { texto: p }))),
    ]))),
    pie: [el('button', { clase: 'btn', type: 'button', texto: 'Entendido', onclick: () => m.cerrar() })],
  });
}
