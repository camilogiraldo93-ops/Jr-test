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
│   └── routes/             auth · clinica · pacientes · citas · consentimientos ·
│                           clinico · contabilidad
├── public/                 SPA en JavaScript (ES modules), sin dependencias
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── api.js          Cliente del API
│       ├── ui.js           Componentes (modales, avisos, formatos)
│       ├── app.js          Router por hash + autenticación
│       ├── consentimiento-doc.js  Plantilla del documento (pantalla e impresión)
│       └── vistas/         panel · agenda · pacientes · expediente · cita · consentimiento ·
│                           imprimir · contabilidad · recordatorios · configuracion
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

Las bases creadas con el esquema anterior de `consentimientos` se migran solas al arrancar
(`migrarConsentimientosV2` en `server/db.js`), conservando los registros existentes.

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
- **Tratamiento previsto**: al agendar se puede elegir un tratamiento del catálogo. Ajusta la hora de
  fin con su duración, sugiere el motivo y avisa de antemano si la atención exigirá consentimiento
  informado. Es opcional —se puede agendar sin definirlo— y al abrir la cita el registro clínico
  aparece ya con ese tratamiento elegido.

### 2. Expediente del paciente
Ficha personal, contacto, historia médica y odontológica, alergias, medicamentos y odontograma
(32 piezas, 9 estados). Historial cronológico unificado de citas, tratamientos, imágenes y
consentimientos.

### 3. Actualización desde la cita
Desde la pantalla de la cita, el doctor registra el tratamiento (queda vinculado al expediente con
fecha, doctor y cubículo), **carga radiografías y fotos intraorales**, **crea recordatorios** de
seguimiento y **agenda la próxima cita** derivada del tratamiento, todo sin salir de esa pantalla.

El registro de tratamientos exige que la cita esté **En curso**: en cualquier otro estado el botón
aparece deshabilitado y la tarjeta explica qué hacer.

El catálogo de tratamientos (nombre, precio base, duración y si exige consentimiento) se administra
en **Configuración**. Al registrar un tratamiento se puede tomar del catálogo —que completa nombre,
precio y consentimiento— o escribirlo libre para un caso puntual.

### 4. Consentimiento informado
Documento con plantilla única y formato estándar. El sistema autocompleta **todo** salvo tres
campos: **tratamiento**, **doctor** y **observaciones**. Los datos del paciente (nombre, cédula,
edad), del consultorio (nombre, dirección, teléfono, ciudad) y la fecha/hora se toman como
instantánea al generar el documento, de modo que editar la ficha después no altera lo firmado.

- **Doble firma manuscrita en pantalla** (paciente y doctor), con *pointer events* para dedo,
  lápiz digital y ratón. Cada lienzo tiene Limpiar y Confirmar firma.
- **Modo tablet**: oculta toda la interfaz para entregar el dispositivo al paciente, con el
  documento a pantalla completa y zona de firma grande. Un control flotante permite volver.
- **Menor de edad**: se calcula desde la fecha de nacimiento; el documento cambia su redacción y
  exige nombre, cédula y parentesco del representante legal, que es quien firma.
- **Estados**: `pendiente` → `firmado` (inmutable, sellado con fecha y hora) → `anulado`. Anular
  conserva el documento con motivo, responsable y fecha, y puede generar un reemplazo enlazado en
  ambos sentidos.
- **Se puede crear manualmente** desde el expediente, sin pasar por una cita.
- Una cita **no se puede marcar como Completada** si deja consentimientos requeridos sin firmar.

### 5. Contabilidad
Cargos por tratamiento (generados automáticamente), pagos y abonos con control de saldo, gastos por
categoría, estado de cuenta por paciente y balance por consultorio y período (día/mes). Incluye
desglose de **ingresos por doctor** (cobrado y producción facturada) y **por método de pago**, con
**exportación CSV** de los pagos y los gastos del período.

### 6. Impresión y PDF
Vistas de impresión limpias para el **consentimiento** (con las firmas incluidas), el **expediente
completo** del paciente y el **resumen de la cita**. El PDF se obtiene con «Guardar como PDF» del
diálogo de impresión del navegador; no hay generación de PDF en el servidor.

### 7. Roles
| | Administrador | Doctor | Recepción |
|---|---|---|---|
| Consultorios, cubículos, doctores, usuarios | ✅ | — | — |
| Agenda | ✅ (toda) | ✅ (solo la suya) | ✅ (toda) |
| Pacientes | ✅ (todos) | ✅ (solo los que atiende) | ✅ (todos) |
| Registro clínico (tratamientos, consentimientos) | ✅ | ✅ (solo sus citas) | — |
| Cobro al paciente desde la cita | ✅ | — | ✅ |
| Módulo de contabilidad (balance, gastos, CSV) | ✅ | — | — |

El filtrado del rol *doctor* es del lado del servidor: aunque envíe otros parámetros, la agenda,
las citas y la lista de pacientes se limitan a lo suyo.

**Nota de diseño:** recepción no accede al módulo de contabilidad (balance, gastos, exportaciones),
pero sí puede registrar el cobro del paciente desde la pantalla de la cita, que es trabajo de
mostrador. Si prefieres cerrarle también esa puerta, el cambio es quitar `recepcion` de la ruta
`POST /api/pagos` en `server/routes/contabilidad.js`.

## Pruebas

```bash
npm test          # API + interfaz
npm run test:api  # 8 flujos de usuario contra el API, base de datos aislada
npm run test:ui   # los mismos 8 flujos en Chromium, vigilando la consola
```

Cubren, entre otros: el documento de consentimiento autocompletado, la doble firma trazada con el
ratón sobre el lienzo real, la inmutabilidad del firmado, la anulación con reemplazo, el flujo de
menor de edad con representante legal, el bloqueo de «Completada», las vistas de impresión, la
descarga real del CSV y el aislamiento por rol.

Las pruebas de interfaz requieren Playwright (se resuelve desde la instalación global si no está
instalado en el proyecto) y verifican además que no haya **ningún error de consola, excepción de
página, petición fallida ni respuesta 5xx** durante todo el recorrido, y que ninguna vista desborde
horizontalmente en resolución de tablet (820×1180).
