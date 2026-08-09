import { api, ErrorApi } from '../api.js';
import { el, limpiar, modal, campo, entrada, area, selector, exito, error, vacio,
  fmtMarca, fmtFechaCorta } from '../ui.js';
import { documentoConsentimiento, bloqueFirmas, pieDocumento, ETIQUETA_ESTADO_CONSENT } from '../consentimiento-doc.js';

/**
 * Lienzo de firma manuscrita. Funciona con dedo, lápiz digital y ratón
 * mediante pointer events, con el trazo escalado al tamaño real del canvas.
 */
export function lienzoFirma(etiqueta) {
  const canvas = el('canvas', { clase: 'firma-lienzo', width: 900, height: 260 });
  const ctx = canvas.getContext('2d');
  let dibujando = false;
  let hayTrazo = false;
  const oyentes = [];

  function fondo() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#14313d';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  fondo();

  const punto = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  };

  const iniciar = (e) => {
    e.preventDefault();
    dibujando = true;
    hayTrazo = true;
    canvas.classList.add('con-trazo');
    const p = punto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* algunos navegadores lo rechazan */ }
    }
  };
  const mover = (e) => {
    if (!dibujando) return;
    e.preventDefault();
    const p = punto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const terminar = () => { dibujando = false; };

  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  canvas.addEventListener('pointerleave', terminar);
  const global = () => terminar();
  window.addEventListener('pointerup', global);
  oyentes.push(() => window.removeEventListener('pointerup', global));

  const aviso = el('div', { clase: 'mini firma-aviso', texto: 'Aún sin firmar' });
  const botonLimpiar = el('button', {
    clase: 'btn sec chico', type: 'button', texto: 'Limpiar',
    onclick: () => {
      hayTrazo = false;
      canvas.classList.remove('con-trazo');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      fondo();
      aviso.textContent = 'Aún sin firmar';
      aviso.classList.remove('ok');
    },
  });
  const botonConfirmar = el('button', {
    clase: 'btn chico', type: 'button', texto: 'Confirmar firma',
    onclick: () => {
      if (!hayTrazo) { error(`Falta trazar la ${etiqueta.toLowerCase()} antes de confirmarla.`); return; }
      confirmada = true;
      aviso.textContent = '✅ Firma confirmada';
      aviso.classList.add('ok');
    },
  });

  let confirmada = false;

  const nodo = el('div', { clase: 'firma-campo' }, [
    el('div', { clase: 'firma-etiqueta', texto: etiqueta }),
    canvas,
    el('div', { clase: 'acciones', style: 'margin-top:8px;align-items:center' }, [
      botonLimpiar, botonConfirmar, aviso,
    ]),
  ]);

  return {
    nodo,
    get hayTrazo() { return hayTrazo; },
    get confirmada() { return confirmada; },
    datos: () => canvas.toDataURL('image/png'),
    destruir: () => oyentes.forEach((f) => f()),
  };
}

/* ------------------------------ Vista completa --------------------------- */

