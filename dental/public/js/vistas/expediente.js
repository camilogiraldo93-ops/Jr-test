import { api, ErrorApi, urlFoto } from '../api.js';
import { el, limpiar, modal, campo, selector, area, exito, error, vacio, fmtDinero, fmtFechaCorta,
  fmtFechaHora, fmtMarca, etiquetaEstado, entrada, NOMBRE_DIENTE, NOMBRE_PRIORIDAD,
  nombreCompleto, plural, NOMBRE_METODO_PAGO } from '../ui.js';
import { abrirFormularioPaciente } from './pacientes.js';
import { abrirFormularioCita } from './formCita.js';
import { abrirNuevoConsentimiento } from './consentimiento.js';
import { ETIQUETA_ESTADO_CONSENT } from '../consentimiento-doc.js';

const DIENTES_SUP = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'];
const DIENTES_INF = ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38'];
const ESTADOS_DIENTE = ['sano','caries','obturado','corona','ausente','endodoncia','implante','fractura','sellante'];

// Una marca corta y reconocible dentro del cuadrito del diente; el nombre
// completo aparece al pasar el ratón y en el cuadro de edición.
const MARCA_DIENTE = {
  caries: 'C', obturado: 'O', corona: 'CO', ausente: '✕',
  endodoncia: 'E', implante: 'I', fractura: 'F', sellante: 'S',
};

function dato(etiqueta, valor) {
  return el('div', {}, [
    el('div', { clase: 'mini', texto: etiqueta }),
    el('div', { texto: valor || '—' }),
  ]);
}

function edad(fechaNac) {
  if (!fechaNac) return null;
  const n = new Date(`${fechaNac}T12:00:00`);
  if (Number.isNaN(n.getTime())) return null;
  const hoy = new Date();
  let a = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) a--;
  return a;
}

