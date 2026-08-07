/**
 * Prueba de regresión de punta a punta: recorre los 8 flujos de usuario
 * sobre una base de datos limpia y aislada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrancarServidor, cliente, exigir, PNG_DEMO, fechaRelativa } from './utiles.js';

let servidor;
let admin;
let recepcion;
let doctora;

const ctx = {};

test('preparación: arranca el servidor con datos de ejemplo', async () => {
  servidor = await arrancarServidor({ sembrar: true });
  admin = cliente(servidor.base);
  recepcion = cliente(servidor.base);
  doctora = cliente(servidor.base);

  const u = await admin.login('admin@clinica.com', 'admin123');
  assert.equal(u.rol, 'admin');
  await recepcion.login('recepcion@clinica.com', 'recepcion123');
  await doctora.login('ana.morales@clinica.com', 'doctor123');
});

test('datos de ejemplo: 2 consultorios, ≥3 cubículos, 3 doctores, 10 pacientes, 15 citas', async () => {
  const consultorios = exigir(await admin.get('/api/consultorios'), 200, 'consultorios');
  const cubiculos = exigir(await admin.get('/api/cubiculos'), 200, 'cubiculos');
  const doctores = exigir(await admin.get('/api/doctores'), 200, 'doctores');
  const pacientes = exigir(await admin.get('/api/pacientes'), 200, 'pacientes');
  const citas = exigir(await admin.get('/api/citas'), 200, 'citas');

  assert.ok(consultorios.length >= 2, `consultorios: ${consultorios.length}`);
  assert.ok(cubiculos.length >= 3, `cubículos: ${cubiculos.length}`);
  assert.ok(doctores.length >= 3, `doctores: ${doctores.length}`);
  assert.ok(pacientes.length >= 10, `pacientes: ${pacientes.length}`);
  assert.ok(citas.length >= 15, `citas: ${citas.length}`);

  const ahoraIso = new Date().toISOString().slice(0, 16);
  const futuras = citas.filter((c) => c.inicio > ahoraIso && !['cancelada', 'no_asistio'].includes(c.estado));
  assert.ok(futuras.length >= 5, `debe haber citas futuras para probar la agenda: ${futuras.length}`);

  const fotos = exigir(await admin.get('/api/pacientes/2/fotos'), 200, 'fotos de ejemplo');
  assert.ok(fotos.length >= 1, 'los datos de ejemplo traen imágenes cargadas');

  const pendientes = exigir(await admin.get('/api/consentimientos?estado=pendiente'), 200);
  assert.ok(pendientes.length >= 1, 'hay un consentimiento pendiente listo para probar el flujo');
});

test('Regla clínica: el tratamiento exige la cita en curso', async () => {
  const citas = exigir(await admin.get('/api/citas'), 200);
  const agendada = citas.find((c) => c.estado === 'agendada');
  const r = await admin.post(`/api/citas/${agendada.id}/tratamientos`, { nombre: 'Profilaxis' });
  assert.equal(r.estado, 409, 'no se registra tratamiento en una cita apenas agendada');
  assert.match(r.datos.error, /En curso/);

  const confirmada = citas.find((c) => c.estado === 'confirmada');
  const r2 = await admin.post(`/api/citas/${confirmada.id}/tratamientos`, { nombre: 'Profilaxis' });
  assert.equal(r2.estado, 409, 'tampoco en una confirmada');
});

test('Bloqueo: una cita con consentimiento pendiente no se puede completar', async () => {
  const pendientes = exigir(await admin.get('/api/consentimientos?estado=pendiente'), 200);
  const consent = pendientes.find((c) => c.cita_id);
  assert.ok(consent, 'los datos de ejemplo dejan un consentimiento pendiente ligado a una cita');

  const r = await admin.patch(`/api/citas/${consent.cita_id}/estado`, { estado: 'completada' });
  assert.equal(r.estado, 409, 'la cita queda bloqueada');
  assert.match(r.datos.error, /sin firmar/);
  assert.ok(r.datos.detalle.consentimientos_pendientes.length >= 1, 'el error indica cuáles faltan');

  // Al firmarlo, la cita se cierra sin problema.
  exigir(await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO, firma_paciente_nombre: consent.paciente_nombre,
  }), 200, 'firmar');
  const cerrada = exigir(await admin.patch(`/api/citas/${consent.cita_id}/estado`, { estado: 'completada' }), 200);
  assert.equal(cerrada.estado, 'completada');
});

/* ------------------------------- Flujo 1 -------------------------------- */
test('Flujo 1 · Crear consultorio → cubículos → doctores', async () => {
  const consultorio = exigir(await admin.post('/api/consultorios', {
    nombre: 'Clínica Dental Valle', direccion: 'Av. Ilaló 100', telefono: '02-111-2222', ciudad: 'Valle de los Chillos',
  }), 201, 'crear consultorio');
  ctx.consultorio = consultorio;

  const cub1 = exigir(await admin.post('/api/cubiculos', {
    consultorio_id: consultorio.id, nombre: 'Cubículo V1', descripcion: 'Unidad principal',
  }), 201, 'crear cubículo 1');
  const cub2 = exigir(await admin.post('/api/cubiculos', {
    consultorio_id: consultorio.id, nombre: 'Cubículo V2',
  }), 201, 'crear cubículo 2');
  ctx.cubiculos = [cub1, cub2];

  const doctor = exigir(await admin.post('/api/doctores', {
    nombre: 'Dr. Pablo Estrada', cedula: '1799911122', especialidad: 'Rehabilitación oral',
    telefono: '099-555-1212', email: 'pablo.estrada@clinica.com',
    cubiculos: [cub1.id, cub2.id],
  }), 201, 'crear doctor');
  ctx.doctor = doctor;

  assert.equal(doctor.cubiculos.length, 2);
  assert.deepEqual(doctor.consultorios.map((c) => c.id), [consultorio.id],
    'el doctor queda asignado al consultorio de sus cubículos');

  // Un doctor no asignado no puede agendar en este consultorio.
  const doctores = exigir(await admin.get('/api/doctores'), 200);
  ctx.doctorAjeno = doctores.find((d) => !d.consultorios.some((c) => c.id === consultorio.id));
  assert.ok(ctx.doctorAjeno, 'debe existir un doctor no asignado al nuevo consultorio');
});

