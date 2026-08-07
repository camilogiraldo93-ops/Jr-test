import { api, ErrorApi } from '../api.js';
import { el, modal, campo, entrada, area, selector, exito, error, hoyIso, sumarMinutos, fmtFechaHora } from '../ui.js';

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
    cita_origen_id = null,
    titulo = null,
    alGuardar = null,
  } = opciones;

  const [consultorios, doctores, pacientes] = await Promise.all([
    api.consultorios(), api.doctores(), api.pacientes(),
  ]);

  if (!consultorios.length) {
    error('Primero debes crear al menos un consultorio con un cubículo en Configuración.');
    return;
  }
  if (!pacientes.length) {
    error('No hay pacientes registrados. Crea primero el paciente.');
    return;
  }

  const inicial = {
    consultorio_id: cita?.consultorio_id ?? consultorio_id ?? consultorios[0].id,
    cubiculo_id: cita?.cubiculo_id ?? cubiculo_id ?? null,
    doctor_id: cita?.doctor_id ?? doctor_id ?? null,
    paciente_id: cita?.paciente_id ?? paciente_id ?? pacientes[0].id,
    fecha: cita ? cita.inicio.slice(0, 10) : fecha,
    hora_inicio: cita ? cita.inicio.slice(11, 16) : hora,
    hora_fin: cita ? cita.fin.slice(11, 16) : sumarMinutos(hora, duracion),
    motivo: cita?.motivo ?? motivo,
    notas: cita?.notas ?? '',
  };

  const selConsultorio = selector('consultorio_id',
    consultorios.map((c) => ({ valor: c.id, texto: c.nombre })), inicial.consultorio_id);
  const selCubiculo = selector('cubiculo_id', [], null);
  const selDoctor = selector('doctor_id', [], null);
  const selPaciente = selector('paciente_id',
    pacientes.map((p) => ({ valor: p.id, texto: `${p.apellidos}, ${p.nombre}${p.cedula ? ` (${p.cedula})` : ''}` })),
    inicial.paciente_id);

  const inFecha = entrada('fecha', { type: 'date', value: inicial.fecha, required: true });
  const inInicio = entrada('hora_inicio', { type: 'time', value: inicial.hora_inicio, required: true, step: 300 });
  const inFin = entrada('hora_fin', { type: 'time', value: inicial.hora_fin, required: true, step: 300 });
  const inMotivo = entrada('motivo', { value: inicial.motivo, placeholder: 'Ej.: Control y profilaxis' });
  const inNotas = area('notas', { value: inicial.notas, placeholder: 'Notas para el equipo (opcional)' });

  const avisoConflicto = el('div', { clase: 'alerta-caja', style: 'display:none' });

  function refrescarCubiculos() {
    const cid = Number(selConsultorio.value);
    const cons = consultorios.find((c) => c.id === cid);
    const lista = (cons?.cubiculos || []).filter((c) => c.activo);
    selCubiculo.innerHTML = '';
    if (!lista.length) {
      selCubiculo.appendChild(el('option', { value: '', texto: 'Sin cubículos disponibles' }));
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
      selDoctor.appendChild(el('option', { value: '', texto: 'Ningún doctor asignado a este consultorio' }));
    }
    for (const d of lista) {
      const op = el('option', { value: String(d.id), texto: `${d.nombre} — ${d.especialidad || 'General'}` });
      if (Number(inicial.doctor_id) === d.id) op.selected = true;
      selDoctor.appendChild(op);
    }
  }

  selConsultorio.addEventListener('change', () => {
    inicial.cubiculo_id = null;
    inicial.doctor_id = null;
    refrescarCubiculos();
    verificar();
  });
  refrescarCubiculos();

  inInicio.addEventListener('change', () => {
    if (inFin.value <= inInicio.value) inFin.value = sumarMinutos(inInicio.value, duracion);
    verificar();
  });
  [selCubiculo, selDoctor, inFecha, inFin].forEach((c) => c.addEventListener('change', verificar));

  function mostrarConflictos(conflictos, mensaje) {
    if (!conflictos.length) {
      avisoConflicto.className = 'alerta-caja ok';
      avisoConflicto.textContent = '✅ Horario disponible: ni el cubículo ni el doctor tienen otra cita en ese rango.';
      avisoConflicto.style.display = 'block';
      return;
    }
    avisoConflicto.className = 'alerta-caja';
    avisoConflicto.innerHTML = '';
    avisoConflicto.appendChild(el('b', { texto: '⛔ Conflicto de agenda — no se puede guardar' }));
    avisoConflicto.appendChild(el('ul', {}, conflictos.map((c) => {
      const quien = c.motivo === 'doctor' ? 'El doctor'
        : c.motivo === 'cubiculo' ? 'El cubículo' : 'El cubículo y el doctor';
      const verbo = c.motivo === 'cubiculo_y_doctor' ? 'ya tienen' : 'ya tiene';
      return el('li', {
        texto: `${quien} ${verbo} la cita #${c.cita_id} de ${c.paciente} ` +
          `(${fmtFechaHora(c.inicio)} – ${c.fin.slice(11)}), estado ${c.estado}.`,
      });
    })));
    if (mensaje) avisoConflicto.appendChild(el('div', { clase: 'mini', style: 'margin-top:6px', texto: mensaje }));
    avisoConflicto.style.display = 'block';
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
      mostrarConflictos(r.conflictos, '');
    } catch (e) {
      ultimaVerificacion = { disponible: false };
      avisoConflicto.className = 'alerta-caja aviso';
      avisoConflicto.textContent = e instanceof ErrorApi ? e.message : 'No se pudo verificar la disponibilidad.';
      avisoConflicto.style.display = 'block';
    }
  }

  const botonGuardar = el('button', { clase: 'btn', type: 'submit', texto: cita ? 'Guardar cambios' : 'Agendar cita' });

  const form = el('form', {}, [
    avisoConflicto,
    campo('Paciente', selPaciente),
    el('div', { clase: 'fila' }, [
      campo('Consultorio (sede)', selConsultorio),
      campo('Cubículo', selCubiculo),
    ]),
    campo('Doctor', selDoctor, 'Solo se listan los doctores asignados al consultorio seleccionado.'),
    el('div', { clase: 'fila' }, [
      campo('Fecha', inFecha),
      campo('Hora de inicio', inInicio),
      campo('Hora de fin', inFin),
    ]),
    campo('Motivo de la cita', inMotivo),
    campo('Notas', inNotas),
  ]);

  const m = modal({
    titulo: titulo || (cita ? `Reprogramar cita #${cita.id}` : 'Nueva cita'),
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selCubiculo.value) { error('Selecciona un cubículo válido.'); return; }
    if (!selDoctor.value) { error('Selecciona un doctor asignado a ese consultorio.'); return; }
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
    };
    if (cita_origen_id) datos.cita_origen_id = cita_origen_id;
    try {
      const guardada = cita
        ? await api.actualizarCita(cita.id, datos)
        : await api.crearCita(datos);
      m.cerrar();
      exito(cita ? 'Cita reprogramada correctamente.' : `Cita agendada para el ${inFecha.value} a las ${inInicio.value}.`);
      if (alGuardar) await alGuardar(guardada);
    } catch (err) {
      if (err instanceof ErrorApi && err.estado === 409 && err.detalle?.conflictos) {
        mostrarConflictos(err.detalle.conflictos, err.message);
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
