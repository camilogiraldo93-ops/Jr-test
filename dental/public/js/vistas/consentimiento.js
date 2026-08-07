import { api, ErrorApi } from '../api.js';
import { el, modal, campo, entrada, exito, error, fmtMarca } from '../ui.js';

/** Lienzo de firma digital con soporte de ratón y táctil (tablet). */
function lienzoFirma() {
  const canvas = el('canvas', { clase: 'firma-lienzo', width: 700, height: 190 });
  const ctx = canvas.getContext('2d');
  let dibujando = false;
  let hayTrazo = false;

  function fondo() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#14313d';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  fondo();

  const punto = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (canvas.width / r.width),
      y: (t.clientY - r.top) * (canvas.height / r.height),
    };
  };

  const iniciar = (e) => {
    e.preventDefault();
    dibujando = true;
    hayTrazo = true;
    const pt = punto(e);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };
  const mover = (e) => {
    if (!dibujando) return;
    e.preventDefault();
    const pt = punto(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };
  const terminar = () => { dibujando = false; };

  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', terminar);
  canvas.addEventListener('touchstart', iniciar, { passive: false });
  canvas.addEventListener('touchmove', mover, { passive: false });
  canvas.addEventListener('touchend', terminar);

  return {
    canvas,
    limpiar: () => { hayTrazo = false; ctx.clearRect(0, 0, canvas.width, canvas.height); fondo(); },
    get hayTrazo() { return hayTrazo; },
    datos: () => canvas.toDataURL('image/png'),
  };
}

function documento(c) {
  return el('div', { clase: 'consent-texto' }, [
    el('h4', { texto: 'Tratamiento propuesto' }),
    el('p', { texto: c.titulo }),
    el('h4', { texto: 'Descripción del procedimiento' }),
    el('p', { texto: c.descripcion }),
    el('h4', { texto: 'Riesgos y complicaciones posibles' }),
    el('p', { texto: c.riesgos }),
    el('h4', { texto: 'Alternativas de tratamiento' }),
    el('p', { texto: c.alternativas }),
    el('h4', { texto: 'Declaración del paciente' }),
    el('p', {
      texto: `Yo, ${c.nombre_paciente}, declaro que he sido informado/a por el/la profesional ${c.nombre_doctor} ` +
        'sobre el procedimiento descrito, sus riesgos, beneficios y alternativas. He podido hacer preguntas ' +
        'y han sido respondidas satisfactoriamente. Autorizo la realización del tratamiento.',
    }),
    el('h4', { texto: 'Datos del documento' }),
    el('p', { clase: 'mini', texto: `Paciente: ${c.nombre_paciente} · Doctor: ${c.nombre_doctor} · Generado: ${fmtMarca(c.creado_en)}` }),
  ]);
}

/** Abre el consentimiento informado; permite firmarlo si está pendiente. */
export async function verConsentimiento(id, { alFirmar, puedeFirmar = true } = {}) {
  let c;
  try {
    c = await api.consentimiento(id);
  } catch (e) {
    error(e instanceof ErrorApi ? e.message : 'No se pudo cargar el consentimiento.');
    return;
  }

  if (c.estado === 'firmado') {
    modal({
      titulo: `Consentimiento firmado — ${c.titulo}`,
      ancho: true,
      cuerpo: el('div', {}, [
        el('div', { clase: 'alerta-caja ok', texto: `✅ Firmado por ${c.firmante} el ${fmtMarca(c.firmado_en)} (${c.firma_tipo === 'trazo' ? 'firma digital en pantalla' : 'aceptación explícita'}).` }),
        documento(c),
        c.firma_tipo === 'trazo' && c.firma_data?.startsWith('data:image')
          ? el('div', { style: 'margin-top:14px' }, [
              el('div', { clase: 'mini', texto: 'Firma del paciente:' }),
              el('img', { src: c.firma_data, alt: 'Firma del paciente', style: 'max-width:100%;border:1px solid var(--borde);border-radius:10px;background:#fff' }),
            ])
          : el('p', { clase: 'mini', style: 'margin-top:12px', texto: 'Aceptación registrada sin trazo gráfico.' }),
      ]),
    });
    return;
  }

  const firma = lienzoFirma();
  const inFirmante = entrada('firmante', { value: c.nombre_paciente, required: true });
  const chkAcepta = el('input', { type: 'checkbox', id: 'acepta_consent' });
  const cuerpo = el('div', {}, [
    documento(c),
    el('div', { style: 'margin-top:16px' }, [
      campo('Nombre de quien firma', inFirmante, 'Paciente o representante legal si es menor de edad.'),
      el('label', { clase: 'campo', style: 'display:flex;gap:9px;align-items:flex-start' }, [
        chkAcepta,
        el('span', { texto: 'El paciente declara haber leído y comprendido la información y acepta el tratamiento.' }),
      ]),
      el('div', { clase: 'campo' }, [
        el('label', { texto: 'Firma del paciente (dibuja en el recuadro)' }),
        firma.canvas,
        el('div', { clase: 'acciones', style: 'margin-top:8px' }, [
          el('button', { clase: 'btn sec chico', type: 'button', texto: 'Borrar firma', onclick: () => firma.limpiar() }),
        ]),
      ]),
    ]),
  ]);

  const botonFirmar = el('button', { clase: 'btn exito', type: 'button', texto: '✍️ Firmar y archivar' });
  const m = modal({
    titulo: `Consentimiento informado — ${c.titulo}`,
    ancho: true,
    cuerpo,
    pie: puedeFirmar
      ? [el('button', { clase: 'btn sec', type: 'button', texto: 'Cerrar', onclick: () => m.cerrar() }), botonFirmar]
      : [el('button', { clase: 'btn sec', type: 'button', texto: 'Cerrar', onclick: () => m.cerrar() })],
  });

  botonFirmar.addEventListener('click', async () => {
    if (!inFirmante.value.trim()) { error('Indica el nombre de quien firma.'); return; }
    if (!chkAcepta.checked) { error('El paciente debe marcar la aceptación del consentimiento.'); return; }
    const conTrazo = firma.hayTrazo;
    botonFirmar.disabled = true;
    botonFirmar.textContent = 'Guardando…';
    try {
      await api.firmarConsentimiento(c.id, conTrazo
        ? { firma_tipo: 'trazo', firma_data: firma.datos(), firmante: inFirmante.value.trim(), acepta: true }
        : { firma_tipo: 'aceptacion', acepta: true, firmante: inFirmante.value.trim() });
      m.cerrar();
      exito('Consentimiento firmado y archivado en el expediente.');
      if (alFirmar) await alFirmar();
    } catch (e) {
      error(e instanceof ErrorApi ? e.message : 'No se pudo firmar el consentimiento.');
    } finally {
      botonFirmar.disabled = false;
      botonFirmar.textContent = '✍️ Firmar y archivar';
    }
  });
}
