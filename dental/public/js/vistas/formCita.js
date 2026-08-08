import { api, ErrorApi, sesion } from '../api.js';
import { el, modal, campo, entrada, area, selector, exito, error, hoyIso, sumarMinutos,
  fmtFechaHora, fmtDinero, nombreLista, formularioCompleto } from '../ui.js';
import { recordarHabituales } from '../preferencias.js';

/**
 * Modal reutilizable para crear o reprogramar una cita.
 * Valida conflictos contra el servidor antes y durante el guardado.
 */
export async function abrirFormularioCita(opciones = {}) {
  const {
    cita = null,                 // cita existente → reprogramar
    paciente_id = null,
    consultorio_id = null,
    cubiculo_id = null,
    doctor_id = null,
    fecha = hoyIso(),
    hora = '09:00',
    duracion = 30,
    motivo = '',
    catalogo_id = null,
    cita_origen_id = null,
    titulo = null,
    alGuardar = null,
  } = opciones;

  const [consultorios, doctores, pacientes, catalogo] = await Promise.all([
    api.consultorios(), api.doctores(), api.pacientes(), api.catalogo(),
  ]);

  // Un doctor agenda para sí mismo casi siempre; y una cita a nombre de otro
  // doctor él no puede ni abrirla, así que arrancar en el primero de la lista
  // le fabricaba citas inaccesibles.
  const doctorPropio = sesion.usuario?.rol === 'doctor' ? sesion.usuario.doctor_id : null;

  if (!consultorios.length) {
    error('Antes hay que crear un consultorio con al menos un cubículo, en Configuración.');
    return;
  }
  if (!pacientes.length) {
    error('Todavía no hay pacientes. Crea primero al paciente en la sección Pacientes.');
    return;
  }

  const consultorioDelDoctor = doctorPropio
    ? doctores.find((d) => d.id === doctorPropio)?.consultorios?.[0]?.id ?? null
    : null;

  const inicial = {
    consultorio_id: cita?.consultorio_id ?? consultorio_id ?? consultorioDelDoctor ?? consultorios[0].id,
    cubiculo_id: cita?.cubiculo_id ?? cubiculo_id ?? null,
    doctor_id: cita?.doctor_id ?? doctor_id ?? doctorPropio ?? null,
    // Sin preselección: el primero de la lista alfabética no es «el paciente por
    // defecto», y pulsar Agendar sin mirar creaba citas a nombre de quien no era.
    paciente_id: cita?.paciente_id ?? paciente_id ?? '',
    fecha: cita ? cita.inicio.slice(0, 10) : fecha,
    hora_inicio: cita ? cita.inicio.slice(11, 16) : hora,
    hora_fin: cita ? cita.fin.slice(11, 16) : sumarMinutos(hora, duracion),
    motivo: cita?.motivo ?? motivo,
    notas: cita?.notas ?? '',
    catalogo_id: cita?.catalogo_id ?? catalogo_id ?? '',
  };

  const selConsultorio = selector('consultorio_id',
    consultorios.map((c) => ({ valor: c.id, texto: c.nombre })), inicial.consultorio_id);
  const selCubiculo = selector('cubiculo_id', [], null);
  const selDoctor = selector('doctor_id', [], null);
  const selPaciente = selector('paciente_id', [
    { valor: '', texto: '— Elige a la persona —' },
    ...pacientes.map((p) => ({
      valor: p.id,
      texto: `${nombreLista(p.nombre, p.apellidos)}${p.cedula ? ` (${p.cedula})` : ''}`,
    })),
  ], inicial.paciente_id, { required: true });

  const selTratamiento = selector('catalogo_id', [
    { valor: '', texto: '— Sin definir todavía —' },
    ...catalogo.map((c) => ({
      valor: c.id,
      texto: `${c.nombre} · ${c.duracion_min} min · ${fmtDinero(c.precio_base)}`,
    })),
  ], inicial.catalogo_id);
  const notaTratamiento = el('div', { clase: 'mini' });

  // El texto solo puede prometer lo que es cierto en cada caso: al reprogramar
  // vienen los de esa cita, no los de la última guardada.
  const ayudaPaciente = cita
    ? 'El cubículo y el doctor son los que ya tenía esta cita; cámbialos si hace falta.'
    : (inicial.cubiculo_id && inicial.doctor_id)
      ? 'Elige a la persona y pulsa Enter: el cubículo y el doctor son los de la última cita que guardaste.'
      : 'Elige a la persona, el cubículo y el doctor. La próxima vez esos dos vendrán ya puestos.';

  const inFecha = entrada('fecha', { type: 'date', value: inicial.fecha, required: true });
  const inInicio = entrada('hora_inicio', { type: 'time', value: inicial.hora_inicio, required: true, step: 300 });
  const inFin = entrada('hora_fin', { type: 'time', value: inicial.hora_fin, required: true, step: 300 });
  const inMotivo = entrada('motivo', { value: inicial.motivo, placeholder: 'Ej.: Control y profilaxis' });
  const inNotas = area('notas', { value: inicial.notas, placeholder: 'Notas para el equipo (opcional)' });

  const avisoConflicto = el('div', { clase: 'alerta-caja', style: 'display:none' });

  /**
   * El cubículo y el doctor se rellenan solos, pero únicamente cuando de verdad
   * hay un valor conocido: el de esta cita, el que venga por contexto o el de la
   * última que se guardó. Si no hay ninguno, el desplegable abre vacío y hay que
   * elegir. Dejarlo caer en el primero por orden alfabético agendaba con un
   * doctor que nadie escogió, y la cita ni siquiera aparecía en su agenda.
   */
  function refrescarCubiculos() {
    const cid = Number(selConsultorio.value);
    const cons = consultorios.find((c) => c.id === cid);
    const lista = (cons?.cubiculos || []).filter((c) => c.activo);
    selCubiculo.innerHTML = '';
    if (!lista.length) {
      selCubiculo.appendChild(el('option', { value: '', texto: 'Este consultorio no tiene cubículos activos' }));
    } else if (!lista.some((c) => Number(inicial.cubiculo_id) === c.id)) {
      selCubiculo.appendChild(el('option', { value: '', texto: '— Elige el cubículo —' }));
    }
    for (const c of lista) {
      const op = el('option', { value: String(c.id), texto: c.nombre });
      if (Number(inicial.cubiculo_id) === c.id) op.selected = true;
      selCubiculo.appendChild(op);
    }
    refrescarDoctores();
  }

  function refrescarDoctores() {
    const cid = Number(selConsultorio.value);
    const lista = doctores.filter((d) => d.activo && d.consultorios.some((c) => c.id === cid));
    selDoctor.innerHTML = '';
    if (!lista.length) {
      selDoctor.appendChild(el('option', { value: '', texto: 'Ningún doctor atiende en este consultorio' }));
    } else if (!lista.some((d) => Number(inicial.doctor_id) === d.id)) {
      selDoctor.appendChild(el('option', { value: '', texto: '— Elige el doctor —' }));
    }
    for (const d of lista) {
      const op = el('option', { value: String(d.id), texto: `${d.nombre} — ${d.especialidad || 'General'}` });
      if (Number(inicial.doctor_id) === d.id) op.selected = true;
      selDoctor.appendChild(op);
    }
  }

  /**
   * El tratamiento previsto ajusta la duración y sugiere el motivo. El motivo
   * solo se sobrescribe si está vacío o si lo puso una elección anterior: lo
   * que escribe una persona no se pisa.
   */
  let motivoSugerido = '';
  function aplicarTratamiento(ajustarHorario) {
    const cat = catalogo.find((c) => String(c.id) === selTratamiento.value) || null;
    notaTratamiento.className = 'mini';
    if (!cat) {
      notaTratamiento.textContent = 'Puedes agendar sin definirlo; se registra igual durante la atención.';
      return;
    }
    if (ajustarHorario && inInicio.value) inFin.value = sumarMinutos(inInicio.value, cat.duracion_min);
    if (!inMotivo.value.trim() || inMotivo.value === motivoSugerido) inMotivo.value = cat.nombre;
    motivoSugerido = cat.nombre;
    if (cat.requiere_consentimiento) {
      notaTratamiento.className = 'alerta-caja aviso';
      notaTratamiento.textContent = `⚠️ "${cat.nombre}" exige consentimiento informado: al registrarlo en la ` +
        'atención se generará el documento, y la cita no podrá completarse hasta que esté firmado.';
    } else {
      notaTratamiento.textContent = `Duración sugerida ${cat.duracion_min} min · precio base ${fmtDinero(cat.precio_base)}.`;
    }
  }

  selTratamiento.addEventListener('change', () => {
    aplicarTratamiento(true);
    verificar();
  });

  selConsultorio.addEventListener('change', () => {
    inicial.cubiculo_id = null;
    inicial.doctor_id = null;
    refrescarCubiculos();
    verificar();
  });
  refrescarCubiculos();
  aplicarTratamiento(false);

  inInicio.addEventListener('change', () => {
    if (inFin.value <= inInicio.value) inFin.value = sumarMinutos(inInicio.value, duracion);
    verificar();
  });
  [selCubiculo, selDoctor, inFecha, inFin].forEach((c) => c.addEventListener('change', verificar));

  function mostrarConflictos(conflictos) {
    if (!conflictos.length) {
      avisoConflicto.className = 'alerta-caja ok';
      avisoConflicto.textContent = '✅ Esa hora está libre: ni el cubículo ni el doctor tienen otra cita.';
      avisoConflicto.style.display = 'block';
      return;
    }
    avisoConflicto.className = 'alerta-caja';
    avisoConflicto.innerHTML = '';
    avisoConflicto.appendChild(el('b', { texto: '⛔ Esa hora ya está ocupada' }));
    avisoConflicto.appendChild(el('ul', {}, conflictos.map((c) => {
      const quien = c.motivo === 'doctor' ? 'El doctor'
        : c.motivo === 'cubiculo' ? 'El cubículo' : 'El cubículo y el doctor';
      const verbo = c.motivo === 'cubiculo_y_doctor' ? 'ya tienen' : 'ya tiene';
      return el('li', {
        texto: `${quien} ${verbo} cita con ${c.paciente} ` +
          `(${fmtFechaHora(c.inicio)} – ${c.fin.slice(11)}). Prueba después de las ${c.fin.slice(11)}.`,
      });
    })));
    // El servidor repite lo mismo con otras palabras: mostrar las dos versiones
    // solo confunde, así que el detalle largo se queda en el aviso emergente.
    avisoConflicto.style.display = 'block';
    // El aviso vive arriba del formulario y en pantallas bajas queda fuera de la
    // vista: no sirve de nada un mensaje que hay que ir a buscar.
    avisoConflicto.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  let ultimaVerificacion = { disponible: false };

  async function verificar() {
    if (!selCubiculo.value || !selDoctor.value || !inFecha.value || !inInicio.value || !inFin.value) {
      avisoConflicto.style.display = 'none';
      return;
    }
    if (inFin.value <= inInicio.value) {
      avisoConflicto.className = 'alerta-caja aviso';
      avisoConflicto.textContent = 'La hora de fin debe ser posterior a la hora de inicio.';
      avisoConflicto.style.display = 'block';
      ultimaVerificacion = { disponible: false };
      return;
    }
    try {
      const r = await api.verificarDisponibilidad({
        cubiculo_id: Number(selCubiculo.value),
        doctor_id: Number(selDoctor.value),
        inicio: `${inFecha.value}T${inInicio.value}`,
        fin: `${inFecha.value}T${inFin.value}`,
        excluir_id: cita?.id ?? null,
      });
      ultimaVerificacion = r;
      mostrarConflictos(r.conflictos);
    } catch (e) {
      ultimaVerificacion = { disponible: false };
      avisoConflicto.className = 'alerta-caja aviso';
      avisoConflicto.textContent = e instanceof ErrorApi ? e.message : 'No se pudo verificar la disponibilidad.';
      avisoConflicto.style.display = 'block';
    }
  }

  const botonGuardar = el('button', { clase: 'btn', type: 'submit', texto: cita ? 'Guardar cambios' : 'Agendar cita' });

  // `novalidate`: los avisos los damos nosotros, en español y nombrando el
  // campo que falta, en vez del globo del navegador.
  const form = el('form', { novalidate: true }, [
    avisoConflicto,
    campo('¿Para quién es la cita?', selPaciente, ayudaPaciente),
    el('div', { clase: 'fila' }, [
      campo('Consultorio', selConsultorio),
      campo('Cubículo', selCubiculo),
    ]),
    campo('Doctor', selDoctor, 'Solo se listan los doctores asignados al consultorio seleccionado.'),
    el('div', { clase: 'fila' }, [
      campo('Fecha', inFecha),
      campo('Hora de inicio', inInicio),
      campo('Hora de fin', inFin),
    ]),
    campo('Tratamiento previsto', selTratamiento,
      'Ajusta la duración, sugiere el motivo y avisa si hará falta consentimiento informado.'),
    notaTratamiento,
    campo('Motivo de la cita', inMotivo),
    campo('Notas', inNotas),
  ]);

  const m = modal({
    titulo: titulo || (cita ? 'Cambiar la cita de hora o de día' : 'Nueva cita'),
    cuerpo: form,
    pie: [
      el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }),
      botonGuardar,
    ],
  });

  // El botón vive en el pie del modal, fuera del <form>: lo enlazamos a mano.
  botonGuardar.addEventListener('click', (e) => {
    e.preventDefault();
    form.requestSubmit();
  });

  // Con los valores de siempre ya puestos, elegir al paciente y pulsar Enter
  // basta para agendar. Enter dentro de un <select> no envía el formulario solo.
  selPaciente.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selPaciente.value) {
      error('Falta elegir a quién se le agenda la cita.', 'Falta un dato');
      selPaciente.focus();
      return;
    }
    if (!formularioCompleto(form)) return;
    if (!selCubiculo.value) { error('Falta elegir el cubículo donde se atiende.', 'Falta un dato'); selCubiculo.focus(); return; }
    if (!selDoctor.value) { error('Falta elegir el doctor que va a atender.', 'Falta un dato'); selDoctor.focus(); return; }
    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando…';
    const datos = {
      consultorio_id: Number(selConsultorio.value),
      cubiculo_id: Number(selCubiculo.value),
      doctor_id: Number(selDoctor.value),
      paciente_id: Number(selPaciente.value),
      inicio: `${inFecha.value}T${inInicio.value}`,
      fin: `${inFecha.value}T${inFin.value}`,
      motivo: inMotivo.value,
      notas: inNotas.value,
      catalogo_id: selTratamiento.value ? Number(selTratamiento.value) : null,
    };
    if (cita_origen_id) datos.cita_origen_id = cita_origen_id;
    try {
      const guardada = cita
        ? await api.actualizarCita(cita.id, datos)
        : await api.crearCita(datos);
      // La próxima vez estos tres campos vienen puestos: son los de siempre.
      recordarHabituales({
        consultorio_id: datos.consultorio_id,
        cubiculo_id: datos.cubiculo_id,
        doctor_id: datos.doctor_id,
      });
      m.cerrar();
      exito(cita
        ? `Listo, la cita quedó cambiada al ${fmtFechaHora(guardada.inicio)}.`
        : `Listo, la cita quedó agendada para el ${fmtFechaHora(guardada.inicio)}.`);
      if (alGuardar) await alGuardar(guardada);
    } catch (err) {
      if (err instanceof ErrorApi && err.estado === 409 && err.detalle?.conflictos) {
        mostrarConflictos(err.detalle.conflictos);
        error('La cita no se guardó: hay un choque de horario.');
      } else {
        error(err instanceof ErrorApi ? err.message : 'No se pudo guardar la cita.');
      }
    } finally {
      botonGuardar.disabled = false;
      botonGuardar.textContent = cita ? 'Guardar cambios' : 'Agendar cita';
    }
  });

  await verificar();
  return m;
}