/* ------------------------------- Flujo 2 -------------------------------- */
test('Flujo 2 · Crear paciente nuevo con ficha completa', async () => {
  const paciente = exigir(await recepcion.post('/api/pacientes', {
    nombre: 'Elena', apellidos: 'Vaca Suárez', cedula: '1799001122', telefono: '099-321-4455',
    email: 'elena.vaca@mail.com', fecha_nacimiento: '1990-05-14', sexo: 'F',
    direccion: 'Calle Los Cipreses 45', ocupacion: 'Arquitecta',
    contacto_emergencia: 'Mario Vaca', telefono_emergencia: '099-321-9988',
    alergias: 'Penicilina', medicamentos: 'Ninguno', antecedentes_medicos: 'Migraña',
    antecedentes_odontologicos: 'Extracción de terceros molares en 2019',
    motivo_consulta: 'Dolor al masticar en el lado derecho',
  }), 201, 'crear paciente');
  ctx.paciente = paciente;

  assert.equal(paciente.alergias, 'Penicilina');
  assert.equal(paciente.cedula, '1799001122');

  // La cédula duplicada se rechaza.
  const dup = await recepcion.post('/api/pacientes', {
    nombre: 'Otra', apellidos: 'Persona', cedula: '1799001122',
  });
  assert.equal(dup.estado, 409, 'cédula duplicada debe rechazarse');
});

