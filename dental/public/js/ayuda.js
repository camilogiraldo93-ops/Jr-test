import { el, modal } from './ui.js';
import { sesion } from './api.js';

/**
 * «¿Cómo hago…?»: las tareas de todos los días explicadas en pasos numerados,
 * con las palabras que aparecen en pantalla.
 *
 * Cada tarea sabe quién puede hacerla. A nadie se le explican pasos que no va a
 * poder dar: si la tarea es de otra persona, se dice de quién es y qué sí puede
 * hacer uno mismo. Una ayuda que manda a pulsar un botón invisible es peor que
 * no tener ayuda.
 */
const TAREAS = [
  {
    titulo: 'Agendar una cita',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'En «El día de hoy», busca la hora que quieres y pulsa «＋ Agendar a las …».',
      'Elige a la persona en la primera lista (si es nueva, créala antes desde Pacientes).',
      'Pulsa «Agendar cita». Si esa hora está ocupada, la app te lo dice antes de guardar.',
    ],
  },
  {
    titulo: 'Anotar un paciente nuevo que llama',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'Entra a «Pacientes» y pulsa «➕ Nuevo paciente».',
      'Escribe el nombre y el teléfono. Con eso basta para agendarle.',
      'Pulsa «Crear paciente». Lo demás se llena cuando la persona venga.',
    ],
  },
  {
    titulo: 'Atender a alguien y anotar el tratamiento',
    roles: ['admin', 'doctor'],
    deOtros: 'Esto lo hace el doctor o la administradora desde la pantalla de la cita. ' +
      'Tú puedes abrir la cita y ver lo que se anotó, y cobrarle al paciente cuando termine.',
    pasos: [
      'Abre la cita desde la página del día.',
      'Pulsa «El paciente llegó — empezar»: se abre solo el cuadro para anotar.',
      'Escribe qué se hizo y cuánto se cobra, y pulsa «Guardar».',
    ],
  },
  {
    titulo: 'Cobrarle a un paciente',
    roles: ['admin', 'recepcion'],
    deOtros: 'Los cobros los registran la recepción y la administradora.',
    pasos: [
      'Abre la cita y baja hasta «💰 Cobros de esta cita».',
      'Pulsa «Cobrar» en la línea que corresponda (o «➕ Registrar pago» para un abono suelto).',
      'Escribe cuánto pagó y cómo, y pulsa «Registrar pago».',
    ],
  },
  {
    titulo: 'Hacer firmar un consentimiento',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'Si el tratamiento lo necesita, el documento aparece solo al anotarlo.',
      'También lo encuentras en «Resumen», en el recuadro «Consentimientos por firmar».',
      'Pásale la tablet al paciente, que firme con el dedo y pulse «Confirmar firma».',
      'Firma el doctor también y se pulsa «✍️ Firmar y archivar».',
    ],
  },
  {
    titulo: 'Apuntar un gasto',
    roles: ['admin', 'recepcion'],
    ajuste: 'recepcion_dinero',
    deOtros: 'En este consultorio los gastos los lleva la administradora, en la sección «Dinero». ' +
      'Por eso no la ves en tu menú. Si aquí se trabaja de otra forma, ella puede abrírtela ' +
      'desde Configuración.',
    pasos: [
      'Entra a «Dinero» y pulsa «🧾 Apuntar gasto».',
      'Escribe en qué se gastó y cuánto. El día ya viene puesto en hoy.',
      'Pulsa «Apuntar gasto».',
    ],
  },
  {
    titulo: 'Ver cuánto se cobró hoy',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'En «El día de hoy», debajo del título dice «cobrado en el día».',
      'El detalle por paciente y por forma de pago está en «Dinero», si tienes esa sección.',
    ],
  },
  {
    titulo: 'Buscar el teléfono de un paciente',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'Escribe su nombre en la caja de búsqueda de arriba a la izquierda.',
      'El teléfono aparece junto al nombre, sin tener que entrar a la ficha.',
    ],
  },
  {
    titulo: 'Imprimir la agenda del día',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'En «El día de hoy» pulsa «🖨️ Imprimir este día».',
      'Pulsa «🖨️ Imprimir / Guardar PDF» y elige tu impresora, o «Guardar como PDF».',
    ],
  },
  {
    titulo: 'Llevar una lista a Excel',
    roles: ['admin', 'doctor', 'recepcion'],
    pasos: [
      'En «Pacientes» pulsa «⬇️ Exportar a Excel»: baja la lista que estés viendo.',
      'Los cobros y los gastos se exportan igual desde «Dinero», si tienes esa sección.',
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

/**
 * Quién puede hacer qué se decide igual que en el menú: por puesto y, cuando el
 * consultorio lo ha decidido, por el ajuste. La ayuda se lee en el momento de
 * abrirla, no al dibujar el marco, para que no se quede con una foto vieja.
 * Decirle «esa sección no aparece en tu menú» a alguien que sí la tiene es peor
 * que no dar ayuda.
 */
function puedeHacer(t, rol) {
  if (!t.roles.includes(rol)) return false;
  if (!t.ajuste || rol === 'admin') return true;
  return !!sesion.ajustes?.[t.ajuste];
}

function abrirAyuda() {
  const rol = sesion.usuario?.rol;
  const m = modal({
    titulo: '¿Cómo hago…?',
    ancho: true,
    cuerpo: el('div', { clase: 'lista-ayuda' }, TAREAS.map((t) => {
      const puede = puedeHacer(t, rol);
      return el('details', { clase: puede ? '' : 'de-otros' }, [
        el('summary', { texto: puede ? t.titulo : `${t.titulo} — lo hace otra persona` }),
        puede
          ? el('ol', {}, t.pasos.map((p) => el('li', { texto: p })))
          : el('p', { clase: 'mini', texto: t.deOtros || 'Esta tarea corresponde a otro puesto.' }),
      ]);
    })),
    pie: [el('button', { clase: 'btn', type: 'button', texto: 'Entendido', onclick: () => m.cerrar() })],
  });
}