export async function vistaConsentimiento({ param, usuario, navegar, refrescar }) {
  const id = Number(param);
  if (!Number.isInteger(id)) return vacio('Consentimiento no válido.');

  const [c, catalogo, doctores] = await Promise.all([
    api.consentimiento(id),
    api.catalogo().catch(() => []),
    api.doctores().catch(() => []),
  ]);

  const puedeEditar = ['admin', 'doctor', 'recepcion'].includes(usuario.rol) && c.estado === 'pendiente';
  const puedeAnular = ['admin', 'doctor'].includes(usuario.rol) && c.estado === 'firmado';

  const contenedor = el('div', { clase: 'consent-vista' });

  // En modo tablet se oculta toda la interfaz, así que la salida necesita su propio
  // control flotante: si no, el documento queda sin manera de volver atrás.
  contenedor.appendChild(el('button', {
    clase: 'btn sec salir-tablet', type: 'button', texto: '✕ Salir del modo tablet',
    onclick: () => document.body.classList.remove('modo-tablet'),
  }));

  /* ------------------------------ Cabecera ------------------------------ */
  const etiquetaEstado = el('span', {
    clase: `eti ${c.estado === 'firmado' ? 'firmado' : c.estado === 'anulado' ? 'cancelado' : 'pendiente'}`,
    texto: ETIQUETA_ESTADO_CONSENT[c.estado],
  });

  contenedor.appendChild(el('div', { clase: 'cabecera sin-imprimir' }, [
    el('div', {}, [
      el('h2', { texto: 'Consentimiento informado' }),
      el('div', { clase: 'desc', texto: `${c.paciente_nombre} · ${c.tratamiento} · ${c.doctor_nombre}` }),
    ]),
    el('div', { clase: 'acciones' }, [
      etiquetaEstado,
      el('a', { clase: 'btn sec', href: `#/paciente/${c.paciente_id}`, texto: '📋 Expediente' }),
      c.cita_id ? el('a', { clase: 'btn sec', href: `#/cita/${c.cita_id}`, texto: '🗓️ Cita' }) : null,
      el('button', {
        clase: 'btn sec', type: 'button', texto: '🖥️ Modo tablet',
        title: 'Pantalla limpia para entregar la tablet al paciente',
        onclick: () => document.body.classList.toggle('modo-tablet'),
      }),
      el('a', { clase: 'btn sec', href: `#/imprimir/consentimiento/${c.id}`, texto: '🖨️ Imprimir / PDF' }),
    ]),
  ]));

  if (c.estado === 'anulado') {
    contenedor.appendChild(el('div', { clase: 'alerta-caja sin-imprimir' }, [
      el('b', { texto: '⛔ Consentimiento anulado. ' }),
      el('span', { texto: `${c.anulado_motivo || 'Sin motivo registrado'} — anulado por ${c.anulado_por || '—'} el ${fmtMarca(c.anulado_en)}.` }),
      c.reemplazado_por
        ? el('div', { style: 'margin-top:6px' }, [
            el('a', { href: `#/consentimiento/${c.reemplazado_por}`, texto: `Ver el consentimiento que lo reemplaza (#${c.reemplazado_por}) →` }),
          ])
        : null,
    ]));
  }
  if (c.reemplaza_a) {
    contenedor.appendChild(el('div', { clase: 'alerta-caja aviso sin-imprimir' }, [
      el('span', { texto: 'Este documento reemplaza a uno anulado. ' }),
      el('a', { href: `#/consentimiento/${c.reemplaza_a}`, texto: 'Ver el que reemplaza' }),
    ]));
  }
  if (c.es_menor) {
    contenedor.appendChild(el('div', { clase: 'alerta-caja aviso sin-imprimir', texto:
      `El paciente es menor de edad (nacido el ${fmtFechaCorta(c.paciente_fecha_nacimiento)}). ` +
      'La firma corresponde a su representante legal, cuyos datos son obligatorios.' }));
  }

  /* -------------------- Los tres campos que llena la clínica ------------- */
  if (puedeEditar) {
    const selCatalogo = selector('catalogo_id', [
      { valor: '', texto: '— Otro que escribo yo —' },
      ...catalogo.map((t) => ({ valor: t.id, texto: t.nombre })),
    ], c.catalogo_id ?? '');
    const inTratamiento = entrada('tratamiento', { value: c.tratamiento, required: true });
    const selDoctor = selector('doctor_id',
      doctores.map((d) => ({ valor: d.id, texto: `${d.nombre}${d.especialidad ? ` — ${d.especialidad}` : ''}` })),
      c.doctor_id);
    const inObservaciones = area('observaciones', {
      value: c.observaciones || '', placeholder: 'Opcional: aclaraciones, condiciones particulares del paciente…',
    });

    selCatalogo.addEventListener('change', () => {
      const t = catalogo.find((x) => String(x.id) === selCatalogo.value);
      if (t) inTratamiento.value = t.nombre;
    });

    const botonGuardar = el('button', { clase: 'btn sec', type: 'button', texto: '💾 Guardar cambios' });
    botonGuardar.addEventListener('click', async () => {
      botonGuardar.disabled = true;
      try {
        await api.actualizarConsentimiento(c.id, {
          tratamiento: inTratamiento.value.trim(),
          catalogo_id: selCatalogo.value ? Number(selCatalogo.value) : null,
          doctor_id: Number(selDoctor.value),
          observaciones: inObservaciones.value.trim(),
        });
        exito('Datos del consentimiento actualizados.');
        await refrescar();
      } catch (e) {
        error(e instanceof ErrorApi ? e.message : 'No se pudo guardar.');
      } finally { botonGuardar.disabled = false; }
    });

    contenedor.appendChild(el('div', { clase: 'tarjeta sin-imprimir' }, [
      el('h3', { texto: '✏️ Lo que hay que llenar' }),
      el('p', { clase: 'mini', style: 'margin-bottom:12px', texto:
        'Todo lo demás (paciente, cédula, consultorio, fecha y el texto legal) se completa automáticamente.' }),
      el('div', { clase: 'fila' }, [
        campo('¿Para qué tratamiento?', selCatalogo),
        campo('Tratamiento *', inTratamiento),
        campo('Doctor *', selDoctor),
      ]),
      campo('Observaciones', inObservaciones),
      el('div', { clase: 'acciones' }, [botonGuardar]),
    ]));
  }

  /* ------------------------------ Documento ----------------------------- */
  const hoja = el('div', { clase: 'hoja' }, [
    documentoConsentimiento(c),
  ]);

  /* -------------------------------- Firmas ------------------------------ */
  if (c.estado === 'firmado' || c.estado === 'anulado') {
    hoja.appendChild(bloqueFirmas(c));
    hoja.appendChild(pieDocumento(c));
    contenedor.appendChild(hoja);

    if (c.estado === 'firmado') {
      contenedor.appendChild(el('div', { clase: 'alerta-caja ok sin-imprimir', texto:
        `✅ Documento firmado el ${fmtMarca(c.firmado_en)} por ${c.firma_paciente_nombre} y ${c.doctor_nombre}. ` +
        'Ya no se puede cambiar. Si hay que corregir algo, se anula este y se hace uno nuevo, y queda constancia de los dos.' }));
    }
    if (puedeAnular) {
      contenedor.appendChild(el('div', { clase: 'acciones sin-imprimir' }, [
        el('button', {
          clase: 'btn peligro', type: 'button', texto: '⛔ Anular y hacer uno nuevo',
          onclick: () => abrirAnulacion(c, navegar),
        }),
      ]));
    }
    return contenedor;
  }

  /* --------------------------- Firma en pantalla ------------------------ */
  const menor = !!c.es_menor;
  const firmaPaciente = lienzoFirma(menor ? 'Firma del representante legal' : 'Firma del paciente');
  const firmaDoctor = lienzoFirma('Firma del doctor');

  const inFirmante = entrada('firma_paciente_nombre', {
    value: menor ? '' : c.paciente_nombre,
    placeholder: 'Nombre de quien firma', required: true,
  });
  const inRepCedula = entrada('representante_cedula', { placeholder: 'Cédula del representante' });
  const inRepParentesco = selector('representante_parentesco', [
    { valor: 'madre', texto: 'Madre' }, { valor: 'padre', texto: 'Padre' },
    { valor: 'tutor legal', texto: 'Tutor legal' }, { valor: 'abuelo/a', texto: 'Abuelo/a' },
    { valor: 'otro', texto: 'Otro' },
  ], 'madre');

  const camposRepresentante = menor
    ? el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: '👤 Representante legal (paciente menor de edad)' }),
        el('div', { clase: 'fila' }, [
          campo('Nombre completo *', inFirmante),
          campo('Cédula *', inRepCedula),
          campo('Parentesco *', inRepParentesco),
        ]),
      ])
    : el('div', { clase: 'campo', style: 'max-width:420px' }, [
        el('label', { texto: 'Nombre de quien firma' }),
        inFirmante,
      ]);

  const botonFirmar = el('button', { clase: 'btn exito', type: 'button', texto: '✍️ Firmar y archivar' });

  botonFirmar.addEventListener('click', async () => {
    if (!firmaPaciente.hayTrazo) {
      error(menor ? 'Falta la firma del representante legal.' : 'Falta la firma del paciente.');
      return;
    }
    if (!firmaDoctor.hayTrazo) { error('Falta la firma del doctor.'); return; }
    if (!inFirmante.value.trim()) { error('Indica el nombre de quien firma.'); return; }
    if (menor && (!inRepCedula.value.trim())) { error('La cédula del representante legal es obligatoria.'); return; }

    botonFirmar.disabled = true;
    botonFirmar.textContent = 'Guardando…';
    try {
      await api.firmarConsentimiento(c.id, {
        firma_paciente: firmaPaciente.datos(),
        firma_paciente_nombre: inFirmante.value.trim(),
        firma_doctor: firmaDoctor.datos(),
        representante_nombre: menor ? inFirmante.value.trim() : null,
        representante_cedula: menor ? inRepCedula.value.trim() : null,
        representante_parentesco: menor ? inRepParentesco.value : null,
      });
      document.body.classList.remove('modo-tablet');
      exito('Consentimiento firmado y archivado en el expediente.');
      await refrescar();
    } catch (e) {
      error(e instanceof ErrorApi ? e.message : 'No se pudo firmar el consentimiento.');
    } finally {
      botonFirmar.disabled = false;
      botonFirmar.textContent = '✍️ Firmar y archivar';
    }
  });

  hoja.appendChild(el('div', { clase: 'zona-firmas' }, [
    camposRepresentante,
    el('div', { clase: 'rejilla c2' }, [firmaPaciente.nodo, firmaDoctor.nodo]),
    pieDocumento(c),
    el('div', { clase: 'acciones', style: 'margin-top:14px' }, [botonFirmar]),
  ]));

  contenedor.appendChild(hoja);
  return contenedor;
}

