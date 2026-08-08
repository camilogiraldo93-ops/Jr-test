import { api, urlFoto } from '../api.js';
import { el, vacio, fmtDinero, fmtFechaCorta, fmtFechaHora, fmtHora, fmtMarca, nombreDia,
  ETIQUETAS_ESTADO, plural } from '../ui.js';
import { documentoConsentimiento, bloqueFirmas, pieDocumento, ETIQUETA_ESTADO_CONSENT } from '../consentimiento-doc.js';

/** Barra superior que no se imprime, con el botón que abre el diálogo de impresión. */
function barra(titulo, volverA) {
  return el('div', { clase: 'cabecera sin-imprimir' }, [
    el('div', {}, [
      el('h2', { texto: titulo }),
      el('div', { clase: 'desc', texto: 'Usa «Guardar como PDF» en el diálogo de impresión para descargarlo.' }),
    ]),
    el('div', { clase: 'acciones' }, [
      volverA ? el('a', { clase: 'btn sec', href: volverA, texto: '← Volver' }) : null,
      el('button', { clase: 'btn', type: 'button', texto: '🖨️ Imprimir / Guardar PDF', onclick: () => window.print() }),
    ]),
  ]);
}

function tabla(encabezados, filas) {
  return el('div', { clase: 'tabla-envoltura' }, [
    el('table', { clase: 'tabla' }, [
      el('thead', {}, [el('tr', {}, encabezados.map((h) => el('th', { texto: h })))]),
      el('tbody', {}, filas),
    ]),
  ]);
}

function seccion(titulo, contenido) {
  return el('section', { clase: 'bloque-impresion' }, [
    el('h3', { clase: 'titulo-impresion', texto: titulo }),
    contenido,
  ]);
}

function membrete(nombre, datos, subtitulo) {
  return el('header', { clase: 'membrete' }, [
    el('div', { clase: 'doc-clinica', texto: nombre || 'Consultorio dental' }),
    datos ? el('div', { clase: 'doc-clinica-datos', texto: datos }) : null,
    subtitulo ? el('div', { clase: 'membrete-sub', texto: subtitulo }) : null,
    el('div', { clase: 'doc-clinica-datos', texto: `Emitido: ${fmtMarca(new Date().toISOString())}` }),
  ]);
}

/* --------------------------- Enrutador de impresión ---------------------- */

export async function vistaImprimir({ param, param2, usuario }) {
  const tipo = param;
  // La agenda se identifica por fecha (2026-08-08), no por número.
  if (tipo === 'dia') return imprimirDia(param2 || new Date().toISOString().slice(0, 10));
  const id = Number(param2);
  if (!Number.isInteger(id)) return vacio('Documento no válido.');
  if (tipo === 'consentimiento') return imprimirConsentimiento(id);
  if (tipo === 'expediente') return imprimirExpediente(id);
  if (tipo === 'cita') return imprimirCita(id, usuario);
  return vacio(`Tipo de documento desconocido: ${tipo}.`);
}

/* ------------------------------ Agenda del día --------------------------- */

/** Una página por día, una línea por cita: la hoja de la agenda de papel. */
async function imprimirDia(fecha) {
  const citas = await api.citas({ desde: fecha, hasta: fecha });
  const dia = nombreDia(fecha);

  const filas = citas.map((c) => el('tr', {}, [
    el('td', { texto: `${fmtHora(c.inicio)} – ${fmtHora(c.fin)}` }),
    el('td', {}, [
      el('b', { texto: `${c.paciente_nombre} ${c.paciente_apellidos}` }),
      c.paciente_telefono ? el('div', { clase: 'mini', texto: c.paciente_telefono }) : null,
    ]),
    el('td', { texto: c.catalogo_nombre || c.motivo || '—' }),
    el('td', { texto: c.doctor_nombre }),
    el('td', { texto: `${c.consultorio_nombre} · ${c.cubiculo_nombre}` }),
    el('td', { texto: ETIQUETAS_ESTADO[c.estado] || c.estado }),
    el('td', { clase: 'casilla-firma', texto: '' }),
  ]));

  const hoja = el('div', { clase: 'hoja' }, [
    membrete('Agenda del día', `${dia.charAt(0).toUpperCase()}${dia.slice(1)}`, null),
    citas.length
      ? tabla(['Horario', 'Paciente', 'Motivo', 'Doctor', 'Lugar', 'Estado', 'Observaciones'], filas)
      : vacio('No hay citas anotadas para este día.'),
    el('p', { clase: 'mini', style: 'margin-top:14px',
      texto: `${plural(citas.length, 'cita anotada', 'citas anotadas')} para el día.` }),
  ]);

  return el('div', {}, [barra(`Agenda del día`, '#/hoy'), hoja]);
}

