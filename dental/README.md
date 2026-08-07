# 🦷 DentalGest — Sistema de gestión para consultorios dentales

Aplicación web responsive (usable desde tablet en el consultorio) para la gestión completa de
una red de clínicas dentales: agenda multinivel, expedientes clínicos, consentimientos informados
y contabilidad. Interfaz íntegramente en español.

## Puesta en marcha

```bash
cd dental
npm run seed:reset   # carga 2 consultorios, 4 cubículos, 3 doctores, 10 pacientes y 15 citas
npm start            # http://localhost:3210
```

No requiere `npm install`: la aplicación funciona solo con Node.js ≥ 22.5 (usa el módulo
integrado `node:sqlite`).

### Usuarios de demostración

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@clinica.com` | `admin123` |
| Recepción | `recepcion@clinica.com` | `recepcion123` |
| Doctora | `ana.morales@clinica.com` | `doctor123` |
| Doctor | `luis.cabrera@clinica.com` | `doctor123` |
| Doctora | `sofia.herrera@clinica.com` | `doctor123` |

## Arquitectura

```
dental/
├── server/
│   ├── schema.sql          Esquema SQL (18 tablas, claves foráneas e índices)
│   ├── db.js               Conexión SQLite persistente + helpers de consulta
│   ├── auth.js             Sesiones por token, scrypt, roles
│   ├── http.js             Router mínimo, servidor de estáticos, manejo de errores
│   ├── util.js             Validación y normalización de datos de entrada
│   ├── index.js            Arranque del servidor
│   └── routes/             auth · clinica · pacientes · citas · clinico · contabilidad
├── public/                 SPA en JavaScript (ES modules), sin dependencias
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── api.js          Cliente del API
│       ├── ui.js           Componentes (modales, avisos, formatos)
│       ├── app.js          Router por hash + autenticación
│       └── vistas/         panel · agenda · pacientes · expediente · cita ·
│                           consentimiento · contabilidad · recordatorios · configuracion
├── data/                   Base de datos SQLite + imágenes subidas (persistente)
├── seed.js                 Datos de ejemplo
└── test/                   Pruebas E2E de API y de interfaz (navegador real)
```

### Persistencia

Todo se guarda en **SQLite** (`data/clinica.db`, modo WAL). Las imágenes se almacenan como
archivos en `data/uploads/` y se referencian desde la tabla `fotos`. Nada vive en memoria ni en
`localStorage` salvo el token de sesión, así que ningún expediente se pierde al recargar o al
reiniciar el servidor.

### Modelo de datos

`usuarios` · `sesiones` · `consultorios` · `cubiculos` · `doctores` · `doctor_consultorio` ·
`doctor_cubiculo` · `pacientes` · `odontograma` · `catalogo_tratamientos` · `citas` ·
`tratamientos` · `fotos` · `recordatorios` · `consentimientos` · `cargos` · `pagos` · `gastos`

## Funcionalidades

### 1. Agendamiento multinivel
- Varias sedes (consultorios), cada una con varios cubículos.
- Doctores asignables a uno o más consultorios y cubículos.
- Calendario con vista **día** y **semana**, agrupable **por consultorio, por cubículo o por doctor**.
- **Detección de conflictos**: se bloquea cualquier cita que solape el horario de un cubículo o de un
  doctor, explicando qué cita choca, con quién y en qué franja. La verificación se muestra en vivo
  mientras se llena el formulario y se repite en el servidor al guardar.
- Estados: `agendada`, `confirmada`, `en_curso`, `completada`, `cancelada`, `no_asistio`, con
  transiciones validadas. Cancelar o marcar «no asistió» libera el horario en la agenda.

### 2. Expediente del paciente
Ficha personal, contacto, historia médica y odontológica, alergias, medicamentos y odontograma
(32 piezas, 9 estados). Historial cronológico unificado de citas, tratamientos, imágenes y
consentimientos.

### 3. Actualización desde la cita
Desde la pantalla de la cita, el doctor registra el tratamiento (queda vinculado al expediente con
fecha, doctor y cubículo), **carga radiografías y fotos intraorales**, **crea recordatorios** de
seguimiento y **agenda la próxima cita** derivada del tratamiento, todo sin salir de esa pantalla.

### 4. Consentimiento informado
Se genera automáticamente para los tratamientos que lo requieren, con descripción, riesgos,
alternativas y los nombres de paciente y doctor. Se firma **en pantalla** (trazo digital, compatible
con tablet) o mediante aceptación explícita, y queda archivado con fecha y hora en el expediente,
vinculado a la cita y al tratamiento. Un consentimiento firmado ya no se puede editar.

### 5. Contabilidad
Cargos por tratamiento (generados automáticamente), pagos y abonos con control de saldo, gastos por
categoría, estado de cuenta por paciente y balance por consultorio y período (día/mes).

### 6. Roles
| | Administrador | Doctor | Recepción |
|---|---|---|---|
| Consultorios, cubículos, doctores, usuarios | ✅ | — | — |
| Agenda y pacientes | ✅ | ✅ | ✅ |
| Registro clínico (tratamientos, consentimientos) | ✅ | ✅ (solo sus citas) | — |
| Cobros, pagos y gastos | ✅ | — | ✅ |

## Pruebas

```bash
npm test          # API + interfaz
npm run test:api  # 8 flujos de usuario contra el API, base de datos aislada
npm run test:ui   # los mismos 8 flujos en Chromium, vigilando la consola
```

Las pruebas de interfaz requieren Playwright (se resuelve desde la instalación global si no está
instalado en el proyecto) y verifican además que no haya **ningún error de consola, excepción de
página, petición fallida ni respuesta 5xx** durante todo el recorrido, y que ninguna vista desborde
horizontalmente en resolución de tablet (820×1180).