/* ------------------------------- Anulación ------------------------------- */

function abrirAnulacion(c, navegar) {
  const inMotivo = area('motivo', { required: true, placeholder: 'Ej.: se corrigió el tratamiento acordado con el paciente' });
  const chkReemplazo = el('input', { type: 'checkbox', checked: true });
  const boton = el('button', { clase: 'btn peligro', type: 'button', texto: 'Anular' });

  const m = modal({
    titulo: 'Anular este consentimiento',
    cuerpo: el('div', {}, [
      el('div', { clase: 'alerta-caja aviso', texto:
        'El documento firmado no se borra: queda archivado como anulado, con motivo, responsable y fecha, ' +
        'para conservar la trazabilidad clínica.' }),
      campo('Motivo de la anulación *', inMotivo),
      el('label', { clase: 'campo', style: 'display:flex;gap:9px;align-items:center' }, [
        chkReemplazo, el('span', { texto: 'Generar un consentimiento nuevo con los mismos datos' }),
      ]),
    ]),
    pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
  });

  boton.addEventListener('click', async () => {
    if (!inMotivo.value.trim()) { error('Indica el motivo de la anulación.'); return; }
    boton.disabled = true;
    try {
      const r = await api.anularConsentimiento(c.id, {
        motivo: inMotivo.value.trim(), crear_reemplazo: chkReemplazo.checked,
      });
      m.cerrar();
      exito(r.reemplazo ? 'Consentimiento anulado; se generó el reemplazo.' : 'Consentimiento anulado.');
      navegar(r.reemplazo ? `#/consentimiento/${r.reemplazo.id}` : `#/consentimiento/${c.id}`);
    } catch (e) {
      error(e instanceof ErrorApi ? e.message : 'No se pudo anular.');
    } finally { boton.disabled = false; }
  });
}