export async function vistaExpediente({ param, usuario, navegar, refrescar }) {
  const id = Number(param);
  if (!Number.isInteger(id)) return vacio('Paciente no válido.');
  const exp = await api.expediente(id);
  const p = exp.paciente;
  const puedeClinico = ['admin', 'doctor'].includes(usuario.rol);

  /* ------------------------------- Pestañas ------------------------------ */
  const paneles = {};
  const zona = el('div', {});
  const pestanas = el('div', { clase: 'pestanas', style: 'margin-bottom:16px;overflow-x:auto' });

  function agregarPestana(clave, texto, constructor) {
    paneles[clave] = constructor;
    const b = el('button', {
      type: 'button', texto, datos: { clave },
      onclick: () => mostrar(clave),
    });
    pestanas.appendChild(b);
  }

  function mostrar(clave) {
    pestanas.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.clave === clave));
    limpiar(zona);
    zona.appendChild(paneles[clave]());
  }

  /* --------------------------------- Ficha ------------------------------- */
  agregarPestana('ficha', '📋 Ficha', () => el('div', {}, [
    el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Datos personales' }),
      el('div', { clase: 'rejilla c4' }, [
        dato('Nombre completo', nombreCompleto(p.nombre, p.apellidos)),
        dato('Cédula', p.cedula),
        dato('Teléfono', p.telefono),
        dato('Correo', p.email),
        dato('Fecha de nacimiento', p.fecha_nacimiento ? `${fmtFechaCorta(p.fecha_nacimiento)} (${edad(p.fecha_nacimiento)} años)` : null),
        dato('Sexo', p.sexo === 'F' ? 'Femenino' : p.sexo === 'M' ? 'Masculino' : p.sexo),
        dato('Ocupación', p.ocupacion),
        dato('Dirección', p.direccion),
        dato('Contacto de emergencia', p.contacto_emergencia),
        dato('Teléfono de emergencia', p.telefono_emergencia),
        dato('Registrado', fmtMarca(p.creado_en)),
        dato('Ficha actualizada por última vez', fmtMarca(p.actualizado_en)),
      ]),
    ]),
    el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Historia médica y odontológica' }),
      el('div', { clase: 'rejilla c2' }, [
        dato('Alergias', p.alergias),
        dato('Medicamentos actuales', p.medicamentos),
        dato('Antecedentes médicos', p.antecedentes_medicos),
        dato('Antecedentes odontológicos', p.antecedentes_odontologicos),
        dato('Motivo de consulta', p.motivo_consulta),
        dato('Notas', p.notas),
      ]),
    ]),
    exp.proxima_cita
      ? el('div', { clase: 'tarjeta' }, [
          el('h3', { texto: '📅 Próxima cita' }),
          el('div', { clase: 'acciones' }, [
            el('div', {}, [
              el('div', { texto: `${fmtFechaHora(exp.proxima_cita.inicio)} — ${exp.proxima_cita.motivo || 'Sin motivo'}` }),
              el('div', { clase: 'mini', texto: `${exp.proxima_cita.doctor_nombre} · ${exp.proxima_cita.consultorio_nombre} · ${exp.proxima_cita.cubiculo_nombre}` }),
            ]),
            etiquetaEstado(exp.proxima_cita.estado),
            el('a', { clase: 'btn sec chico', href: `#/cita/${exp.proxima_cita.id}`, texto: 'Abrir cita' }),
          ]),
        ])
      : el('div', { clase: 'tarjeta' }, [el('h3', { texto: '📅 Próxima cita' }), vacio('El paciente no tiene citas futuras agendadas.')]),
  ]));

  /* ------------------------------ Historial ------------------------------ */
  agregarPestana('historial', '🕒 Historial', () => {
    if (!exp.cronologia.length) {
      return el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Todo lo que ha pasado, de lo más nuevo a lo más viejo' }),
        vacio('Sin actividad registrada todavía.'),
      ]);
    }
    const iconos = { cita: '📅', tratamiento: '🦷', consentimiento: '📝', foto: '🖼️' };
    const NOMBRE_TIPO_HISTORIAL = {
      cita: 'Cita', tratamiento: 'Tratamiento', consentimiento: 'Consentimiento', foto: 'Imagen',
    };
    return el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Todo lo que ha pasado, de lo más nuevo a lo más viejo' }),
      el('div', { clase: 'linea' }, exp.cronologia.map((i) => el('div', { clase: `item ${i.tipo}` }, [
        el('div', { clase: 'fecha', texto: `${fmtFechaHora(i.fecha)} · ${iconos[i.tipo] || ''} ${NOMBRE_TIPO_HISTORIAL[i.tipo] || i.tipo}` }),
        el('div', { clase: 'tit', texto: i.titulo }),
        i.detalle ? el('div', { clase: 'det', texto: i.detalle }) : null,
        (i.doctor || i.lugar)
          ? el('div', { clase: 'mini', texto: [i.doctor, i.lugar].filter(Boolean).join(' · ') })
          : null,
        i.tipo === 'cita' ? el('a', { clase: 'mini', href: `#/cita/${i.ref_id}`, texto: 'Ver cita →' }) : null,
      ]))),
    ]);
  });

  /* ---------------------------- Tratamientos ----------------------------- */
  agregarPestana('tratamientos', '🦷 Tratamientos', () => {
    if (!exp.tratamientos.length) {
      return el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Tratamientos realizados' }),
        vacio('Sin tratamientos registrados.'),
      ]);
    }
    return el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Tratamientos realizados' }),
      el('div', { clase: 'tabla-envoltura' }, [
        el('table', { clase: 'tabla' }, [
          el('thead', {}, [el('tr', {}, ['Fecha', 'Tratamiento', 'Dientes', 'Doctor', 'Ubicación', 'Notas clínicas', 'Precio'].map(
            (t) => el('th', { texto: t })))]),
          el('tbody', {}, exp.tratamientos.map((t) => el('tr', {}, [
            el('td', { texto: fmtFechaCorta(t.fecha) }),
            el('td', {}, [
              el('b', { texto: t.nombre }),
              t.cita_id ? el('div', {}, [el('a', { clase: 'mini', href: `#/cita/${t.cita_id}`, texto: 'Ver la cita' })]) : null,
            ]),
            el('td', { texto: t.dientes || '—' }),
            el('td', { texto: t.doctor_nombre }),
            el('td', { texto: `${t.consultorio_nombre} · ${t.cubiculo_nombre}` }),
            el('td', { texto: t.notas_clinicas || t.descripcion || '—' }),
            el('td', { clase: 'num', texto: fmtDinero(t.precio) }),
          ]))),
        ]),
      ]),
    ]);
  });

  /* -------------------------------- Fotos -------------------------------- */
  agregarPestana('fotos', `🖼️ Imágenes (${exp.fotos.length})`, () => {
    if (!exp.fotos.length) {
      return el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Radiografías e imágenes intraorales' }),
        vacio('No hay imágenes. Se cargan desde la pantalla de la cita al atender al paciente.'),
      ]);
    }
    return el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Radiografías e imágenes intraorales' }),
      el('div', { clase: 'galeria' }, exp.fotos.map((f) => el('figure', {}, [
        el('img', {
          src: urlFoto(f), alt: f.nombre, loading: 'lazy',
          onclick: () => modal({
            titulo: f.nombre, ancho: true,
            cuerpo: el('div', {}, [
              el('img', { src: urlFoto(f), alt: f.nombre, style: 'width:100%;border-radius:10px' }),
              el('p', { clase: 'mini', style: 'margin-top:8px', texto: `${f.tipo} · ${fmtMarca(f.creada_en)}${f.descripcion ? ` · ${f.descripcion}` : ''}` }),
            ]),
          }),
        }),
        el('figcaption', {}, [
          el('b', { texto: f.nombre }),
          el('span', { texto: `${f.tipo} · ${fmtFechaCorta(f.creada_en)}` }),
          f.cita_id ? el('div', {}, [el('a', { clase: 'mini', href: `#/cita/${f.cita_id}`, texto: 'Ver la cita' })]) : null,
        ]),
      ]))),
    ]);
  });

  /* --------------------------- Consentimientos --------------------------- */
  const pendientesConsent = exp.consentimientos.filter((c) => c.estado === 'pendiente').length;
  agregarPestana('consentimientos', `📝 Consentimientos (${exp.consentimientos.length})`, () => {
    const botonNuevo = ['admin', 'doctor', 'recepcion'].includes(usuario.rol)
      ? el('button', {
          clase: 'btn chico', type: 'button', texto: '➕ Nuevo consentimiento', style: 'margin-left:auto',
          onclick: () => abrirNuevoConsentimiento({ paciente_id: p.id, navegar }),
        })
      : null;

    return el('div', { clase: 'tarjeta' }, [
      el('h3', {}, [el('span', { texto: 'Consentimientos informados' }), botonNuevo]),
      pendientesConsent
        ? el('div', { clase: 'alerta-caja aviso', texto:
            `Falta firmar ${plural(pendientesConsent, 'consentimiento', 'consentimientos')}.` })
        : null,
      exp.consentimientos.length
        ? el('div', { clase: 'tabla-envoltura' }, [
            el('table', { clase: 'tabla' }, [
              el('thead', {}, [el('tr', {}, ['Fecha', 'Tratamiento', 'Doctor', 'Cita', 'Estado', ''].map(
                (t) => el('th', { texto: t })))]),
              el('tbody', {}, exp.consentimientos.map((c) => el('tr', {}, [
                el('td', { texto: fmtFechaCorta(c.fecha || c.creado_en) }),
                el('td', {}, [
                  el('b', { texto: c.tratamiento }),
                  c.observaciones ? el('div', { clase: 'mini', texto: c.observaciones }) : null,
                ]),
                el('td', { texto: c.doctor_nombre }),
                el('td', {}, [c.cita_id
                  ? el('a', { href: `#/cita/${c.cita_id}`, texto: 'Ver' })
                  : document.createTextNode('Sin cita')]),
                el('td', {}, [
                  el('span', {
                    clase: `eti ${c.estado === 'firmado' ? 'firmado' : c.estado === 'anulado' ? 'cancelado' : 'pendiente'}`,
                    texto: ETIQUETA_ESTADO_CONSENT[c.estado] || c.estado,
                  }),
                  c.firmado_en ? el('div', { clase: 'mini', texto: fmtMarca(c.firmado_en) }) : null,
                  c.estado === 'anulado' && c.anulado_motivo
                    ? el('div', { clase: 'mini', texto: c.anulado_motivo }) : null,
                ]),
                el('td', {}, [
                  el('a', {
                    clase: c.estado === 'pendiente' ? 'btn chico' : 'btn sec chico',
                    href: `#/consentimiento/${c.id}`,
                    texto: c.estado === 'pendiente' ? '✍️ Firmar' : 'Ver documento',
                  }),
                ]),
              ]))),
            ]),
          ])
        : vacio('Todavía no hay consentimientos. Se preparan solos al anotar un tratamiento que los necesita, o con el botón de arriba.'),
    ]);
  });

  /* ---------------------------- Recordatorios ---------------------------- */
  agregarPestana('recordatorios', `🔔 Recordatorios (${exp.recordatorios.filter((r) => r.estado === 'pendiente').length})`, () => {
    if (!exp.recordatorios.length) {
      return el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Recordatorios de tratamiento y seguimiento' }),
        vacio('Sin recordatorios.'),
      ]);
    }
    return el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Recordatorios de tratamiento y seguimiento' }),
      el('ul', { clase: 'lista-simple' }, exp.recordatorios.map((r) => el('li', {}, [
        el('div', {}, [
          el('div', { clase: 'tit', texto: r.titulo }),
          el('div', { clase: 'det', texto: r.descripcion || '' }),
          el('div', { clase: 'mini', texto: `${r.fecha_objetivo ? `Para el ${fmtFechaCorta(r.fecha_objetivo)}` : 'Sin fecha'} · ${NOMBRE_PRIORIDAD[r.prioridad] || r.prioridad}` }),
        ]),
        el('div', { clase: 'acciones' }, [
          el('span', { clase: `eti ${r.estado}`, texto: r.estado }),
          r.estado === 'pendiente'
            ? el('button', {
                clase: 'btn sec chico', type: 'button', texto: 'Completar',
                onclick: async () => {
                  try {
                    await api.actualizarRecordatorio(r.id, { estado: 'completado' });
                    exito('Recordatorio marcado como completado.');
                    await refrescar();
                  } catch (e) { error(e instanceof ErrorApi ? e.message : 'No se pudo actualizar.'); }
                },
              })
            : null,
        ]),
      ]))),
    ]);
  });

  /* ----------------------------- Odontograma ----------------------------- */
  agregarPestana('odontograma', '🪥 Odontograma', () => {
    const mapa = new Map(exp.odontograma.map((o) => [`${o.diente}`, o]));
    const pintar = (num) => {
      const reg = exp.odontograma.filter((o) => o.diente === num);
      const principal = reg.find((r) => r.cara === 'general') || reg[0];
      const estadoD = principal?.estado || 'sano';
      return el('button', {
        type: 'button', clase: `diente ${estadoD}`,
        title: `Pieza ${num}: ${NOMBRE_DIENTE[estadoD] || estadoD}${principal?.nota ? ` — ${principal.nota}` : ''}`,
        onclick: () => puedeClinico ? editarDiente(num, principal) : null,
      }, [
        el('span', { clase: 'num', texto: num }),
        // El nombre completo va en el título; en el diente cabe una marca corta,
        // no un código recortado como «ause» u «obtu».
        el('span', { texto: estadoD === 'sano' ? '' : (MARCA_DIENTE[estadoD] || '•') }),
      ]);
    };

    function editarDiente(num, actual) {
      const sel = selector('estado',
        ESTADOS_DIENTE.map((e) => ({ valor: e, texto: NOMBRE_DIENTE[e] || e })), actual?.estado || 'sano');
      const nota = area('nota', { value: actual?.nota || '' });
      const m = modal({
        titulo: `Pieza dental ${num}`,
        cuerpo: el('div', {}, [campo('Estado', sel), campo('Nota', nota)]),
        pie: [
          el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }),
          el('button', {
            clase: 'btn', type: 'button', texto: 'Guardar',
            onclick: async () => {
              try {
                await api.guardarDiente(p.id, { diente: num, cara: 'general', estado: sel.value, nota: nota.value });
                m.cerrar();
                exito(`Pieza ${num} actualizada.`);
                await refrescar();
              } catch (e) { error(e instanceof ErrorApi ? e.message : 'No se pudo guardar.'); }
            },
          }),
        ],
      });
    }

    return el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: 'Odontograma' }),
      el('div', { clase: 'odontograma' }, [
        el('div', { clase: 'arcada' }, DIENTES_SUP.map(pintar)),
        el('div', { clase: 'arcada' }, DIENTES_INF.map(pintar)),
      ]),
      el('div', { clase: 'leyenda', style: 'margin-top:14px' }, [
        el('span', { clase: 'caries', texto: 'Caries' }),
        el('span', { clase: 'obturado', texto: 'Obturado' }),
        el('span', { clase: 'corona', texto: 'Corona' }),
        el('span', { clase: 'ausente', texto: 'Ausente' }),
        el('span', { clase: 'endodoncia', texto: 'Endodoncia' }),
        el('span', { clase: 'implante', texto: 'Implante' }),
      ]),
      puedeClinico ? el('p', { clase: 'mini', style: 'margin-top:8px', texto: 'Toca una pieza para registrar su estado.' }) : null,
    ]);
  });

  /* --------------------------- Estado de cuenta -------------------------- */
  agregarPestana('cuenta', '💰 Su cuenta', () => {
    const ec = exp.estado_cuenta;
    const kpi = (etq, val, clase = '') => el('div', { clase: 'kpi' }, [
      el('div', { clase: 'etq', texto: etq }),
      el('div', { clase: `val ${clase}`, texto: val }),
    ]);
    return el('div', {}, [
      el('div', { clase: 'rejilla c3', style: 'margin-bottom:16px' }, [
        kpi('Se le ha cobrado', fmtDinero(ec.total_cargos)),
        kpi('Ya pagó', fmtDinero(ec.total_pagos), 'ok'),
        kpi('Le falta pagar', fmtDinero(ec.saldo), ec.saldo > 0 ? 'mal' : 'ok'),
      ]),
      el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Lo que se le ha cobrado' }),
        ec.cargos.length
          ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
              el('thead', {}, [el('tr', {}, ['Fecha', 'Por qué', 'Cita', 'Cuánto'].map((t) => el('th', { texto: t })))]),
              el('tbody', {}, ec.cargos.map((c) => el('tr', {}, [
                el('td', { texto: fmtFechaCorta(c.fecha) }),
                el('td', { texto: c.concepto }),
                el('td', {}, [c.cita_id ? el('a', { href: `#/cita/${c.cita_id}`, texto: 'Ver' }) : document.createTextNode('—')]),
                el('td', { clase: 'num', texto: fmtDinero(c.monto) }),
              ]))),
            ])])
          : vacio('Todavía no se le ha cobrado nada.'),
      ]),
      el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: 'Lo que ha pagado' }),
        ec.pagos.length
          ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
              el('thead', {}, [el('tr', {}, ['Fecha', 'Cómo pagó', 'Nota', 'Cuánto'].map((t) => el('th', { texto: t })))]),
              el('tbody', {}, ec.pagos.map((c) => el('tr', {}, [
                el('td', { texto: fmtFechaCorta(c.fecha) }),
                el('td', { texto: NOMBRE_METODO_PAGO[c.metodo] || c.metodo }),
                el('td', { texto: c.nota || '—' }),
                el('td', { clase: 'num', texto: fmtDinero(c.monto) }),
              ]))),
            ])])
          : vacio('Todavía no ha pagado nada.'),
      ]),
    ]);
  });

  /* -------------------------------- Marco -------------------------------- */
  const alertas = [];
  if (p.alergias && !/ninguna/i.test(p.alergias)) alertas.push(`Alergias: ${p.alergias}`);
  if (p.antecedentes_medicos && !/sin antecedentes/i.test(p.antecedentes_medicos)) {
    alertas.push(`Antecedentes: ${p.antecedentes_medicos}`);
  }

  const contenedor = el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: nombreCompleto(p.nombre, p.apellidos) }),
        el('div', { clase: 'desc', texto: `${p.cedula ? `CI ${p.cedula} · ` : ''}${p.telefono || 'sin teléfono'} · ` +
          `${plural(exp.citas.length, 'cita', 'citas')} · ${plural(exp.tratamientos.length, 'tratamiento', 'tratamientos')}` }),
      ]),
      el('div', { clase: 'acciones' }, [
        el('a', { clase: 'btn sec', href: '#/pacientes', texto: '← Pacientes' }),
        el('a', { clase: 'btn sec', href: `#/imprimir/expediente/${p.id}`, texto: '🖨️ Imprimir' }),
        el('button', {
          clase: 'btn sec', type: 'button', texto: '✏️ Editar ficha',
          onclick: () => abrirFormularioPaciente(p, refrescar),
        }),
        el('button', {
          clase: 'btn', type: 'button', texto: '📅 Agendar cita',
          onclick: () => abrirFormularioCita({ paciente_id: p.id, alGuardar: (c) => navegar(`#/cita/${c.id}`) }),
        }),
      ]),
    ]),
    alertas.length
      ? el('div', { clase: 'alerta-caja aviso' }, [
          el('b', { texto: '⚠️ Alertas clínicas' }),
          el('ul', {}, alertas.map((a) => el('li', { texto: a }))),
        ])
      : null,
    pestanas,
    zona,
  ]);

  mostrar('ficha');
  return contenedor;
}
