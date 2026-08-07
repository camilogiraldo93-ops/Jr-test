/**
 * Datos de ejemplo: 2 consultorios, 4 cubículos, 3 doctores, 10 pacientes y 15 citas.
 * Uso: node seed.js [--reset]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, uno, correr, todos, ahora, DIR_DATOS, DIR_UPLOADS } from './server/db.js';
import { crearUsuario } from './server/auth.js';
import { crearConsentimiento } from './server/routes/consentimientos.js';

/** Genera un PNG sólido con una banda diagonal, suficiente como imagen de ejemplo. */
function pngDemo(ancho, alto, base) {
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const linea = Buffer.alloc(ancho * 3 + 1);
    linea[0] = 0; // filtro "None"
    for (let x = 0; x < ancho; x++) {
      const diagonal = Math.abs((x + y) % 90) < 12 ? 28 : 0;
      linea[1 + x * 3] = Math.min(255, base[0] + diagonal);
      linea[2 + x * 3] = Math.min(255, base[1] + diagonal);
      linea[3 + x * 3] = Math.min(255, base[2] + diagonal);
    }
    filas.push(linea);
  }
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, color RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(Buffer.concat(filas))),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** Guarda una imagen de ejemplo en uploads y devuelve su nombre de archivo. */
function guardarImagen(nombre, base, ancho = 420, alto = 300) {
  fs.writeFileSync(path.join(DIR_UPLOADS, nombre), pngDemo(ancho, alto, base));
  return nombre;
}

const RESET = process.argv.includes('--reset');

function limpiar() {
  const tablas = ['sesiones', 'pagos', 'cargos', 'gastos', 'consentimientos', 'recordatorios', 'fotos',
    'odontograma', 'tratamientos', 'citas', 'doctor_cubiculo', 'doctor_consultorio', 'catalogo_tratamientos',
    'cubiculos', 'consultorios', 'pacientes', 'usuarios', 'doctores'];
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of tablas) db.exec(`DELETE FROM ${t};`);
  db.exec("DELETE FROM sqlite_sequence;");
  db.exec('PRAGMA foreign_keys = ON;');
  const up = path.join(DIR_DATOS, 'uploads');
  for (const f of fs.readdirSync(up)) fs.unlinkSync(path.join(up, f));
}