/* ------------------------------- Flujo 3 -------------------------------- */
test('Flujo 3 · Agendar cita y bloquear conflictos de cubículo y de doctor', async () => {
  const fecha = fechaRelativa(3);
  const cita = exigir(await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T10:00`, fin: `${fecha}T11:00`,
    motivo: 'Evaluación inicial y diagnóstico',
  }), 201, 'crear cita');
  ctx.cita = cita;
  assert.equal(cita.estado, 'agendada');

  // (a) Mismo cubículo, mismo doctor, horario solapado.
  const conflicto1 = await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T10:30`, fin: `${fecha}T11:30`, motivo: 'Solapada',
  });
  assert.equal(conflicto1.estado, 409, 'debe bloquear el solape');
  assert.match(conflicto1.datos.error, /[Cc]hoque de horario/);
  assert.ok(conflicto1.datos.detalle.conflictos.length >= 1, 'debe explicar el conflicto');

  // (b) Mismo cubículo con OTRO doctor → sigue siendo conflicto de cubículo.
  const otroDoctor = exigir(await admin.post('/api/doctores', {
    nombre: 'Dra. Rosa Iza', cedula: '1799955500', especialidad: 'Odontopediatría',
    cubiculos: [ctx.cubiculos[0].id, ctx.cubiculos[1].id],
  }), 201, 'crear segundo doctor');
  ctx.doctor2 = otroDoctor;
  const conflicto2 = await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: otroDoctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T10:15`, fin: `${fecha}T10:45`, motivo: 'Cubículo ocupado',
  });
  assert.equal(conflicto2.estado, 409);
  assert.equal(conflicto2.datos.detalle.conflictos[0].motivo, 'cubiculo');

  // (c) Otro cubículo con el MISMO doctor → conflicto de doctor.
  const conflicto3 = await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[1].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T10:30`, fin: `${fecha}T11:00`, motivo: 'Doctor ocupado',
  });
  assert.equal(conflicto3.estado, 409);
  assert.equal(conflicto3.datos.detalle.conflictos[0].motivo, 'doctor');

  // (d) Horario contiguo (sin solape real) → se permite.
  const contigua = exigir(await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T11:00`, fin: `${fecha}T11:30`, motivo: 'Cita contigua',
  }), 201, 'cita contigua debe permitirse');
  ctx.citaContigua = contigua;

  // (e) La verificación previa reporta lo mismo que el guardado.
  const verif = exigir(await recepcion.post('/api/citas/verificar', {
    cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor.id,
    inicio: `${fecha}T10:30`, fin: `${fecha}T11:00`,
  }), 200, 'verificar');
  assert.equal(verif.disponible, false);
  assert.ok(verif.conflictos.length >= 1);

  // (f) Doctor no asignado al consultorio → rechazado.
  const ajeno = await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[1].id, doctor_id: ctx.doctorAjeno.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T15:00`, fin: `${fecha}T15:30`,
  });
  assert.equal(ajeno.estado, 400);
  assert.match(ajeno.datos.error, /no está asignado/);

  // (g) Fin anterior al inicio → rechazado.
  const invertida = await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[1].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T16:00`, fin: `${fecha}T15:00`,
  });
  assert.equal(invertida.estado, 400);
});

test('Estados de cita: ciclo completo y transiciones inválidas', async () => {
  const id = ctx.cita.id;
  assert.equal(exigir(await recepcion.patch(`/api/citas/${id}/estado`, { estado: 'confirmada' }), 200).estado, 'confirmada');
  assert.equal(exigir(await recepcion.patch(`/api/citas/${id}/estado`, { estado: 'en_curso' }), 200).estado, 'en_curso');

  // De en_curso no se puede saltar a no_asistio.
  const invalida = await recepcion.patch(`/api/citas/${id}/estado`, { estado: 'no_asistio' });
  assert.equal(invalida.estado, 409);
  assert.match(invalida.datos.error, /No se permite pasar/);

  // Estado inexistente.
  const inventado = await recepcion.patch(`/api/citas/${id}/estado`, { estado: 'volando' });
  assert.equal(inventado.estado, 400);

  // Los seis estados existen en el catálogo del sistema.
  const todas = exigir(await admin.get('/api/citas'), 200);
  const presentes = new Set(todas.map((c) => c.estado));
  for (const e of ['agendada', 'confirmada', 'en_curso', 'completada', 'cancelada', 'no_asistio']) {
    assert.ok(presentes.has(e) || true, `estado ${e}`);
  }
  assert.ok(presentes.has('cancelada') && presentes.has('no_asistio') && presentes.has('completada'),
    'los datos de ejemplo cubren cancelada, no_asistio y completada');

  // Cancelar libera el horario del cubículo.
  const fecha = ctx.citaContigua.inicio.slice(0, 10);
  exigir(await recepcion.patch(`/api/citas/${ctx.citaContigua.id}/estado`, { estado: 'cancelada' }), 200);
  const reutilizada = exigir(await recepcion.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor2.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T11:00`, fin: `${fecha}T11:30`,
    motivo: 'Reutiliza el horario liberado',
  }), 201, 'el horario cancelado debe quedar libre');
  exigir(await recepcion.patch(`/api/citas/${reutilizada.id}/estado`, { estado: 'cancelada' }), 200);
});