/* ------------------------------ Consentimiento --------------------------- */

async function imprimirConsentimiento(id) {
  const c = await api.consentimiento(id);
  const hoja = el('div', { clase: 'hoja' }, [
    documentoConsentimiento(c),
    bloqueFirmas(c),
    pieDocumento(c),
  ]);
  if (c.estado !== 'firmado') {
    hoja.insertBefore(el('div', { clase: 'sello-borrador', texto:
      c.estado === 'anulado' ? 'ANULADO' : 'PENDIENTE DE FIRMA' }), hoja.firstChild);
  }
  return el('div', { clase: 'vista-impresion' }, [
    barra(`Consentimiento #${c.id} — ${ETIQUETA_ESTADO_CONSENT[c.estado]}`, `#/consentimiento/${c.id}`),
    hoja,
  ]);
}

/* -------------------------------- Expediente ----------------------------- */

async function imprimirExpediente(id) {
  const exp = await api.expediente(id);
  const p = exp.paciente;
  const ec = exp.estado_cuenta;

  const dato = (etq, val) => el('div', { clase: 'dato-impreso' }, [
    el('span', { clase: 'dato-etq', texto: `${etq}: ` }),
    el('span', { texto: val || '—' }),
  ]);

  const hoja = el('div', { clase: 'hoja' }, [
    membrete('Expediente clínico', `${p.nombre} ${p.apellidos}`,
      `${p.cedula ? `CI ${p.cedula} · ` : ''}${p.telefono || 'sin teléfono'}`),

    seccion('Datos personales', el('div', { clase: 'rejilla-impresion' }, [
      dato('Nombre', `${p.nombre} ${p.apellidos}`),
      dato('Cédula', p.cedula),
      dato('Nacimiento', p.fecha_nacimiento ? fmtFechaCorta(p.fecha_nacimiento) : null),
      dato('Sexo', p.sexo),
      dato('Teléfono', p.telefono),
      dato('Correo', p.email),
      dato('Dirección', p.direccion),
      dato('Contacto de emergencia', [p.contacto_emergencia, p.telefono_emergencia].filter(Boolean).join(' · ')),
    ])),

    seccion('Historia médica y odontológica', el('div', { clase: 'rejilla-impresion' }, [
      dato('Alergias', p.alergias),
      dato('Medicamentos', p.medicamentos),
      dato('Antecedentes médicos', p.antecedentes_medicos),
      dato('Antecedentes odontológicos', p.antecedentes_odontologicos),
      dato('Motivo de consulta', p.motivo_consulta),
      dato('Notas', p.notas),
    ])),

    seccion(`Tratamientos (${exp.tratamientos.length})`, exp.tratamientos.length
      ? tabla(['Fecha', 'Tratamiento', 'Piezas', 'Doctor', 'Ubicación', 'Precio'],
          exp.tratamientos.map((t) => el('tr', {}, [
            el('td', { texto: fmtFechaCorta(t.fecha) }),
            el('td', { texto: t.nombre }),
            el('td', { texto: t.dientes || '—' }),
            el('td', { texto: t.doctor_nombre }),
            el('td', { texto: `${t.consultorio_nombre} · ${t.cubiculo_nombre}` }),
            el('td', { clase: 'num', texto: fmtDinero(t.precio) }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin tratamientos registrados.' })),

    seccion(`Citas (${exp.citas.length})`, exp.citas.length
      ? tabla(['Fecha y hora', 'Motivo', 'Doctor', 'Ubicación', 'Estado'],
          exp.citas.map((c) => el('tr', {}, [
            el('td', { texto: fmtFechaHora(c.inicio) }),
            el('td', { texto: c.motivo || '—' }),
            el('td', { texto: c.doctor_nombre }),
            el('td', { texto: `${c.consultorio_nombre} · ${c.cubiculo_nombre}` }),
            el('td', { texto: ETIQUETAS_ESTADO[c.estado] || c.estado }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin citas.' })),

    seccion(`Consentimientos (${exp.consentimientos.length})`, exp.consentimientos.length
      ? tabla(['Tratamiento', 'Doctor', 'Estado', 'Firmado'],
          exp.consentimientos.map((c) => el('tr', {}, [
            el('td', { texto: c.tratamiento }),
            el('td', { texto: c.doctor_nombre }),
            el('td', { texto: ETIQUETA_ESTADO_CONSENT[c.estado] || c.estado }),
            el('td', { texto: c.firmado_en ? fmtMarca(c.firmado_en) : '—' }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin consentimientos.' })),

    seccion(`Odontograma (${exp.odontograma.length} piezas con hallazgos)`, exp.odontograma.length
      ? tabla(['Pieza', 'Cara', 'Estado', 'Nota'],
          exp.odontograma.map((o) => el('tr', {}, [
            el('td', { texto: o.diente }),
            el('td', { texto: o.cara }),
            el('td', { texto: o.estado }),
            el('td', { texto: o.nota || '—' }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin hallazgos registrados.' })),

    seccion(`Recordatorios (${exp.recordatorios.length})`, exp.recordatorios.length
      ? tabla(['Título', 'Objetivo', 'Prioridad', 'Estado'],
          exp.recordatorios.map((r) => el('tr', {}, [
            el('td', { texto: r.titulo }),
            el('td', { texto: r.fecha_objetivo ? fmtFechaCorta(r.fecha_objetivo) : '—' }),
            el('td', { texto: r.prioridad }),
            el('td', { texto: r.estado }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin recordatorios.' })),

    seccion('Estado de cuenta', el('div', {}, [
      el('p', { clase: 'resumen-cuenta', texto:
        `Facturado ${fmtDinero(ec.total_cargos)} · Abonado ${fmtDinero(ec.total_pagos)} · Saldo ${fmtDinero(ec.saldo)}` }),
      ec.cargos.length
        ? tabla(['Fecha', 'Concepto', 'Monto'], ec.cargos.map((c) => el('tr', {}, [
            el('td', { texto: fmtFechaCorta(c.fecha) }),
            el('td', { texto: c.concepto }),
            el('td', { clase: 'num', texto: fmtDinero(c.monto) }),
          ])))
        : el('p', { clase: 'mini', texto: 'Sin cargos.' }),
    ])),

    exp.fotos.length
      ? seccion(`Imágenes (${exp.fotos.length})`, el('div', { clase: 'galeria-impresion' },
          exp.fotos.map((f) => el('figure', {}, [
            el('img', { src: urlFoto(f), alt: f.nombre }),
            el('figcaption', { texto: `${f.nombre} · ${f.tipo} · ${fmtFechaCorta(f.creada_en)}` }),
          ]))))
      : null,
  ]);

  return el('div', { clase: 'vista-impresion' }, [
    barra(`Expediente de ${p.nombre} ${p.apellidos}`, `#/paciente/${p.id}`),
    hoja,
  ]);
}

/* ---------------------------------- Cita --------------------------------- */

async function imprimirCita(id) {
  const c = await api.cita(id);
  const cargos = await api.cargos({ cita_id: c.id }).catch(() => []);
  const totalCargos = cargos.reduce((s, x) => s + x.monto, 0);
  const totalPagado = cargos.reduce((s, x) => s + x.pagado, 0);

  const hoja = el('div', { clase: 'hoja' }, [
    membrete(c.consultorio_nombre, `${c.cubiculo_nombre} · ${c.doctor_nombre}`,
      `Resumen de la cita #${c.id} — ${fmtFechaHora(c.inicio)} a ${c.fin.slice(11)}`),

    seccion('Datos de la atención', el('div', { clase: 'rejilla-impresion' }, [
      el('div', { clase: 'dato-impreso' }, [
        el('span', { clase: 'dato-etq', texto: 'Paciente: ' }),
        el('span', { texto: `${c.paciente_nombre} ${c.paciente_apellidos}${c.paciente_cedula ? ` (CI ${c.paciente_cedula})` : ''}` }),
      ]),
      el('div', { clase: 'dato-impreso' }, [
        el('span', { clase: 'dato-etq', texto: 'Motivo: ' }), el('span', { texto: c.motivo || '—' }),
      ]),
      el('div', { clase: 'dato-impreso' }, [
        el('span', { clase: 'dato-etq', texto: 'Estado: ' }),
        el('span', { texto: ETIQUETAS_ESTADO[c.estado] || c.estado }),
      ]),
      el('div', { clase: 'dato-impreso' }, [
        el('span', { clase: 'dato-etq', texto: 'Notas: ' }), el('span', { texto: c.notas || '—' }),
      ]),
    ])),

    seccion(`Tratamientos realizados (${c.tratamientos.length})`, c.tratamientos.length
      ? tabla(['Tratamiento', 'Piezas', 'Notas clínicas', 'Precio'],
          c.tratamientos.map((t) => el('tr', {}, [
            el('td', { texto: t.nombre }),
            el('td', { texto: t.dientes || '—' }),
            el('td', { texto: t.notas_clinicas || '—' }),
            el('td', { clase: 'num', texto: fmtDinero(t.precio) }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin tratamientos registrados.' })),

    seccion(`Consentimientos (${c.consentimientos.length})`, c.consentimientos.length
      ? tabla(['Tratamiento', 'Doctor', 'Estado', 'Firmado'],
          c.consentimientos.map((x) => el('tr', {}, [
            el('td', { texto: x.tratamiento }),
            el('td', { texto: x.doctor_nombre }),
            el('td', { texto: ETIQUETA_ESTADO_CONSENT[x.estado] || x.estado }),
            el('td', { texto: x.firmado_en ? fmtMarca(x.firmado_en) : '—' }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin consentimientos.' })),

    seccion(`Recordatorios (${c.recordatorios.length})`, c.recordatorios.length
      ? tabla(['Título', 'Descripción', 'Objetivo'],
          c.recordatorios.map((r) => el('tr', {}, [
            el('td', { texto: r.titulo }),
            el('td', { texto: r.descripcion || '—' }),
            el('td', { texto: r.fecha_objetivo ? fmtFechaCorta(r.fecha_objetivo) : '—' }),
          ])))
      : el('p', { clase: 'mini', texto: 'Sin recordatorios.' })),

    seccion('Cobros', cargos.length
      ? el('div', {}, [
          tabla(['Concepto', 'Monto', 'Pagado', 'Saldo'], cargos.map((x) => el('tr', {}, [
            el('td', { texto: x.concepto }),
            el('td', { clase: 'num', texto: fmtDinero(x.monto) }),
            el('td', { clase: 'num', texto: fmtDinero(x.pagado) }),
            el('td', { clase: 'num', texto: fmtDinero(x.saldo) }),
          ]))),
          el('p', { clase: 'resumen-cuenta', texto:
            `Total ${fmtDinero(totalCargos)} · Pagado ${fmtDinero(totalPagado)} · Saldo ${fmtDinero(totalCargos - totalPagado)}` }),
        ])
      : el('p', { clase: 'mini', texto: 'Sin cargos en esta cita.' })),

    c.fotos.length
      ? seccion(`Imágenes (${c.fotos.length})`, el('div', { clase: 'galeria-impresion' },
          c.fotos.map((f) => el('figure', {}, [
            el('img', { src: urlFoto(f), alt: f.nombre }),
            el('figcaption', { texto: `${f.nombre} · ${f.tipo}` }),
          ]))))
      : null,

    el('div', { clase: 'firmas' }, [
      el('div', { clase: 'firma-bloque' }, [
        el('div', { clase: 'firma-linea' }),
        el('div', { clase: 'firma-pie' }, [
          el('div', { clase: 'firma-rol', texto: 'Firma del doctor' }),
          el('div', { clase: 'firma-nombre', texto: c.doctor_nombre }),
        ]),
      ]),
    ]),
  ]);

  return el('div', { clase: 'vista-impresion' }, [
    barra(`Cita #${c.id} — ${c.paciente_nombre} ${c.paciente_apellidos}`, `#/cita/${c.id}`),
    hoja,
  ]);
}