/** Devuelve la fecha del lunes de esta semana + offset de días. */
function dia(offset) {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sembrar() {
  if (RESET) limpiar();
  if (uno('SELECT COUNT(*) n FROM consultorios').n > 0) {
    console.log('La base ya tiene datos. Usa --reset para regenerarlos.');
    return;
  }
  const t = ahora();

  /* ------------------------------ Consultorios ------------------------------ */
  const consultorios = [
    ['Clínica Dental Centro', 'Av. Amazonas N32-145 y Whymper', '02-250-1122', 'Quito'],
    ['Clínica Dental Norte', 'Av. Eloy Alfaro 3410 y Portugal', '02-244-8899', 'Quito'],
  ].map(([nombre, dir, tel, ciudad]) => {
    const { ultimoId } = correr(
      'INSERT INTO consultorios (nombre, direccion, telefono, ciudad, creado_en) VALUES (?,?,?,?,?)',
      [nombre, dir, tel, ciudad, t]);
    return ultimoId;
  });

  /* -------------------------------- Cubículos ------------------------------- */
  const cubiculos = [
    [consultorios[0], 'Cubículo 1', 'Unidad dental con rayos X periapical'],
    [consultorios[0], 'Cubículo 2', 'Unidad dental estándar'],
    [consultorios[0], 'Cubículo 3', 'Quirófano de cirugía e implantes'],
    [consultorios[1], 'Cubículo A', 'Unidad dental con cámara intraoral'],
  ].map(([cid, nombre, desc]) => {
    const { ultimoId } = correr(
      'INSERT INTO cubiculos (consultorio_id, nombre, descripcion, creado_en) VALUES (?,?,?,?)',
      [cid, nombre, desc, t]);
    return ultimoId;
  });

  /* --------------------------------- Doctores ------------------------------- */
  const doctores = [
    ['Dra. Ana Morales', '1712345678', 'Odontología general', '099-111-2233', 'ana.morales@clinica.com', '#0ea5e9'],
    ['Dr. Luis Cabrera', '1798765432', 'Endodoncia', '099-444-5566', 'luis.cabrera@clinica.com', '#10b981'],
    ['Dra. Sofía Herrera', '1755512345', 'Cirugía maxilofacial e implantes', '099-777-8899', 'sofia.herrera@clinica.com', '#f59e0b'],
  ].map(([nombre, cedula, esp, tel, email, color]) => {
    const { ultimoId } = correr(
      'INSERT INTO doctores (nombre, cedula, especialidad, telefono, email, color, creado_en) VALUES (?,?,?,?,?,?,?)',
      [nombre, cedula, esp, tel, email, color, t]);
    return ultimoId;
  });

  const asignaciones = [
    [doctores[0], [consultorios[0], consultorios[1]], [cubiculos[0], cubiculos[1], cubiculos[3]]],
    [doctores[1], [consultorios[0]], [cubiculos[1], cubiculos[2]]],
    [doctores[2], [consultorios[0], consultorios[1]], [cubiculos[2], cubiculos[3]]],
  ];
  for (const [did, cons, cubs] of asignaciones) {
    for (const c of cons) correr('INSERT OR IGNORE INTO doctor_consultorio VALUES (?,?)', [did, c]);
    for (const c of cubs) correr('INSERT OR IGNORE INTO doctor_cubiculo VALUES (?,?)', [did, c]);
  }

  /* --------------------------------- Usuarios ------------------------------- */
  crearUsuario({ nombre: 'Administrador', email: 'admin@clinica.com', password: 'admin123', rol: 'admin' });
  crearUsuario({ nombre: 'Recepción Centro', email: 'recepcion@clinica.com', password: 'recepcion123', rol: 'recepcion' });
  crearUsuario({ nombre: 'Dra. Ana Morales', email: 'ana.morales@clinica.com', password: 'doctor123', rol: 'doctor', doctor_id: doctores[0] });
  crearUsuario({ nombre: 'Dr. Luis Cabrera', email: 'luis.cabrera@clinica.com', password: 'doctor123', rol: 'doctor', doctor_id: doctores[1] });
  crearUsuario({ nombre: 'Dra. Sofía Herrera', email: 'sofia.herrera@clinica.com', password: 'doctor123', rol: 'doctor', doctor_id: doctores[2] });

  /* --------------------------- Catálogo de tratamientos --------------------- */
  const catalogo = [
    ['Profilaxis dental', 'Limpieza dental con ultrasonido y pulido.', 35, 30, 0, '', ''],
    ['Resina compuesta', 'Restauración estética con resina fotocurable.', 55, 45, 0, '', ''],
    ['Endodoncia unirradicular', 'Tratamiento de conductos en diente de una raíz.', 220, 90, 1,
      'Dolor postoperatorio, fractura del instrumento, perforación radicular, necesidad de retratamiento o extracción.',
      'Extracción dental, mantenimiento sintomático temporal o derivación a endodoncista.'],
    ['Extracción simple', 'Exodoncia de pieza dental sin complicaciones.', 60, 30, 1,
      'Sangrado, alveolitis, infección, lesión de tejidos blandos, parestesia temporal.',
      'Tratamiento de conducto para conservar la pieza, o mantenimiento periodontal.'],
    ['Implante dental', 'Colocación de implante de titanio con cirugía.', 950, 120, 1,
      'Fracaso de la osteointegración, infección, lesión nerviosa, perforación del seno maxilar, necesidad de injerto óseo.',
      'Prótesis parcial removible, puente fijo convencional o no reponer la pieza.'],
    ['Blanqueamiento dental', 'Blanqueamiento en consultorio con peróxido.', 180, 60, 1,
      'Sensibilidad dental transitoria, irritación gingival, resultado variable según pigmentación.',
      'Microabrasión, carillas o no realizar el tratamiento.'],
    ['Corona de porcelana', 'Rehabilitación con corona cerámica.', 420, 90, 1,
      'Sensibilidad, necesidad de endodoncia posterior, fractura de la cerámica, desajuste marginal.',
      'Incrustación, resina de gran extensión o extracción.'],
    ['Control de ortodoncia', 'Ajuste mensual de aparatología fija.', 45, 30, 0, '', ''],
  ];
  for (const c of catalogo) {
    correr(`INSERT INTO catalogo_tratamientos (nombre, descripcion, precio_base, duracion_min, requiere_consentimiento, riesgos, alternativas)
            VALUES (?,?,?,?,?,?,?)`, c);
  }

  /* -------------------------------- Pacientes ------------------------------- */
  const pacientes = [
    ['María', 'González Pérez', '1701234567', '099-100-1001', 'maria.gonzalez@mail.com', '1988-04-12', 'F', 'Av. 10 de Agosto 1234', 'Contadora', 'Jorge González', '099-100-2001', 'Penicilina', 'Losartán 50mg', 'Hipertensión controlada', 'Sangrado de encías ocasional', 'Limpieza y control'],
    ['Carlos', 'Ramírez Vega', '1702345678', '099-100-1002', 'carlos.ramirez@mail.com', '1975-09-30', 'M', 'Calle Cuero y Caicedo 456', 'Ingeniero', 'Lucía Vega', '099-100-2002', 'Ninguna conocida', 'Ninguno', 'Diabetes tipo 2', 'Endodoncia previa en pieza 26', 'Dolor en molar superior'],
    ['Lucía', 'Torres Andrade', '1703456789', '099-100-1003', 'lucia.torres@mail.com', '1996-01-22', 'F', 'Av. República 890', 'Diseñadora', 'Marta Andrade', '099-100-2003', 'Látex', 'Anticonceptivo oral', 'Sin antecedentes relevantes', 'Ortodoncia finalizada en 2021', 'Blanqueamiento dental'],
    ['Andrés', 'Salazar Mora', '1704567890', '099-100-1004', 'andres.salazar@mail.com', '1982-07-05', 'M', 'Calle Madrid 321', 'Comerciante', 'Paola Mora', '099-100-2004', 'Ninguna conocida', 'Omeprazol', 'Gastritis crónica', 'Bruxismo severo', 'Desgaste dental'],
    ['Valeria', 'Cedeño Loor', '1705678901', '099-100-1005', 'valeria.cedeno@mail.com', '2001-11-17', 'F', 'Av. Colón 654', 'Estudiante', 'Rosa Loor', '099-100-2005', 'Ibuprofeno', 'Ninguno', 'Asma leve', 'Caries interproximales', 'Control semestral'],
    ['Jorge', 'Paredes Núñez', '1706789012', '099-100-1006', 'jorge.paredes@mail.com', '1969-03-08', 'M', 'Calle Veintimilla 77', 'Jubilado', 'Elena Núñez', '099-100-2006', 'Sulfas', 'Metformina, Aspirina', 'Diabetes tipo 2, cardiopatía', 'Pérdida de piezas posteriores', 'Evaluación para implantes'],
    ['Daniela', 'Mendoza Ruiz', '1707890123', '099-100-1007', 'daniela.mendoza@mail.com', '1993-06-25', 'F', 'Av. 6 de Diciembre 2100', 'Abogada', 'Iván Mendoza', '099-100-2007', 'Ninguna conocida', 'Ninguno', 'Embarazo de 20 semanas', 'Gingivitis del embarazo', 'Limpieza dental'],
    ['Fernando', 'Ochoa Silva', '1708901234', '099-100-1008', 'fernando.ochoa@mail.com', '1985-12-01', 'M', 'Calle Foch 145', 'Chef', 'Karina Silva', '099-100-2008', 'Anestesia con epinefrina', 'Ninguno', 'Arritmia leve', 'Fractura de pieza 11', 'Reconstrucción estética'],
    ['Gabriela', 'Vinueza Castro', '1709012345', '099-100-1009', 'gabriela.vinueza@mail.com', '1979-08-14', 'F', 'Av. Naciones Unidas 500', 'Docente', 'Pedro Castro', '099-100-2009', 'Ninguna conocida', 'Levotiroxina', 'Hipotiroidismo', 'Periodontitis moderada', 'Tratamiento periodontal'],
    ['Ricardo', 'Aguirre León', '1710123456', '099-100-1010', 'ricardo.aguirre@mail.com', '2010-02-19', 'M', 'Calle Japón 88', 'Estudiante', 'Nadia León', '099-100-2010', 'Ninguna conocida', 'Ninguno', 'Sin antecedentes relevantes', 'Primera visita odontológica', 'Revisión y sellantes'],
  ].map((p) => {
    const { ultimoId } = correr(
      `INSERT INTO pacientes (nombre, apellidos, cedula, telefono, email, fecha_nacimiento, sexo, direccion,
        ocupacion, contacto_emergencia, telefono_emergencia, alergias, medicamentos, antecedentes_medicos,
        antecedentes_odontologicos, motivo_consulta, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...p, t, t]);
    return ultimoId;
  });

  /* ---------------------------------- Citas --------------------------------- */
  // [díaOffset, hora, duración(min), consultorioIdx, cubiculoIdx, doctorIdx, pacienteIdx, motivo, estado]
  const plan = [
    [0, '08:00', 30, 0, 0, 0, 0, 'Profilaxis y control', 'completada'],
    [0, '09:00', 45, 0, 1, 1, 1, 'Dolor en molar superior derecho', 'completada'],
    [0, '10:00', 60, 0, 2, 2, 5, 'Evaluación para implante', 'confirmada'],
    [0, '11:00', 30, 1, 3, 0, 2, 'Consulta de blanqueamiento', 'agendada'],
    [1, '08:30', 45, 0, 0, 0, 6, 'Limpieza dental (embarazo)', 'confirmada'],
    [1, '09:30', 90, 0, 1, 1, 1, 'Endodoncia pieza 26', 'agendada'],
    [1, '11:00', 30, 0, 2, 2, 8, 'Control periodontal', 'agendada'],
    [1, '14:00', 30, 1, 3, 0, 9, 'Revisión y sellantes', 'agendada'],
    [2, '08:00', 45, 0, 0, 0, 3, 'Control por bruxismo', 'agendada'],
    [2, '09:00', 60, 0, 2, 2, 5, 'Cirugía de implante', 'agendada'],
    [2, '10:30', 30, 0, 1, 1, 4, 'Control semestral', 'cancelada'],
    [3, '08:00', 60, 0, 1, 1, 7, 'Reconstrucción pieza 11', 'agendada'],
    [3, '09:30', 30, 1, 3, 2, 2, 'Blanqueamiento dental', 'agendada'],
    [3, '11:00', 30, 0, 0, 0, 0, 'Control post-profilaxis', 'agendada'],
    [4, '08:30', 45, 0, 0, 0, 4, 'Restauración con resina', 'no_asistio'],
    // --- Citas futuras, para poder probar los flujos completos ---
    [7, '08:00', 60, 0, 2, 2, 5, 'Cirugía de implante (2.ª fase)', 'confirmada'],
    [7, '09:30', 30, 0, 0, 0, 6, 'Control de gingivitis del embarazo', 'agendada'],
    [7, '11:00', 45, 1, 3, 0, 2, 'Blanqueamiento — sesión 1', 'agendada'],
    [8, '08:30', 90, 0, 1, 1, 3, 'Endodoncia pieza 46', 'confirmada'],
    [8, '10:30', 30, 0, 0, 0, 9, 'Sellantes en molares definitivos', 'agendada'],
    [9, '09:00', 60, 0, 2, 2, 8, 'Fase quirúrgica periodontal', 'agendada'],
    [10, '08:00', 45, 1, 3, 2, 7, 'Corona de porcelana pieza 11', 'confirmada'],
    [11, '09:00', 30, 0, 0, 0, 0, 'Control anual y profilaxis', 'agendada'],
    [14, '10:00', 60, 0, 1, 1, 1, 'Retratamiento de conducto', 'agendada'],
  ];

  const citas = plan.map(([off, hora, dur, ci, cui, di, pi, motivo, estado]) => {
    const fecha = dia(off);
    const [h, m] = hora.split(':').map(Number);
    const fin = new Date(2000, 0, 1, h, m + dur);
    const finStr = `${String(fin.getHours()).padStart(2, '0')}:${String(fin.getMinutes()).padStart(2, '0')}`;
    const { ultimoId } = correr(
      `INSERT INTO citas (consultorio_id, cubiculo_id, doctor_id, paciente_id, inicio, fin, motivo, estado, creada_en, actualizada_en)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [consultorios[ci], cubiculos[cui], doctores[di], pacientes[pi],
       `${fecha}T${hora}`, `${fecha}T${finStr}`, motivo, estado, t, t]);
    return ultimoId;
  });

  /* ---------------- Historia clínica de las citas completadas --------------- */
  const catProfilaxis = uno("SELECT * FROM catalogo_tratamientos WHERE nombre = 'Profilaxis dental'");
  const catResina = uno("SELECT * FROM catalogo_tratamientos WHERE nombre = 'Resina compuesta'");

  const tr1 = correr(
    `INSERT INTO tratamientos (cita_id, paciente_id, doctor_id, consultorio_id, cubiculo_id, catalogo_id,
      nombre, descripcion, dientes, notas_clinicas, precio, requiere_consentimiento, fecha, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [citas[0], pacientes[0], doctores[0], consultorios[0], cubiculos[0], catProfilaxis.id,
     'Profilaxis dental', catProfilaxis.descripcion, '', 'Cálculo supragingival moderado. Se indica enjuague con clorhexidina 7 días.',
     35, dia(0), t]).ultimoId;
  correr(`INSERT INTO cargos (paciente_id, consultorio_id, cita_id, tratamiento_id, concepto, monto, fecha, creado_en)
          VALUES (?,?,?,?,?,?,?,?)`, [pacientes[0], consultorios[0], citas[0], tr1, 'Profilaxis dental', 35, dia(0), t]);
  const cargo1 = uno('SELECT id FROM cargos WHERE tratamiento_id = ?', [tr1]);
  correr(`INSERT INTO pagos (cargo_id, paciente_id, consultorio_id, monto, metodo, fecha, nota, creado_en)
          VALUES (?,?,?,?,?,?,?,?)`, [cargo1.id, pacientes[0], consultorios[0], 35, 'efectivo', dia(0), 'Pago completo', t]);

  const tr2 = correr(
    `INSERT INTO tratamientos (cita_id, paciente_id, doctor_id, consultorio_id, cubiculo_id, catalogo_id,
      nombre, descripcion, dientes, notas_clinicas, precio, requiere_consentimiento, fecha, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    [citas[1], pacientes[1], doctores[1], consultorios[0], cubiculos[1], catResina.id,
     'Resina compuesta', catResina.descripcion, '26', 'Caries oclusal profunda. Se coloca base de ionómero y resina A2.',
     55, dia(0), t]).ultimoId;
  correr(`INSERT INTO cargos (paciente_id, consultorio_id, cita_id, tratamiento_id, concepto, monto, fecha, creado_en)
          VALUES (?,?,?,?,?,?,?,?)`, [pacientes[1], consultorios[0], citas[1], tr2, 'Resina compuesta', 55, dia(0), t]);
  const cargo2 = uno('SELECT id FROM cargos WHERE tratamiento_id = ?', [tr2]);
  correr(`INSERT INTO pagos (cargo_id, paciente_id, consultorio_id, monto, metodo, fecha, nota, creado_en)
          VALUES (?,?,?,?,?,?,?,?)`, [cargo2.id, pacientes[1], consultorios[0], 30, 'tarjeta', dia(0), 'Abono parcial', t]);

  correr(`INSERT INTO odontograma (paciente_id, diente, cara, estado, nota, tratamiento_id, actualizado_en)
          VALUES (?,?,?,?,?,?,?)`, [pacientes[1], '26', 'oclusal', 'obturado', 'Resina compuesta', tr2, t]);
  correr(`INSERT INTO odontograma (paciente_id, diente, cara, estado, nota, tratamiento_id, actualizado_en)
          VALUES (?,?,?,?,?,?,?)`, [pacientes[1], '36', 'general', 'caries', 'Caries incipiente a controlar', null, t]);
  correr(`INSERT INTO odontograma (paciente_id, diente, cara, estado, nota, tratamiento_id, actualizado_en)
          VALUES (?,?,?,?,?,?,?)`, [pacientes[5], '46', 'general', 'ausente', 'Candidato a implante', null, t]);

  correr(`INSERT INTO recordatorios (paciente_id, cita_id, doctor_id, titulo, descripcion, fecha_objetivo, prioridad, creado_en, actualizado_en)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    [pacientes[1], citas[1], doctores[1], 'Control de la resina en pieza 26',
     'Verificar sensibilidad y ajuste oclusal.', dia(21), 'media', t, t]);
  correr(`INSERT INTO recordatorios (paciente_id, cita_id, doctor_id, titulo, descripcion, fecha_objetivo, prioridad, creado_en, actualizado_en)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    [pacientes[5], citas[2], doctores[2], 'Solicitar tomografía previa al implante',
     'Enviar orden de CBCT del sector posterior inferior derecho.', dia(7), 'alta', t, t]);

  /* ------------- Cita en curso con consentimiento pendiente de firma -------- */
  // Deja preparado el caso de prueba: atención abierta, tratamiento que exige
  // consentimiento y documento aún sin firmar (la cita no se puede completar).
  const fechaHoy = dia(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const citaEnCurso = correr(
    `INSERT INTO citas (consultorio_id, cubiculo_id, doctor_id, paciente_id, inicio, fin, motivo, estado, creada_en, actualizada_en)
     VALUES (?,?,?,?,?,?,?, 'en_curso', ?,?)`,
    [consultorios[0], cubiculos[2], doctores[2], pacientes[5],
     `${fechaHoy}T16:00`, `${fechaHoy}T17:00`, 'Colocación de implante pieza 46', t, t]).ultimoId;

  const catImplante = uno("SELECT * FROM catalogo_tratamientos WHERE nombre = 'Implante dental'");
  const trImplante = correr(
    `INSERT INTO tratamientos (cita_id, paciente_id, doctor_id, consultorio_id, cubiculo_id, catalogo_id,
      nombre, descripcion, dientes, notas_clinicas, precio, requiere_consentimiento, fecha, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [citaEnCurso, pacientes[5], doctores[2], consultorios[0], cubiculos[2], catImplante.id,
     'Implante dental', catImplante.descripcion, '46',
     'Lecho preparado con fresado secuencial. Pendiente firmar consentimiento antes de cerrar la atención.',
     catImplante.precio_base, fechaHoy, t]).ultimoId;
  correr(`INSERT INTO cargos (paciente_id, consultorio_id, cita_id, tratamiento_id, concepto, monto, fecha, creado_en)
          VALUES (?,?,?,?,?,?,?,?)`,
    [pacientes[5], consultorios[0], citaEnCurso, trImplante, 'Implante dental', catImplante.precio_base, fechaHoy, t]);

  crearConsentimiento({
    paciente_id: pacientes[5], doctor_id: doctores[2], consultorio_id: consultorios[0],
    cita_id: citaEnCurso, tratamiento_id: trImplante, catalogo_id: catImplante.id,
    tratamiento: 'Implante dental', observaciones: 'Paciente diabético controlado; se refuerzan cuidados posoperatorios.',
    creado_por: 'Datos de ejemplo',
  });

  /* --------------------------- Imágenes de ejemplo -------------------------- */
  const imagenes = [
    [citas[1], pacientes[1], 'radiografia', 'radiografia-periapical-26.png', [60, 62, 70],
     'Control radiográfico de la obturación'],
    [citas[1], pacientes[1], 'intraoral', 'intraoral-cuadrante-2.png', [150, 92, 88], 'Foto intraoral posoperatoria'],
    [citaEnCurso, pacientes[5], 'radiografia', 'radiografia-panoramica-implante.png', [52, 55, 64],
     'Panorámica previa a la cirugía'],
  ];
  for (const [citaId, pacienteId, tipo, nombre, color, descripcion] of imagenes) {
    guardarImagen(nombre, color);
    correr(
      `INSERT INTO fotos (paciente_id, cita_id, tipo, nombre, archivo, mime, descripcion, creada_en)
       VALUES (?,?,?,?,?, 'image/png', ?,?)`,
      [pacienteId, citaId, tipo, nombre, nombre, descripcion, t]);
  }

  /* --------------------------------- Gastos --------------------------------- */
  const gastos = [
    [consultorios[0], 'insumos', 'Compra de resinas y adhesivos', 'Depósito Dental Andino', 420.50, dia(0)],
    [consultorios[0], 'servicios', 'Energía eléctrica del mes', 'Empresa Eléctrica', 185.30, dia(1)],
    [consultorios[0], 'nomina', 'Sueldo asistente dental', '', 620.00, dia(1)],
    [consultorios[1], 'alquiler', 'Arriendo del local', 'Inmobiliaria Norte', 900.00, dia(0)],
    [consultorios[1], 'insumos', 'Guantes, mascarillas y esterilización', 'BioDental S.A.', 210.75, dia(2)],
    [consultorios[0], 'mantenimiento', 'Mantenimiento del compresor', 'Servitec', 130.00, dia(3)],
  ];
  for (const g of gastos) {
    correr(`INSERT INTO gastos (consultorio_id, categoria, concepto, proveedor, monto, fecha, creado_en)
            VALUES (?,?,?,?,?,?,?)`, [...g, t]);
  }

  console.log('Datos de ejemplo cargados:');
  console.log(`  Consultorios: ${todos('SELECT id FROM consultorios').length}`);
  console.log(`  Cubículos:    ${todos('SELECT id FROM cubiculos').length}`);
  console.log(`  Doctores:     ${todos('SELECT id FROM doctores').length}`);
  console.log(`  Pacientes:    ${todos('SELECT id FROM pacientes').length}`);
  console.log(`  Citas:        ${todos('SELECT id FROM citas').length}`);
  console.log(`  Futuras:      ${todos("SELECT id FROM citas WHERE inicio > datetime('now')").length}`);
  console.log(`  Imágenes:     ${todos('SELECT id FROM fotos').length}`);
  console.log(`  Consentim.:   ${todos('SELECT id FROM consentimientos').length} (pendientes: ${todos("SELECT id FROM consentimientos WHERE estado='pendiente'").length})`);
  console.log(`  Usuarios:     ${todos('SELECT id FROM usuarios').length}`);
  console.log('\nAccesos: admin@clinica.com/admin123 · recepcion@clinica.com/recepcion123 · ana.morales@clinica.com/doctor123');
}

sembrar();