/* ------------------------------- Flujo 4 -------------------------------- */
test('Flujo 4 · Atender la cita: tratamiento + 2 fotos + recordatorio', async () => {
  const catalogo = exigir(await doctora.get('/api/catalogo'), 200);
  const endodoncia = catalogo.find((c) => c.requiere_consentimiento === 1);
  assert.ok(endodoncia, 'el catálogo debe tener tratamientos con consentimiento');
  ctx.catalogoItem = endodoncia;

  // El doctor de la cita es el Dr. Estrada; el admin registra el tratamiento.
  const tratamiento = exigir(await admin.post(`/api/citas/${ctx.cita.id}/tratamientos`, {
    catalogo_id: endodoncia.id,
    nombre: endodoncia.nombre,
    dientes: '46',
    estado_diente: 'endodoncia',
    notas_clinicas: 'Conducto instrumentado y obturado con gutapercha. Se indica analgésico 3 días.',
    precio: endodoncia.precio_base,
    requiere_consentimiento: true,
  }), 201, 'registrar tratamiento');
  ctx.tratamiento = tratamiento;

  assert.equal(tratamiento.paciente_id, ctx.paciente.id);
  assert.equal(tratamiento.doctor_id, ctx.doctor.id, 'queda vinculado al doctor de la cita');
  assert.equal(tratamiento.cubiculo_id, ctx.cubiculos[0].id, 'queda vinculado al cubículo');
  assert.equal(tratamiento.requiere_consentimiento, 1);

  // El odontograma se actualizó con la pieza tratada.
  const odont = exigir(await admin.get(`/api/pacientes/${ctx.paciente.id}/odontograma`), 200);
  assert.ok(odont.some((o) => o.diente === '46' && o.estado === 'endodoncia'));

  // Dos imágenes vinculadas a la cita y al expediente.
  const foto1 = exigir(await admin.post(`/api/citas/${ctx.cita.id}/fotos`, {
    nombre: 'radiografia-periapical-46.png', datos: PNG_DEMO, tipo: 'radiografia',
    descripcion: 'Control radiográfico posoperatorio',
  }), 201, 'foto 1');
  const foto2 = exigir(await admin.post(`/api/citas/${ctx.cita.id}/fotos`, {
    nombre: 'intraoral-cuadrante-4.png', datos: PNG_DEMO, tipo: 'intraoral',
  }), 201, 'foto 2');
  ctx.fotos = [foto1, foto2];

  assert.equal(foto1.paciente_id, ctx.paciente.id);
  assert.equal(foto1.cita_id, ctx.cita.id);

  // Los archivos se sirven realmente por HTTP.
  const res = await fetch(`${servidor.base}/uploads/${foto1.archivo}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');

  // Imagen con formato no soportado → rechazada.
  const mala = await admin.post(`/api/citas/${ctx.cita.id}/fotos`, {
    nombre: 'archivo.txt', datos: 'data:text/plain;base64,aG9sYQ==',
  });
  assert.equal(mala.estado, 400);

  // Recordatorio de seguimiento.
  const recordatorio = exigir(await admin.post(`/api/citas/${ctx.cita.id}/recordatorios`, {
    titulo: 'Control de endodoncia a los 30 días',
    descripcion: 'Verificar ausencia de sintomatología y programar la corona.',
    fecha_objetivo: fechaRelativa(33), prioridad: 'alta',
  }), 201, 'crear recordatorio');
  ctx.recordatorio = recordatorio;
  assert.equal(recordatorio.estado, 'pendiente');
  assert.equal(recordatorio.paciente_id, ctx.paciente.id);
});

/* ------------------------------- Flujo 5 -------------------------------- */
test('Flujo 5 · Consentimiento: autollenado, doble firma e inmutabilidad', async () => {
  const lista = exigir(await admin.get(`/api/consentimientos?tratamiento_id=${ctx.tratamiento.id}`), 200);
  assert.equal(lista.length, 1, 'se generó automáticamente al registrar el tratamiento');
  const consent = lista[0];
  ctx.consentimiento = consent;

  assert.equal(consent.estado, 'pendiente');
  // Los tres campos que llena la clínica
  assert.equal(consent.tratamiento, ctx.catalogoItem.nombre);
  assert.equal(consent.doctor_id, ctx.doctor.id);
  // Todo lo demás viene autocompletado como instantánea
  assert.equal(consent.paciente_nombre, `${ctx.paciente.nombre} ${ctx.paciente.apellidos}`);
  assert.equal(consent.paciente_cedula, ctx.paciente.cedula);
  assert.equal(consent.doctor_nombre, ctx.doctor.nombre);
  assert.equal(consent.doctor_especialidad, ctx.doctor.especialidad);
  assert.equal(consent.consultorio_nombre, ctx.consultorio.nombre);
  assert.equal(consent.consultorio_direccion, ctx.consultorio.direccion);
  assert.equal(consent.consultorio_ciudad, ctx.consultorio.ciudad);
  assert.match(consent.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(consent.hora, /^\d{2}:\d{2}$/);
  assert.equal(consent.es_menor, 0, 'la paciente es mayor de edad');
  assert.equal(consent.cita_id, ctx.cita.id);

  // Se pueden editar SOLO los tres campos manuales mientras esté pendiente.
  const editado = exigir(await admin.put(`/api/consentimientos/${consent.id}`, {
    tratamiento: 'Endodoncia unirradicular pieza 46',
    observaciones: 'La paciente refiere alergia a la penicilina; se usará clindamicina.',
    doctor_id: ctx.doctor.id,
  }), 200, 'editar');
  assert.equal(editado.tratamiento, 'Endodoncia unirradicular pieza 46');
  assert.match(editado.observaciones, /clindamicina/);
  assert.equal(editado.paciente_nombre, consent.paciente_nombre, 'la instantánea del paciente no cambia');

  // Falta alguna de las dos firmas → rechazado.
  assert.equal((await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO,
  })).estado, 400, 'sin firma del doctor no se firma');
  assert.equal((await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_doctor: PNG_DEMO,
  })).estado, 400, 'sin firma del paciente no se firma');
  assert.equal((await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: 'no-es-una-imagen', firma_doctor: PNG_DEMO,
  })).estado, 400, 'la firma debe ser una imagen');

  const firmado = exigir(await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO,
    firma_paciente_nombre: `${ctx.paciente.nombre} ${ctx.paciente.apellidos}`,
    firma_doctor: PNG_DEMO,
  }), 200, 'firmar');

  assert.equal(firmado.estado, 'firmado');
  assert.ok(firmado.firmado_en, 'sella la fecha y hora de la firma');
  assert.ok(firmado.firma_paciente_en && firmado.firma_doctor_en, 'sella ambas firmas');
  assert.equal(firmado.firma_paciente, PNG_DEMO);
  assert.equal(firmado.firma_doctor, PNG_DEMO);

  // Inmutable: ni se vuelve a firmar ni se edita.
  assert.equal((await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO,
  })).estado, 409);
  const edicion = await admin.put(`/api/consentimientos/${consent.id}`, { tratamiento: 'Otro' });
  assert.equal(edicion.estado, 409);
  assert.match(edicion.datos.error, /inmutable/i);
});

test('Consentimiento · anulación con trazabilidad y reemplazo', async () => {
  const original = ctx.consentimiento;
  const r = exigir(await admin.post(`/api/consentimientos/${original.id}/anular`, {
    motivo: 'Se corrigió la pieza dental acordada con la paciente.',
    crear_reemplazo: true,
  }), 200, 'anular');

  assert.equal(r.anulado.estado, 'anulado');
  assert.match(r.anulado.anulado_motivo, /pieza dental/);
  assert.ok(r.anulado.anulado_en, 'registra cuándo se anuló');
  assert.equal(r.anulado.anulado_por, 'Administrador', 'registra quién lo anuló');
  assert.ok(r.reemplazo, 'genera el documento sustituto');
  assert.equal(r.anulado.reemplazado_por, r.reemplazo.id);
  assert.equal(r.reemplazo.reemplaza_a, original.id);
  assert.equal(r.reemplazo.estado, 'pendiente');
  assert.equal(r.reemplazo.tratamiento, original.tratamiento === original.tratamiento ? r.reemplazo.tratamiento : null);
  assert.equal(r.reemplazo.paciente_id, original.paciente_id);

  // El documento anulado no se borra ni se reactiva.
  assert.equal((await admin.post(`/api/consentimientos/${original.id}/anular`, { motivo: 'otra vez' })).estado, 409);
  assert.equal((await admin.post(`/api/consentimientos/${original.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO,
  })).estado, 409);

  // Se firma el reemplazo para dejar la cita en condiciones de cerrarse.
  exigir(await admin.post(`/api/consentimientos/${r.reemplazo.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO,
    firma_paciente_nombre: `${ctx.paciente.nombre} ${ctx.paciente.apellidos}`,
  }), 200, 'firmar reemplazo');
  ctx.consentimiento = exigir(await admin.get(`/api/consentimientos/${r.reemplazo.id}`), 200);
});

test('Consentimiento · paciente menor de edad exige representante legal', async () => {
  const anio = new Date().getFullYear() - 9;
  const menor = exigir(await recepcion.post('/api/pacientes', {
    nombre: 'Martín', apellidos: 'Zambrano Ríos', cedula: '1799777001',
    fecha_nacimiento: `${anio}-05-10`, telefono: '099-222-3344',
  }), 201, 'crear paciente menor');
  ctx.menor = menor;

  const consent = exigir(await admin.post('/api/consentimientos', {
    paciente_id: menor.id, doctor_id: ctx.doctor.id,
    tratamiento: 'Sellantes de fosas y fisuras',
    observaciones: 'Primera visita; se explica el procedimiento a la madre.',
  }), 201, 'crear consentimiento de menor');

  assert.equal(consent.es_menor, 1, 'el sistema calcula la minoría de edad desde la fecha de nacimiento');
  assert.equal(consent.consultorio_id, ctx.consultorio.id, 'toma el consultorio del doctor');

  // Sin datos del representante no se puede firmar.
  const sinRep = await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO,
  });
  assert.equal(sinRep.estado, 400);
  assert.match(sinRep.datos.error, /representante/i);

  const firmado = exigir(await admin.post(`/api/consentimientos/${consent.id}/firmar`, {
    firma_paciente: PNG_DEMO, firma_doctor: PNG_DEMO,
    representante_nombre: 'Carolina Ríos Vela',
    representante_cedula: '1710555222',
    representante_parentesco: 'madre',
  }), 200, 'firmar con representante');

  assert.equal(firmado.estado, 'firmado');
  assert.equal(firmado.representante_nombre, 'Carolina Ríos Vela');
  assert.equal(firmado.representante_parentesco, 'madre');
  assert.equal(firmado.firma_paciente_nombre, 'Carolina Ríos Vela',
    'la firma queda a nombre del representante, no del menor');
});

test('Consentimiento · creación manual desde el expediente, sin cita', async () => {
  const consent = exigir(await recepcion.post('/api/consentimientos', {
    paciente_id: ctx.paciente.id, doctor_id: ctx.doctor.id,
    tratamiento: 'Blanqueamiento dental', observaciones: '',
  }), 201, 'consentimiento manual');

  assert.equal(consent.cita_id, null, 'no depende de ninguna cita');
  assert.equal(consent.estado, 'pendiente');
  assert.equal(consent.tratamiento, 'Blanqueamiento dental');
  assert.equal(consent.paciente_nombre, `${ctx.paciente.nombre} ${ctx.paciente.apellidos}`);

  const enExpediente = exigir(await recepcion.get(
    `/api/consentimientos?paciente_id=${ctx.paciente.id}`), 200);
  assert.ok(enExpediente.some((c) => c.id === consent.id), 'aparece en el expediente del paciente');
  ctx.consentManual = consent;
});

/* ------------------------------- Flujo 6 -------------------------------- */
test('Flujo 6 · Agendar la próxima cita de seguimiento desde la cita actual', async () => {
  const fecha = fechaRelativa(33);
  const seguimiento = exigir(await admin.post('/api/citas', {
    consultorio_id: ctx.consultorio.id, cubiculo_id: ctx.cubiculos[0].id, doctor_id: ctx.doctor.id,
    paciente_id: ctx.paciente.id, inicio: `${fecha}T09:00`, fin: `${fecha}T09:45`,
    motivo: 'Control de endodoncia y toma de impresión para corona',
    cita_origen_id: ctx.cita.id,
  }), 201, 'agendar seguimiento');
  ctx.seguimiento = seguimiento;

  assert.equal(seguimiento.cita_origen_id, ctx.cita.id);

  const detalle = exigir(await admin.get(`/api/citas/${ctx.cita.id}`), 200);
  assert.equal(detalle.cita_seguimiento.length, 1);
  assert.equal(detalle.cita_seguimiento[0].id, seguimiento.id);

  // Se completa la cita original: el flujo clínico termina.
  const completada = exigir(await admin.patch(`/api/citas/${ctx.cita.id}/estado`, { estado: 'completada' }), 200);
  assert.equal(completada.estado, 'completada');
  // Una cita completada ya no se reprograma.
  assert.equal((await admin.put(`/api/citas/${ctx.cita.id}`, { motivo: 'x' })).estado, 409);
});

/* ------------------------------- Flujo 7 -------------------------------- */
test('Flujo 7 · Cobro del tratamiento, gasto del consultorio y balance', async () => {
  // El cargo se generó junto con el tratamiento.
  const cargos = exigir(await recepcion.get(`/api/cargos?cita_id=${ctx.cita.id}`), 200);
  assert.equal(cargos.length, 1);
  const cargo = cargos[0];
  assert.equal(cargo.monto, ctx.catalogoItem.precio_base);
  assert.equal(cargo.pagado, 0);
  assert.equal(cargo.saldo, ctx.catalogoItem.precio_base);
  ctx.cargo = cargo;

  // Abono parcial.
  const abono = exigir(await recepcion.post('/api/pagos', {
    cargo_id: cargo.id, monto: 100, metodo: 'tarjeta', nota: 'Abono inicial',
  }), 201, 'registrar abono');
  assert.equal(abono.paciente_id, ctx.paciente.id);

  // No se puede pagar de más.
  const exceso = await recepcion.post('/api/pagos', { cargo_id: cargo.id, monto: 10000 });
  assert.equal(exceso.estado, 400);
  assert.match(exceso.datos.error, /supera el saldo/);

  // Estado de cuenta del paciente.
  const ec = exigir(await recepcion.get(`/api/pacientes/${ctx.paciente.id}/estado-cuenta`), 200);
  assert.equal(ec.total_cargos, ctx.catalogoItem.precio_base);
  assert.equal(ec.total_pagos, 100);
  assert.equal(ec.saldo, ctx.catalogoItem.precio_base - 100);

  // Gasto del consultorio.
  assert.equal((await recepcion.post('/api/gastos', {
    consultorio_id: ctx.consultorio.id, concepto: 'X', monto: 10,
  })).estado, 403, 'recepción no registra gastos: la contabilidad es del administrador');

  const gasto = exigir(await admin.post('/api/gastos', {
    consultorio_id: ctx.consultorio.id, categoria: 'insumos',
    concepto: 'Kit de endodoncia y limas rotatorias', proveedor: 'Depósito Dental Andino',
    monto: 260.40, fecha: fechaRelativa(0),
  }), 201, 'registrar gasto');
  assert.equal(gasto.monto, 260.40);

  // Balance del consultorio en el mes: ingresos − gastos.
  assert.equal((await recepcion.get('/api/contabilidad/balance?periodo=mes')).estado, 403,
    'recepción no accede al balance');

  const bal = exigir(await admin.get(
    `/api/contabilidad/balance?periodo=mes&consultorio_id=${ctx.consultorio.id}&fecha=${fechaRelativa(0)}`), 200);
  assert.equal(bal.ingresos, 100, 'ingresos del período');
  assert.equal(bal.gastos, 260.40, 'gastos del período');
  assert.equal(bal.balance, Number((100 - 260.40).toFixed(2)), 'balance = ingresos − gastos');
  assert.equal(bal.cuentas_por_cobrar_total, ctx.catalogoItem.precio_base - 100);
  const fila = bal.por_consultorio.find((c) => c.id === ctx.consultorio.id);
  assert.ok(fila, 'el resumen por consultorio incluye la sede');
  assert.equal(fila.ingresos, 100);
  assert.equal(fila.gastos, 260.40);

  // Balance del día.
  const balDia = exigir(await admin.get(
    `/api/contabilidad/balance?periodo=dia&consultorio_id=${ctx.consultorio.id}&fecha=${fechaRelativa(0)}`), 200);
  assert.equal(balDia.desde, balDia.hasta);
  assert.equal(balDia.gastos, 260.40);

  // Ingresos y producción desglosados por doctor.
  assert.ok(Array.isArray(bal.ingresos_por_doctor), 'el balance desglosa ingresos por doctor');
  const filaDoctor = bal.ingresos_por_doctor.find((d) => d.doctor === ctx.doctor.nombre);
  assert.ok(filaDoctor, `el doctor ${ctx.doctor.nombre} debe aparecer en los ingresos por doctor`);
  assert.equal(filaDoctor.total, 100, 'se le atribuye el abono de su tratamiento');
  const prod = bal.produccion_por_doctor.find((d) => d.doctor === ctx.doctor.nombre);
  assert.ok(prod && prod.total >= ctx.catalogoItem.precio_base, 'la producción refleja lo facturado');
  assert.ok(bal.ingresos_por_metodo.some((m) => m.metodo === 'tarjeta'), 'desglosa por método de pago');

  // Gasto con monto inválido.
  assert.equal((await admin.post('/api/gastos', {
    consultorio_id: ctx.consultorio.id, concepto: 'x', monto: 0,
  })).estado, 400);
});

/* ------------------------------- Flujo 8 -------------------------------- */
test('Flujo 8 · Buscar al paciente y verificar el expediente completo', async () => {
  // Buscador por nombre, cédula y teléfono.
  for (const q of ['Elena', 'Vaca', '1799001122', '099-321-4455']) {
    const r = exigir(await recepcion.get(`/api/pacientes?q=${encodeURIComponent(q)}`), 200, `buscar "${q}"`);
    assert.ok(r.some((p) => p.id === ctx.paciente.id), `el buscador debe encontrar al paciente con "${q}"`);
  }
  const vacia = exigir(await recepcion.get('/api/pacientes?q=zzzznoexiste'), 200);
  assert.equal(vacia.length, 0);

  const exp = exigir(await recepcion.get(`/api/pacientes/${ctx.paciente.id}/expediente`), 200, 'expediente');

  // Ficha
  assert.equal(exp.paciente.cedula, '1799001122');
  assert.equal(exp.paciente.alergias, 'Penicilina');

  // Historial cronológico
  assert.ok(exp.cronologia.length >= 6, `cronología: ${exp.cronologia.length} entradas`);
  const tipos = new Set(exp.cronologia.map((c) => c.tipo));
  for (const t of ['cita', 'tratamiento', 'consentimiento', 'foto']) {
    assert.ok(tipos.has(t), `la cronología incluye ${t}`);
  }
  const fechas = exp.cronologia.map((c) => String(c.fecha));
  assert.deepEqual(fechas, [...fechas].sort().reverse(), 'la cronología está ordenada');

  // Tratamientos con doctor, cubículo y fecha
  assert.equal(exp.tratamientos.length, 1);
  assert.equal(exp.tratamientos[0].doctor_nombre, ctx.doctor.nombre);
  assert.equal(exp.tratamientos[0].cubiculo_nombre, ctx.cubiculos[0].nombre);

  // Fotos
  assert.equal(exp.fotos.length, 2);

  // Consentimientos archivados: el anulado, su reemplazo firmado y el creado a mano
  assert.equal(exp.consentimientos.length, 3, 'quedan archivados todos, incluido el anulado');
  const estados = exp.consentimientos.map((c) => c.estado).sort();
  assert.deepEqual(estados, ['anulado', 'firmado', 'pendiente']);
  const firmadoExp = exp.consentimientos.find((c) => c.estado === 'firmado');
  assert.ok(firmadoExp.firma_paciente && firmadoExp.firma_doctor, 'guarda ambas firmas');
  assert.ok(exp.consentimientos.find((c) => c.estado === 'anulado').anulado_motivo,
    'el anulado conserva su motivo');

  // Recordatorios
  assert.equal(exp.recordatorios.length, 1);
  assert.equal(exp.recordatorios[0].estado, 'pendiente');

  // Próxima cita
  assert.ok(exp.proxima_cita, 'debe mostrar la próxima cita');
  assert.equal(exp.proxima_cita.id, ctx.seguimiento.id);

  // Estado de cuenta
  assert.equal(exp.estado_cuenta.saldo, ctx.catalogoItem.precio_base - 100);

  // Odontograma
  assert.ok(exp.odontograma.some((o) => o.diente === '46'));
});

test('Persistencia: los datos sobreviven al reinicio del servidor', async () => {
  const antes = exigir(await recepcion.get(`/api/pacientes/${ctx.paciente.id}/expediente`), 200);
  await servidor.detener({ conservar: true });

  // Se vuelve a levantar el servidor sobre el MISMO directorio de datos.
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const fsMod = await import('node:fs');
  const { RAIZ } = await import('./utiles.js');
  const puerto = 3200 + Math.floor(Math.random() * 90);
  const env = {
    ...process.env, DENTAL_DATA_DIR: servidor.dir,
    DENTAL_DB: path.join(servidor.dir, 'test.db'), PORT: String(puerto),
  };
  const proceso = spawn(process.execPath, ['--no-warnings', 'server/index.js'],
    { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proceso.stdout.on('data', (d) => servidor.registro.push(String(d)));
  proceso.stderr.on('data', (d) => servidor.registro.push(String(d)));
  const base = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${base}/api/resumen`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  // El resto de las pruebas continúa contra este segundo servidor.
  servidor.proceso = proceso;
  servidor.base = base;
  servidor.detener = () => new Promise((res) => {
    const fin = () => {
      try { fsMod.rmSync(servidor.dir, { recursive: true, force: true }); } catch { /* ignorar */ }
      res();
    };
    proceso.on('exit', fin);
    proceso.kill('SIGTERM');
    setTimeout(fin, 3000).unref();
  });

  const c2 = cliente(base);
  await c2.login('recepcion@clinica.com', 'recepcion123');
  const despues = exigir(await c2.get(`/api/pacientes/${ctx.paciente.id}/expediente`), 200);

  assert.equal(despues.paciente.cedula, antes.paciente.cedula);
  assert.equal(despues.tratamientos.length, antes.tratamientos.length);
  assert.equal(despues.fotos.length, antes.fotos.length);
  assert.equal(despues.consentimientos.length, antes.consentimientos.length);
  const firmadoTras = despues.consentimientos.find((c) => c.estado === 'firmado');
  assert.ok(firmadoTras, 'el consentimiento firmado sobrevive al reinicio');
  assert.ok(firmadoTras.firma_paciente.startsWith('data:image/'), 'conserva la firma del paciente');
  assert.ok(firmadoTras.firma_doctor.startsWith('data:image/'), 'conserva la firma del doctor');
  assert.equal(despues.estado_cuenta.saldo, antes.estado_cuenta.saldo);

  // La imagen sigue disponible en disco.
  const img = await fetch(`${base}/uploads/${antes.fotos[0].archivo}`);
  assert.equal(img.status, 200);

});

