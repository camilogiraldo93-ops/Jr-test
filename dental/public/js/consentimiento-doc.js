import { el, fmtFechaCorta, fmtMarca } from './ui.js';

/**
 * Plantilla única del consentimiento informado.
 * Todo se autocompleta desde la base de datos salvo tres campos que llena la clínica:
 * tratamiento, doctor y observaciones.
 */
export function documentoConsentimiento(c, { compacto = false } = {}) {
  const menor = !!c.es_menor;
  const firmante = menor
    ? (c.representante_nombre || '(representante legal)')
    : c.paciente_nombre;
  const cedulaFirmante = menor
    ? (c.representante_cedula || '(cédula del representante)')
    : (c.paciente_cedula || 'sin cédula registrada');

  const punto = (n, ...contenido) => el('li', { clase: 'doc-punto' }, contenido);
  const fuerte = (t) => el('strong', { texto: t });

  return el('article', { clase: `documento${compacto ? ' compacto' : ''}` }, [
    el('h1', { clase: 'doc-titulo', texto: 'CONSENTIMIENTO INFORMADO PARA TRATAMIENTO ODONTOLÓGICO' }),

    el('div', { clase: 'doc-encabezado' }, [
      el('div', { clase: 'doc-clinica', texto: c.consultorio_nombre || 'Consultorio' }),
      el('div', { clase: 'doc-clinica-datos', texto:
        [c.consultorio_direccion, c.consultorio_telefono].filter(Boolean).join(' · ') || '—' }),
      el('div', { clase: 'doc-clinica-datos', texto:
        `Fecha: ${fmtFechaCorta(c.fecha)} · Hora: ${c.hora}` }),
    ]),

    el('p', { clase: 'doc-parrafo' }, [
      document.createTextNode('Yo, '),
      fuerte(menor ? firmante : c.paciente_nombre),
      document.createTextNode(', con cédula de identidad N.º '),
      fuerte(cedulaFirmante),
      document.createTextNode(menor
        ? `, en calidad de ${c.representante_parentesco || 'representante legal'} de ${c.paciente_nombre}, ` +
          'en pleno uso de mis facultades, declaro que:'
        : ', en pleno uso de mis facultades, declaro que:'),
    ]),

    el('ol', { clase: 'doc-lista' }, [
      punto(1,
        document.createTextNode('El/La Dr(a). '), fuerte(c.doctor_nombre),
        document.createTextNode(menor
          ? ' me ha explicado en lenguaje claro y comprensible que mi representado/a requiere el siguiente tratamiento: '
          : ' me ha explicado en lenguaje claro y comprensible que requiero el siguiente tratamiento: '),
        fuerte(c.tratamiento), document.createTextNode('.')),
      punto(2, document.createTextNode(
        'Se me ha informado en qué consiste el procedimiento, su objetivo, su duración aproximada y los ' +
        'cuidados posteriores que debo seguir.')),
      punto(3, document.createTextNode(
        'Se me han explicado los riesgos y molestias frecuentes asociados a este tipo de procedimiento ' +
        '(tales como dolor, inflamación, sangrado, sensibilidad, infección o reacción a la anestesia, según ' +
        'aplique), así como las alternativas de tratamiento disponibles, incluida la opción de no realizarlo, ' +
        'y las consecuencias previsibles de no hacerlo.')),
      punto(4, document.createTextNode(
        'He tenido la oportunidad de hacer preguntas y todas han sido respondidas a mi satisfacción.')),
      punto(5, document.createTextNode(
        'He informado verazmente sobre mi estado de salud, alergias y medicación actual.')),
      punto(6, document.createTextNode(
        'Entiendo que la odontología no es una ciencia exacta y que no se me han garantizado resultados absolutos.')),
      punto(7, document.createTextNode(
        'Autorizo el registro fotográfico y radiográfico con fines de diagnóstico, tratamiento y respaldo del ' +
        'expediente clínico.')),
    ]),

    el('p', { clase: 'doc-parrafo' }, [
      fuerte('Observaciones: '),
      document.createTextNode(c.observaciones || 'Sin observaciones adicionales.'),
    ]),

    el('p', { clase: 'doc-parrafo' }, [
      document.createTextNode('Por lo tanto, '),
      fuerte('AUTORIZO'),
      document.createTextNode(` voluntariamente al/a la Dr(a). ${c.doctor_nombre} y al equipo de ` +
        `${c.consultorio_nombre || 'la clínica'} a realizar el tratamiento descrito. Puedo revocar este ` +
        'consentimiento en cualquier momento antes del procedimiento.'),
    ]),
  ]);
}

/** Bloque de firmas: muestra las imágenes si ya está firmado, o el espacio en blanco si no. */
export function bloqueFirmas(c) {
  const menor = !!c.es_menor;
  const firmado = c.estado === 'firmado';

  const casilla = (titulo, imagen, nombre, detalle, fecha) => el('div', { clase: 'firma-bloque' }, [
    imagen
      ? el('img', { clase: 'firma-img', src: imagen, alt: `Firma de ${nombre}` })
      : el('div', { clase: 'firma-linea' }),
    el('div', { clase: 'firma-pie' }, [
      el('div', { clase: 'firma-rol', texto: titulo }),
      el('div', { clase: 'firma-nombre', texto: nombre }),
      detalle ? el('div', { clase: 'firma-detalle', texto: detalle }) : null,
      fecha ? el('div', { clase: 'firma-detalle', texto: `Firmado: ${fmtMarca(fecha)}` }) : null,
    ]),
  ]);

  const nombrePaciente = menor
    ? (c.representante_nombre || 'Representante legal')
    : c.paciente_nombre;
  const detallePaciente = menor
    ? `CI: ${c.representante_cedula || '—'} · ${c.representante_parentesco || 'representante'} de ${c.paciente_nombre}`
    : `CI: ${c.paciente_cedula || '—'}`;

  return el('div', { clase: 'firmas' }, [
    casilla(
      menor ? 'Firma del representante legal' : 'Firma del paciente',
      firmado ? c.firma_paciente : null,
      nombrePaciente, detallePaciente, firmado ? c.firma_paciente_en : null),
    casilla(
      'Firma del doctor',
      firmado ? c.firma_doctor : null,
      c.doctor_nombre, c.doctor_especialidad || '', firmado ? c.firma_doctor_en : null),
  ]);
}

/** Pie con lugar y fecha, como en el documento impreso. */
export function pieDocumento(c) {
  return el('p', { clase: 'doc-lugar', texto:
    `${c.consultorio_ciudad || 'Ciudad'}, ${fmtFechaCorta(c.fecha)}` });
}

export const ETIQUETA_ESTADO_CONSENT = {
  pendiente: 'Pendiente de firma',
  firmado: 'Firmado',
  anulado: 'Anulado',
};