/* ------------------- Creación manual desde el expediente ----------------- */

export async function abrirNuevoConsentimiento({ paciente_id, cita_id = null, consultorio_id = null, navegar }) {
  const [catalogo, doctores] = await Promise.all([api.catalogo(), api.doctores()]);
  if (!doctores.length) { error('No hay doctores registrados.'); return; }

  const selCatalogo = selector('catalogo_id', [
    { valor: '', texto: '— Otro que escribo yo —' },
    ...catalogo.map((t) => ({ valor: t.id, texto: t.nombre })),
  ], '');
  const inTratamiento = entrada('tratamiento', { required: true, placeholder: 'Ej.: Extracción de tercer molar' });
  const selDoctor = selector('doctor_id',
    doctores.map((d) => ({ valor: d.id, texto: `${d.nombre}${d.especialidad ? ` — ${d.especialidad}` : ''}` })),
    doctores[0].id);
  const inObservaciones = area('observaciones', { placeholder: 'Opcional' });

  selCatalogo.addEventListener('change', () => {
    const t = catalogo.find((x) => String(x.id) === selCatalogo.value);
    if (t) inTratamiento.value = t.nombre;
  });

  const boton = el('button', { clase: 'btn', type: 'button', texto: 'Generar consentimiento' });
  const m = modal({
    titulo: 'Nuevo consentimiento informado',
    cuerpo: el('div', {}, [
      el('p', { clase: 'mini', style: 'margin-bottom:12px', texto:
        'Solo estos tres campos: el resto del documento se completa solo con los datos del paciente y del consultorio.' }),
      campo('Tratamiento del catálogo', selCatalogo),
      campo('Tratamiento *', inTratamiento),
      campo('Doctor *', selDoctor),
      campo('Observaciones', inObservaciones),
    ]),
    pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
  });

  boton.addEventListener('click', async () => {
    if (!inTratamiento.value.trim()) { error('Indica el tratamiento.'); return; }
    boton.disabled = true;
    try {
      const nuevo = await api.crearConsentimiento({
        paciente_id, cita_id, consultorio_id,
        tratamiento: inTratamiento.value.trim(),
        catalogo_id: selCatalogo.value ? Number(selCatalogo.value) : null,
        doctor_id: Number(selDoctor.value),
        observaciones: inObservaciones.value.trim(),
      });
      m.cerrar();
      exito('Consentimiento generado. Complétalo y fírmalo.');
      navegar(`#/consentimiento/${nuevo.id}`);
    } catch (e) {
      error(e instanceof ErrorApi ? e.message : 'No se pudo generar el consentimiento.');
    } finally { boton.disabled = false; }
  });
}