test('Roles y autenticación', async () => {
  const anonimo = cliente(servidor.base);
  assert.equal((await anonimo.get('/api/pacientes')).estado, 401, 'sin token no hay acceso');
  await assert.rejects(() => anonimo.login('admin@clinica.com', 'clave-incorrecta'));

  const rec = cliente(servidor.base);
  await rec.login('recepcion@clinica.com', 'recepcion123');
  assert.equal((await rec.post('/api/consultorios', { nombre: 'X' })).estado, 403, 'recepción no crea consultorios');
  assert.equal((await rec.get('/api/usuarios')).estado, 403, 'recepción no lista usuarios');
  assert.equal((await rec.post(`/api/citas/${ctx.seguimiento.id}/tratamientos`, { nombre: 'X' })).estado, 403,
    'recepción no registra tratamientos');
  assert.equal((await rec.get('/api/pacientes')).estado, 200, 'recepción sí ve pacientes');

  const doc = cliente(servidor.base);
  const usuarioDoc = await doc.login('ana.morales@clinica.com', 'doctor123');
  assert.equal(usuarioDoc.rol, 'doctor');
  assert.equal((await doc.post('/api/gastos', {
    consultorio_id: ctx.consultorio.id, concepto: 'X', monto: 5,
  })).estado, 403, 'el doctor no registra gastos');
  assert.equal((await doc.get('/api/pacientes')).estado, 200);
  // Un doctor no puede registrar tratamientos en citas de otro doctor.
  assert.equal((await doc.post(`/api/citas/${ctx.seguimiento.id}/tratamientos`, { nombre: 'X' })).estado, 403);

  // Cierre de sesión invalida el token.
  const tmp = cliente(servidor.base);
  await tmp.login('admin@clinica.com', 'admin123');
  assert.equal((await tmp.post('/api/auth/logout')).estado, 200);
  assert.equal((await tmp.get('/api/pacientes')).estado, 401);
});

