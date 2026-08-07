-- Esquema de la base de datos del sistema de gestión dental
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt         TEXT NOT NULL,
  rol          TEXT NOT NULL CHECK (rol IN ('admin','doctor','recepcion')),
  doctor_id    INTEGER REFERENCES doctores(id) ON DELETE SET NULL,
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada_en   TEXT NOT NULL,
  expira_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultorios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL,
  direccion TEXT,
  telefono  TEXT,
  ciudad    TEXT,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cubiculos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  descripcion    TEXT,
  activo         INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubiculos_consultorio ON cubiculos(consultorio_id);

CREATE TABLE IF NOT EXISTS doctores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT NOT NULL,
  cedula       TEXT UNIQUE,
  especialidad TEXT,
  telefono     TEXT,
  email        TEXT,
  color        TEXT DEFAULT '#0ea5e9',
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_consultorio (
  doctor_id      INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, consultorio_id)
);

CREATE TABLE IF NOT EXISTS doctor_cubiculo (
  doctor_id   INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  cubiculo_id INTEGER NOT NULL REFERENCES cubiculos(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, cubiculo_id)
);

CREATE TABLE IF NOT EXISTS pacientes (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                    TEXT NOT NULL,
  apellidos                 TEXT NOT NULL,
  cedula                    TEXT UNIQUE,
  telefono                  TEXT,
  email                     TEXT,
  fecha_nacimiento          TEXT,
  sexo                      TEXT,
  direccion                 TEXT,
  ocupacion                 TEXT,
  contacto_emergencia       TEXT,
  telefono_emergencia       TEXT,
  alergias                  TEXT,
  medicamentos              TEXT,
  antecedentes_medicos      TEXT,
  antecedentes_odontologicos TEXT,
  motivo_consulta           TEXT,
  notas                     TEXT,
  creado_en                 TEXT NOT NULL,
  actualizado_en            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pacientes_cedula ON pacientes(cedula);
CREATE INDEX IF NOT EXISTS idx_pacientes_telefono ON pacientes(telefono);

CREATE TABLE IF NOT EXISTS odontograma (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  diente         TEXT NOT NULL,
  cara           TEXT NOT NULL DEFAULT 'general',
  estado         TEXT NOT NULL,
  nota           TEXT,
  tratamiento_id INTEGER REFERENCES tratamientos(id) ON DELETE SET NULL,
  actualizado_en TEXT NOT NULL,
  UNIQUE (paciente_id, diente, cara)
);
CREATE INDEX IF NOT EXISTS idx_odontograma_paciente ON odontograma(paciente_id);

CREATE TABLE IF NOT EXISTS catalogo_tratamientos (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                 TEXT NOT NULL,
  descripcion            TEXT,
  precio_base            REAL NOT NULL DEFAULT 0,
  duracion_min           INTEGER NOT NULL DEFAULT 30,
  requiere_consentimiento INTEGER NOT NULL DEFAULT 0,
  riesgos                TEXT,
  alternativas           TEXT,
  activo                 INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS citas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  cubiculo_id    INTEGER NOT NULL REFERENCES cubiculos(id) ON DELETE CASCADE,
  doctor_id      INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  inicio         TEXT NOT NULL,
  fin            TEXT NOT NULL,
  motivo         TEXT,
  notas          TEXT,
  estado         TEXT NOT NULL DEFAULT 'agendada'
                 CHECK (estado IN ('agendada','confirmada','en_curso','completada','cancelada','no_asistio')),
  cita_origen_id INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  creada_en      TEXT NOT NULL,
  actualizada_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citas_inicio ON citas(inicio);
CREATE INDEX IF NOT EXISTS idx_citas_cubiculo ON citas(cubiculo_id, inicio);
CREATE INDEX IF NOT EXISTS idx_citas_doctor ON citas(doctor_id, inicio);
CREATE INDEX IF NOT EXISTS idx_citas_paciente ON citas(paciente_id);

CREATE TABLE IF NOT EXISTS tratamientos (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  cita_id                INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  paciente_id            INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  doctor_id              INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  consultorio_id         INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  cubiculo_id            INTEGER NOT NULL REFERENCES cubiculos(id) ON DELETE CASCADE,
  catalogo_id            INTEGER REFERENCES catalogo_tratamientos(id) ON DELETE SET NULL,
  nombre                 TEXT NOT NULL,
  descripcion            TEXT,
  dientes                TEXT,
  notas_clinicas         TEXT,
  precio                 REAL NOT NULL DEFAULT 0,
  requiere_consentimiento INTEGER NOT NULL DEFAULT 0,
  fecha                  TEXT NOT NULL,
  creado_en              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tratamientos_paciente ON tratamientos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_tratamientos_cita ON tratamientos(cita_id);

CREATE TABLE IF NOT EXISTS fotos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id  INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  cita_id      INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  tratamiento_id INTEGER REFERENCES tratamientos(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL DEFAULT 'intraoral',
  nombre       TEXT NOT NULL,
  archivo      TEXT NOT NULL,
  mime         TEXT NOT NULL,
  descripcion  TEXT,
  creada_en    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fotos_paciente ON fotos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_fotos_cita ON fotos(cita_id);

CREATE TABLE IF NOT EXISTS recordatorios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id   INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  cita_id       INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  doctor_id     INTEGER REFERENCES doctores(id) ON DELETE SET NULL,
  titulo        TEXT NOT NULL,
  descripcion   TEXT,
  fecha_objetivo TEXT,
  prioridad     TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja','media','alta')),
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','completado','cancelado')),
  creado_en     TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordatorios_paciente ON recordatorios(paciente_id);

CREATE TABLE IF NOT EXISTS consentimientos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tratamiento_id INTEGER REFERENCES tratamientos(id) ON DELETE CASCADE,
  cita_id        INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  doctor_id      INTEGER NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  descripcion    TEXT NOT NULL,
  riesgos        TEXT NOT NULL,
  alternativas   TEXT NOT NULL,
  nombre_paciente TEXT NOT NULL,
  nombre_doctor  TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','firmado','rechazado')),
  firma_tipo     TEXT,
  firma_data     TEXT,
  firmante       TEXT,
  firmado_en     TEXT,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consentimientos_paciente ON consentimientos(paciente_id);

CREATE TABLE IF NOT EXISTS cargos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  cita_id        INTEGER REFERENCES citas(id) ON DELETE SET NULL,
  tratamiento_id INTEGER REFERENCES tratamientos(id) ON DELETE SET NULL,
  concepto       TEXT NOT NULL,
  monto          REAL NOT NULL,
  fecha          TEXT NOT NULL,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cargos_paciente ON cargos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_cargos_consultorio ON cargos(consultorio_id, fecha);

CREATE TABLE IF NOT EXISTS pagos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cargo_id       INTEGER REFERENCES cargos(id) ON DELETE CASCADE,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  monto          REAL NOT NULL,
  metodo         TEXT NOT NULL DEFAULT 'efectivo',
  fecha          TEXT NOT NULL,
  nota           TEXT,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pagos_paciente ON pagos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_consultorio ON pagos(consultorio_id, fecha);

CREATE TABLE IF NOT EXISTS gastos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  consultorio_id INTEGER NOT NULL REFERENCES consultorios(id) ON DELETE CASCADE,
  categoria      TEXT NOT NULL DEFAULT 'insumos',
  concepto       TEXT NOT NULL,
  proveedor      TEXT,
  monto          REAL NOT NULL,
  fecha          TEXT NOT NULL,
  creado_en      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gastos_consultorio ON gastos(consultorio_id, fecha);
