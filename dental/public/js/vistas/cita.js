import { api, ErrorApi, urlFoto } from '../api.js';
import { el, limpiar, modal, campo, entrada, area, selector, exito, error, vacio, confirmar,
  fmtDinero, fmtFechaHora, fmtFechaCorta, fmtMarca, etiquetaEstado, hoyIso, ETIQUETAS_ESTADO,
  plural, NOMBRE_DIENTE, NOMBRE_METODO_PAGO, nombreCompleto } from '../ui.js';
import { abrirFormularioCita } from './formCita.js';
import { abrirNuevoConsentimiento } from './consentimiento.js';

const SIGUIENTES = {
  agendada: ['confirmada', 'en_curso', 'cancelada', 'no_asistio'],
  confirmada: ['en_curso', 'completada', 'cancelada', 'no_asistio'],
  en_curso: ['completada', 'cancelada'],
  completada: [],
  cancelada: ['agendada'],
  no_asistio: ['agendada'],
};

function leerArchivo(file) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = () => rechazar(new Error(`No se pudo leer el archivo ${file.name}.`));
    lector.readAsDataURL(file);
  });
}

export async function vistaCita({ param, usuario, refrescar, navegar }) {
  const id = Number(param);
  if (!Number.isInteger(id)) return vacio('Cita no válida.');

  const [cita, catalogo] = await Promise.all([api.cita(id), api.catalogo()]);
  const puedeClinico = ['admin', 'doctor'].includes(usuario.rol);
  const puedeCobrar = ['admin', 'recepcion'].includes(usuario.rol);
  const activa = !['cancelada', 'no_asistio'].includes(cita.estado);
  // El registro clínico pertenece a la atención: exige que la cita esté en curso.
  const enAtencion = ['en_curso', 'completada'].includes(cita.estado);
  const consentPendientes = cita.consentimientos.filter((c) => c.estado === 'pendiente');

  /* ---------------------------- Cambio de estado -------------------------- */
  const accionesEstado = el('div', { clase: 'acciones' }, SIGUIENTES[cita.estado].map((e) =>
    el('button', {
      clase: e === 'cancelada' || e === 'no_asistio' ? 'btn sec chico' : 'btn chico',
      type: 'button', texto: ETIQUETAS_ESTADO[e],
      onclick: async () => {
        if (['cancelada', 'no_asistio'].includes(e)) {
          const ok = await confirmar(`Marcar como ${ETIQUETAS_ESTADO[e]}`,
            `La cita de ${nombreCompleto(cita.paciente_nombre, cita.paciente_apellidos)} pasará a "${ETIQUETAS_ESTADO[e]}" y su hora quedará libre en la agenda.`);
          if (!ok) return;
        }
        try {
          await api.cambiarEstadoCita(cita.id, e);
          exito(`La cita ahora está "${ETIQUETAS_ESTADO[e]}".`);
          await refrescar();
        } catch (err) {
          const pendientes = err instanceof ErrorApi ? err.detalle?.consentimientos_pendientes : null;
          if (pendientes?.length) {
            error(err.message, 'Consentimiento sin firmar');
            navegar(`#/consentimiento/${pendientes[0].id}`);
            return;
          }
          error(err instanceof ErrorApi ? err.message : 'No se pudo cambiar el estado.');
        }
      },
    })));

  /* ----------------------------- Tratamientos ---------------------------- */
  function abrirTratamiento() {
    // Si la cita se agendó con un tratamiento previsto, se abre ya elegido.
    const previsto = catalogo.some((c) => c.id === cita.catalogo_id) ? String(cita.catalogo_id) : '';
    const selCat = selector('catalogo_id', [
      { valor: '', texto: '— Otra cosa que escribo yo —' },
      ...catalogo.map((c) => ({ valor: c.id, texto: `${c.nombre} (${fmtDinero(c.precio_base)})` })),
    ], previsto);
    const inNombre = entrada('nombre', { required: true, placeholder: 'Nombre del tratamiento realizado' });
    const inDientes = entrada('dientes', { placeholder: 'Ej.: 16, 26 (separados por coma)' });
    const selEstadoDiente = selector('estado_diente', [
      { valor: '', texto: 'Dejarlos como estaban' },
      ...['sano', 'caries', 'obturado', 'corona', 'ausente', 'endodoncia', 'implante', 'fractura', 'sellante']
        .map((e) => ({ valor: e, texto: NOMBRE_DIENTE[e] || e })),
    ], '');
    const inNotas = area('notas_clinicas', { placeholder: 'Hallazgos, materiales usados, indicaciones…' });
    const inPrecio = entrada('precio', { type: 'number', step: '0.01', min: '0', value: '0' });
    const chkConsent = el('input', { type: 'checkbox' });
    const chkCargo = el('input', { type: 'checkbox', checked: true });

    function aplicarCatalogo() {
      const c = catalogo.find((x) => String(x.id) === selCat.value);
      if (c) {
        inNombre.value = c.nombre;
        inPrecio.value = String(c.precio_base);
        chkConsent.checked = !!c.requiere_consentimiento;
      }
    }
    selCat.addEventListener('change', aplicarCatalogo);
    aplicarCatalogo();

    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Guardar' });
    const m = modal({
      titulo: 'Anotar lo que se hizo',
      ancho: true,
      cuerpo: el('div', {}, [
        campo('¿Qué se hizo?', selCat, 'Elige de la lista de siempre y se completan el nombre, el precio y el consentimiento.'),
        campo('Nombre de lo que se hizo *', inNombre),
        el('div', { clase: 'fila' }, [
          campo('¿En qué dientes?', inDientes),
          campo('¿Cómo quedaron?', selEstadoDiente),
          campo('¿Cuánto se cobra?', inPrecio),
        ]),
        campo('Notas', inNotas),
        el('label', { clase: 'campo', style: 'display:flex;gap:9px;align-items:center' }, [
          chkConsent, el('span', { texto: 'Necesita consentimiento firmado (el documento se prepara solo)' }),
        ]),
        el('label', { clase: 'campo', style: 'display:flex;gap:9px;align-items:center' }, [
          chkCargo, el('span', { texto: 'Dejar este valor como cobro pendiente del paciente' }),
        ]),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      if (!inNombre.value.trim()) { error('Escribe qué se hizo, aunque sea en pocas palabras.'); return; }
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        await api.crearTratamiento(cita.id, {
          catalogo_id: selCat.value ? Number(selCat.value) : null,
          nombre: inNombre.value.trim(),
          dientes: inDientes.value.trim(),
          estado_diente: selEstadoDiente.value || null,
          notas_clinicas: inNotas.value.trim(),
          precio: Number(inPrecio.value || 0),
          requiere_consentimiento: chkConsent.checked,
          generar_cargo: chkCargo.checked,
        });
        m.cerrar();
        exito('Listo, quedó anotado en el expediente del paciente.');
        await refrescar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : 'No se pudo registrar el tratamiento.');
      } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar';
      }
    });
  }

  /* -------------------------------- Fotos -------------------------------- */
  function abrirFotos() {
    const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true });
    const selTipo = selector('tipo', [
      { valor: 'radiografia', texto: 'Radiografía' },
      { valor: 'intraoral', texto: 'Foto intraoral' },
      { valor: 'extraoral', texto: 'Foto extraoral' },
      { valor: 'documento', texto: 'Documento' },
      { valor: 'otro', texto: 'Otro' },
    ], 'intraoral');
    const inDesc = entrada('descripcion', { placeholder: 'Descripción (opcional)' });
    const lista = el('div', { clase: 'mini' });
    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Subir imágenes' });

    input.addEventListener('change', () => {
      lista.textContent = input.files.length
        ? `Elegiste ${plural(input.files.length, 'archivo', 'archivos')}: ${[...input.files].map((f) => f.name).join(', ')}`
        : '';
    });

    const m = modal({
      titulo: 'Subir radiografías y fotos',
      cuerpo: el('div', {}, [
        campo('Archivos de imagen', input, 'Puedes seleccionar varias imágenes a la vez (PNG, JPG, WEBP o GIF).'),
        lista,
        campo('Tipo', selTipo),
        campo('Descripción', inDesc),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      if (!input.files.length) { error('Selecciona al menos una imagen.'); return; }
      boton.disabled = true;
      boton.textContent = 'Subiendo…';
      let subidas = 0;
      try {
        for (const file of input.files) {
          const datos = await leerArchivo(file);
          await api.subirFoto(cita.id, {
            nombre: file.name, datos, tipo: selTipo.value, descripcion: inDesc.value.trim(),
          });
          subidas++;
        }
        m.cerrar();
        exito(`Listo, ${plural(subidas, 'imagen quedó guardada', 'imágenes quedaron guardadas')} en el expediente.`);
        await refrescar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : `No se pudieron subir todas las imágenes (${subidas} completadas).`);
      } finally {
        boton.disabled = false;
        boton.textContent = 'Subir imágenes';
      }
    });
  }

  /* ---------------------------- Recordatorios ---------------------------- */
  function abrirRecordatorio() {
    const inTitulo = entrada('titulo', { required: true, placeholder: 'Ej.: Control de la restauración' });
    const inDesc = area('descripcion', { placeholder: 'Qué debe revisarse o completarse' });
    const inFecha = entrada('fecha_objetivo', { type: 'date', value: hoyIso() });
    const selPrioridad = selector('prioridad', [
      { valor: 'baja', texto: 'Baja' }, { valor: 'media', texto: 'Media' }, { valor: 'alta', texto: 'Alta' },
    ], 'media');
    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Crear recordatorio' });

    const m = modal({
      titulo: 'Nuevo recordatorio de seguimiento',
      cuerpo: el('div', {}, [
        campo('Título *', inTitulo),
        campo('Descripción', inDesc),
        el('div', { clase: 'fila' }, [campo('Fecha objetivo', inFecha), campo('Prioridad', selPrioridad)]),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      if (!inTitulo.value.trim()) { error('El recordatorio necesita un título.'); return; }
      boton.disabled = true;
      try {
        await api.crearRecordatorio(cita.id, {
          titulo: inTitulo.value.trim(), descripcion: inDesc.value.trim(),
          fecha_objetivo: inFecha.value, prioridad: selPrioridad.value,
        });
        m.cerrar();
        exito('Recordatorio creado y vinculado al expediente.');
        await refrescar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : 'No se pudo crear el recordatorio.');
      } finally {
        boton.disabled = false;
      }
    });
  }

  /* ------------------------------- Cobros -------------------------------- */
  function abrirCobro(cargo = null) {
    const inMonto = entrada('monto', { type: 'number', step: '0.01', min: '0.01', required: true,
      value: cargo ? String(cargo.monto) : '' });
    const selMetodo = selector('metodo', [
      { valor: 'efectivo', texto: 'Efectivo' }, { valor: 'tarjeta', texto: 'Tarjeta' },
      { valor: 'transferencia', texto: 'Transferencia' }, { valor: 'seguro', texto: 'Seguro' },
      { valor: 'otro', texto: 'Otro' },
    ], 'efectivo');
    const inNota = entrada('nota', { placeholder: 'Referencia o nota (opcional)' });
    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Registrar pago' });

    const m = modal({
      titulo: cargo ? `Cobrar: ${cargo.concepto}` : 'Registrar un pago',
      cuerpo: el('div', {}, [
        cargo ? el('div', { clase: 'alerta-caja ok', texto: `Se le cobró ${fmtDinero(cargo.monto)} y le faltan ${fmtDinero(cargo.saldo)}.` }) : null,
        campo('¿Cuánto pagó?', inMonto),
        campo('¿Cómo pagó?', selMetodo),
        campo('Nota', inNota),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      const monto = Number(inMonto.value);
      if (!(monto > 0)) { error('Escribe cuánto pagó. Tiene que ser un número mayor que cero.'); return; }
      boton.disabled = true;
      try {
        await api.crearPago({
          cargo_id: cargo?.id ?? null,
          paciente_id: cita.paciente_id,
          consultorio_id: cita.consultorio_id,
          monto, metodo: selMetodo.value, nota: inNota.value.trim(),
        });
        m.cerrar();
        exito('Listo, el pago quedó registrado en la cuenta del paciente.');
        await refrescar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : 'No se pudo registrar el pago.');
      } finally {
        boton.disabled = false;
      }
    });
  }

  /* ------------------------------ Secciones ------------------------------ */
  const cargosConSaldo = await api.cargos({ cita_id: cita.id });

  /**
   * Ningún botón muerto: si la atención todavía no empezó, el mismo botón la
   * abre y enseguida deja anotar. El paso intermedio lo da la app, no la persona.
   */
  function botonRegistrar() {
    if (!puedeClinico || !activa) return null;
    if (enAtencion) {
      return el('button', {
        clase: 'btn chico', type: 'button', texto: '➕ Anotar lo que se hizo',
        style: 'margin-left:auto', onclick: abrirTratamiento,
      });
    }
    const boton = el('button', {
      clase: 'btn chico', type: 'button', texto: '▶️ El paciente llegó — empezar',
      style: 'margin-left:auto',
      onclick: async () => {
        boton.disabled = true;
        boton.textContent = 'Abriendo la atención…';
        try {
          await api.cambiarEstadoCita(cita.id, 'en_curso');
          exito('La atención está abierta. Ahora puedes anotar lo que se hizo.');
          await refrescar();
          abrirTratamiento();
        } catch (err) {
          error(err instanceof ErrorApi ? err.message : 'No se pudo abrir la atención.');
          boton.disabled = false;
          boton.textContent = '▶️ El paciente llegó — empezar';
        }
      },
    });
    return boton;
  }

  const seccionTratamientos = el('div', { clase: 'tarjeta' }, [
    el('h3', {}, [
      el('span', { texto: '🦷 Lo que se hizo en esta cita' }),
      botonRegistrar(),
    ]),
    puedeClinico && activa && !enAtencion
      ? el('div', { clase: 'alerta-caja aviso', texto:
          'Cuando el paciente llegue, pulsa «El paciente llegó» y podrás anotar el tratamiento aquí mismo.' })
      : null,
    // Quien no puede anotar necesita saber por qué y qué sí puede hacer, en vez
    // de encontrarse una tarjeta vacía sin un solo botón.
    !puedeClinico
      ? el('div', { clase: 'alerta-caja aviso', texto:
          'Esto lo anota el doctor durante la atención. Tú puedes verlo aquí en cuanto lo escriba, ' +
          'y cobrarle al paciente en «Cobros de esta cita», más abajo.' })
      : null,
    cita.tratamientos.length
      ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
          el('thead', {}, [el('tr', {}, ['Tratamiento', 'Piezas', 'Notas clínicas', 'Precio', 'Consentimiento'].map((t) => el('th', { texto: t })))]),
          el('tbody', {}, cita.tratamientos.map((t) => {
            const cons = cita.consentimientos.find((c) => c.tratamiento_id === t.id);
            return el('tr', {}, [
              el('td', {}, [el('b', { texto: t.nombre })]),
              el('td', { texto: t.dientes || '—' }),
              el('td', { texto: t.notas_clinicas || '—' }),
              el('td', { clase: 'num', texto: fmtDinero(t.precio) }),
              el('td', {}, [
                cons
                  ? el('a', {
                      clase: cons.estado === 'firmado' ? 'btn sec chico' : 'btn chico',
                      href: `#/consentimiento/${cons.id}`,
                      texto: cons.estado === 'firmado' ? '✅ Ver firmado'
                        : cons.estado === 'anulado' ? '⛔ Anulado' : '✍️ Firmar ahora',
                    })
                  : puedeClinico
                    ? el('button', {
                        clase: 'btn sec chico', type: 'button', texto: 'Preparar el consentimiento',
                        onclick: async () => {
                          try {
                            const c = await api.generarConsentimiento(t.id);
                            navegar(`#/consentimiento/${c.id}`);
                          } catch (e) { error(e instanceof ErrorApi ? e.message : 'No se pudo generar.'); }
                        },
                      })
                    : el('span', { clase: 'mini', texto: 'No requiere' }),
              ]),
            ]);
          })),
        ])])
      : vacio(cita.catalogo_nombre
          ? `Todavía no se ha anotado nada. Al agendar quedó previsto: "${cita.catalogo_nombre}".`
          : 'Todavía no se ha anotado nada en esta cita.'),
  ]);

  const seccionFotos = el('div', { clase: 'tarjeta' }, [
    el('h3', {}, [
      el('span', { texto: `🖼️ Radiografías y fotos (${cita.fotos.length})` }),
      activa
        ? el('button', { clase: 'btn chico', type: 'button', texto: '➕ Subir radiografías o fotos', style: 'margin-left:auto', onclick: abrirFotos })
        : null,
    ]),
    cita.fotos.length
      ? el('div', { clase: 'galeria' }, cita.fotos.map((f) => el('figure', {}, [
          el('img', {
            src: urlFoto(f), alt: f.nombre, loading: 'lazy',
            onclick: () => modal({
              titulo: f.nombre, ancho: true,
              cuerpo: el('img', { src: urlFoto(f), alt: f.nombre, style: 'width:100%;border-radius:10px' }),
            }),
          }),
          el('figcaption', {}, [el('b', { texto: f.nombre }), el('span', { texto: `${f.tipo} · ${fmtFechaCorta(f.creada_en)}` })]),
        ])))
      : vacio('Sin imágenes cargadas en esta cita.'),
  ]);

  const seccionRecordatorios = el('div', { clase: 'tarjeta' }, [
    el('h3', {}, [
      el('span', { texto: '🔔 Recordatorios creados en la cita' }),
      activa
        ? el('button', { clase: 'btn chico', type: 'button', texto: '➕ Nuevo', style: 'margin-left:auto', onclick: abrirRecordatorio })
        : null,
    ]),
    cita.recordatorios.length
      ? el('ul', { clase: 'lista-simple' }, cita.recordatorios.map((r) => el('li', {}, [
          el('div', {}, [
            el('div', { clase: 'tit', texto: r.titulo }),
            el('div', { clase: 'det', texto: r.descripcion || '' }),
            el('div', { clase: 'mini', texto: r.fecha_objetivo ? `Objetivo: ${fmtFechaCorta(r.fecha_objetivo)}` : 'Sin fecha objetivo' }),
          ]),
          el('div', { clase: 'acciones' }, [
            el('span', { clase: `eti ${r.prioridad}`, texto: r.prioridad }),
            el('span', { clase: `eti ${r.estado}`, texto: r.estado }),
          ]),
        ])))
      : vacio('Sin recordatorios en esta cita.'),
  ]);

  const seccionSeguimiento = el('div', { clase: 'tarjeta' }, [
    el('h3', {}, [
      el('span', { texto: '📅 Próxima cita derivada de este tratamiento' }),
      activa
        ? el('button', {
            clase: 'btn chico', type: 'button', texto: '➕ Agendar seguimiento', style: 'margin-left:auto',
            onclick: () => abrirFormularioCita({
              titulo: `Próxima cita de ${nombreCompleto(cita.paciente_nombre, cita.paciente_apellidos)}`,
              paciente_id: cita.paciente_id,
              consultorio_id: cita.consultorio_id,
              cubiculo_id: cita.cubiculo_id,
              doctor_id: cita.doctor_id,
              cita_origen_id: cita.id,
              fecha: cita.inicio.slice(0, 10),
              motivo: `Seguimiento de ${cita.tratamientos[0]?.nombre || cita.motivo || 'tratamiento'}`,
              alGuardar: () => refrescar(),
            }),
          })
        : null,
    ]),
    cita.cita_seguimiento.length
      ? el('ul', { clase: 'lista-simple' }, cita.cita_seguimiento.map((c) => el('li', {}, [
          el('div', {}, [
            el('div', { clase: 'tit', texto: fmtFechaHora(c.inicio) }),
            el('div', { clase: 'det', texto: c.motivo || 'Sin motivo' }),
            el('div', { clase: 'mini', texto: `${c.doctor_nombre} · ${c.consultorio_nombre} · ${c.cubiculo_nombre}` }),
          ]),
          el('div', { clase: 'acciones' }, [
            etiquetaEstado(c.estado),
            el('a', { clase: 'btn sec chico', href: `#/cita/${c.id}`, texto: 'Abrir' }),
          ]),
        ])))
      : vacio('No se ha agendado una cita de seguimiento desde esta cita.'),
  ]);

  const totalCargos = cargosConSaldo.reduce((s, c) => s + c.monto, 0);
  const totalPagado = cargosConSaldo.reduce((s, c) => s + c.pagado, 0);

  const seccionCobros = el('div', { clase: 'tarjeta' }, [
    el('h3', {}, [
      el('span', { texto: '💰 Cobros de esta cita' }),
      puedeCobrar
        ? el('button', { clase: 'btn chico', type: 'button', texto: '➕ Registrar pago', style: 'margin-left:auto', onclick: () => abrirCobro(null) })
        : null,
    ]),
    cargosConSaldo.length
      ? el('div', {}, [
          el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
            el('thead', {}, [el('tr', {}, ['Por qué', 'Cuánto', 'Ya pagó', 'Le falta', ''].map((t) => el('th', { texto: t })))]),
            el('tbody', {}, cargosConSaldo.map((c) => el('tr', {}, [
              el('td', { texto: c.concepto }),
              el('td', { clase: 'num', texto: fmtDinero(c.monto) }),
              el('td', { clase: 'num', texto: fmtDinero(c.pagado) }),
              el('td', { clase: 'num', texto: fmtDinero(c.saldo) }),
              // Deber dinero y no poder cobrarlo son cosas distintas: mostrar
              // «pagado» a quien no cobra hacía que una deuda pareciera saldada.
              el('td', {}, [
                c.saldo <= 0
                  ? el('span', { clase: 'eti firmado', texto: 'Pagado' })
                  : puedeCobrar
                    ? el('button', { clase: 'btn chico', type: 'button', texto: 'Cobrar', onclick: () => abrirCobro(c) })
                    : el('span', { clase: 'eti pendiente', texto: `Debe ${fmtDinero(c.saldo)}` }),
              ]),
            ]))),
          ])]),
          el('div', { clase: 'mini', style: 'margin-top:8px', texto: `En total ${fmtDinero(totalCargos)} · ya pagó ${fmtDinero(totalPagado)} · le falta ${fmtDinero(totalCargos - totalPagado)}` }),
        ])
      : vacio('Todavía no hay nada que cobrar en esta cita.'),
  ]);

  /* -------------------------------- Marco -------------------------------- */
  return el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: `Cita de ${nombreCompleto(cita.paciente_nombre, cita.paciente_apellidos)}` }),
        el('div', { clase: 'desc', texto: `${fmtFechaHora(cita.inicio)} – ${cita.fin.slice(11)} · ${cita.doctor_nombre} · ${cita.consultorio_nombre} / ${cita.cubiculo_nombre}` }),
      ]),
      el('div', { clase: 'acciones' }, [
        el('a', { clase: 'btn sec', href: '#/agenda', texto: '← Agenda' }),
        el('a', { clase: 'btn sec', href: `#/paciente/${cita.paciente_id}`, texto: '📋 Expediente' }),
        el('a', { clase: 'btn sec', href: `#/imprimir/cita/${cita.id}`, texto: '🖨️ Imprimir' }),
        activa && cita.estado !== 'completada'
          ? el('button', {
              clase: 'btn sec', type: 'button', texto: '🕑 Reprogramar',
              onclick: () => abrirFormularioCita({ cita, alGuardar: refrescar }),
            })
          : null,
      ]),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: '¿Cómo va esta cita?' }),
      el('div', { clase: 'acciones', style: 'align-items:center' }, [
        etiquetaEstado(cita.estado),
        el('span', { clase: 'mini', texto: `Viene por: ${cita.motivo || 'sin motivo anotado'}` }),
      ]),
      cita.catalogo_nombre
        ? el('p', { clase: 'mini', style: 'margin-top:10px' }, [
            document.createTextNode('Tratamiento previsto: '),
            el('b', { texto: cita.catalogo_nombre }),
            document.createTextNode(` · ${cita.catalogo_duracion_min} min · ${fmtDinero(cita.catalogo_precio)} · `),
            cita.catalogo_requiere_consentimiento
              ? el('span', { clase: 'eti pendiente', style: 'margin-left:8px', texto: 'requiere consentimiento' })
              : null,
          ])
        : null,
      SIGUIENTES[cita.estado].length
        ? el('div', { style: 'margin-top:12px' }, [
            el('div', { clase: 'mini', style: 'margin-bottom:6px', texto: 'Pasarla a:' }),
            accionesEstado,
          ])
        : el('p', { clase: 'mini', style: 'margin-top:10px', texto: 'Esta cita ya se cerró: no se puede cambiar más.' }),
      cita.notas ? el('p', { clase: 'mini', style: 'margin-top:10px', texto: `Notas: ${cita.notas}` }) : null,
      cita.cita_origen_id
        ? el('p', { clase: 'mini', style: 'margin-top:6px' }, [
            document.createTextNode('Cita de seguimiento derivada de la '),
            el('a', { href: `#/cita/${cita.cita_origen_id}`, texto: `cita #${cita.cita_origen_id}` }),
          ])
        : null,
    ]),

    !activa
      ? el('div', { clase: 'alerta-caja aviso', texto: `Esta cita está en estado "${ETIQUETAS_ESTADO[cita.estado]}": no admite registro clínico. Reactívala para volver a trabajar en ella.` })
      : null,

    consentPendientes.length
      ? el('div', { clase: 'alerta-caja' }, [
          el('b', { texto: '⚠️ Consentimiento informado sin firmar. ' }),
          el('span', { texto: `La cita no se puede cerrar hasta firmar ${plural(consentPendientes.length, 'documento', 'documentos')}.` }),
          el('div', { clase: 'acciones', style: 'margin-top:8px' }, consentPendientes.map((c) =>
            el('a', { clase: 'btn chico', href: `#/consentimiento/${c.id}`, texto: `✍️ Firmar: ${c.tratamiento}` }))),
        ])
      : null,

    seccionTratamientos,
    el('div', { clase: 'rejilla c2' }, [seccionFotos, seccionRecordatorios]),
    seccionSeguimiento,
    seccionCobros,
  ]);
}