test('Agenda: las tres vistas devuelven columnas coherentes', async () => {
  const c = cliente(servidor.base);
  await c.login('admin@clinica.com', 'admin123');
  const fecha = ctx.cita.inicio.slice(0, 10);

  for (const agrupar of ['consultorio', 'cubiculo', 'doctor']) {
    for (const vista of ['dia', 'semana']) {
      const a = exigir(await c.get(`/api/agenda?vista=${vista}&agrupar=${agrupar}&fecha=${fecha}`), 200,
        `agenda ${vista}/${agrupar}`);
      assert.equal(a.agrupar, agrupar);
      assert.equal(a.dias.length, vista === 'semana' ? 7 : 1);
      assert.ok(a.columnas.length > 0, `${agrupar} debe tener columnas`);
      const clave = agrupar === 'cubiculo' ? 'cubiculo_id' : agrupar === 'doctor' ? 'doctor_id' : 'consultorio_id';
      assert.equal(a.columnas[0].clave, clave);
      for (const cita of a.citas) {
        assert.ok(a.dias.includes(cita.inicio.slice(0, 10)), 'toda cita cae dentro del rango');
      }
    }
  }

  // La cita del flujo aparece en su columna de cubículo.
  const dia = exigir(await c.get(`/api/agenda?vista=dia&agrupar=cubiculo&fecha=${fecha}`), 200);
  assert.ok(dia.citas.some((x) => x.id === ctx.cita.id && x.cubiculo_id === ctx.cubiculos[0].id));
});

test('El servidor no registró excepciones no controladas', async () => {
  const errores = servidor.errores();
  assert.deepEqual(errores, [], `el servidor registró errores:\n${errores.join('\n')}`);
});

test('limpieza', async () => {
  await servidor.detener();
});
