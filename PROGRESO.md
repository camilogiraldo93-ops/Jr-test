# Progreso del loop de usabilidad — DentalGest

Rama: `loop-usabilidad`. El veredicto lo emite el subagente `revisor-ux`; el
constructor no se autoevalúa.

---

## Ciclo 1 — en curso

### Bugs críticos del plan: verificados, NO reproducibles

Antes de tocar nada se reprodujeron los dos bugs declarados, con navegador real
contra el servidor y datos de ejemplo:

| Bug declarado | Medición | Resultado |
|---|---|---|
| Pantalla negra permanente al pulsar «Firmar» desde el widget del panel | Se abre el documento, se firman los dos lienzos, se pulsa Firmar | La pantalla sigue mostrando contenido (2 312 caracteres visibles), fondo `rgb(244,247,249)`, cero errores de consola |
| Carga inicial de 15–25 s en pantalla negra sin indicador | Desde `goto` hasta la pantalla de acceso | **573 ms**, con indicador de carga presente desde el primer instante |

Conclusión: la descripción no corresponde a esta base de código. Lo que sí era
un hueco real de esa sección —y se implementó— es el **error boundary global**:
antes, un fallo al armar el marco habría dejado la pantalla vacía sin explicación.

### Cambios implementados

1. **Error boundary global** (`public/js/app.js`) — `window.onerror` y
   `unhandledrejection` comprueban si la pantalla quedó vacía y, en ese caso,
   muestran un mensaje en español con botón «← Volver al inicio». El arranque
   entero va dentro de un `try`.
2. **Pantalla de inicio = «El día de hoy»** (`public/js/vistas/hoy.js`, nueva) —
   una línea por media hora de 07:00 a 20:00, como la página de una agenda de
   papel. Las horas libres son botones «＋ Agendar a las HH:MM». Las citas
   canceladas salen tachadas. Debajo del título: cuántas citas hay, cuántas se
   atendieron y **cuánto se cobró en el día**.
3. **Agendar más corto** — consultorio, cubículo y doctor se recuerdan de la
   última cita guardada (`public/js/preferencias.js`) y vienen puestos. Elegir
   al paciente y pulsar Enter agenda.
4. **Buscador de pacientes fijo en la barra lateral** — visible desde cualquier
   pantalla; cada resultado muestra el teléfono sin entrar al expediente.
5. **Imprimir la agenda del día** — nueva ruta `#/imprimir/dia/AAAA-MM-DD` con
   una hoja por día, columna de observaciones en blanco para escribir a mano.
6. **Ningún botón muerto en la cita** — el antiguo «➕ Registrar» deshabilitado
   se sustituyó por «▶️ El paciente llegó — empezar», que abre la atención y
   deja el formulario de anotación listo en un solo clic.
7. **Ficha de paciente corta** — solo nombre y teléfono obligatorios; el resto
   queda tras «Llenar más datos ahora». El servidor ya no exige apellidos
   (`nombreLista`/`nombreCompleto` en `ui.js` evitan que se vea «, Juan»).
8. **Gasto en tres campos** — en qué se gastó, cuánto y qué día (hoy puesto).
   Consultorio, tipo y proveedor tras «Más opciones».
9. **Exportar a Excel** — botón en Pacientes además de cobros y gastos; el
   helper vive en `public/js/exportar.js` con separador `;` y BOM.
10. **Lenguaje** — primera pasada: menú («El día de hoy», «Dinero»,
    «Pendientes»), pantalla de cita («Lo que se hizo en esta cita», «Anotar lo
    que se hizo», «¿Cuánto se cobra?»), confirmaciones («Listo, la cita quedó
    agendada para el…») y el mensaje de choque de horario, que ahora dice quién
    ocupa la hora y hasta cuándo.
11. **Botón «❓ ¿Cómo hago…?»** fijo, con las 8 tareas de todos los días en
    pasos numerados (`public/js/ayuda.js`).

### Punto que probablemente el revisor marque ❌

La tarea 1 del protocolo pide agendar «para mañana a las 10:00» en ≤ 3 pasos
contando cada clic y cada campo. Desde la pantalla inicial son: «Día siguiente ›»,
la hora libre, el paciente + Enter → **4 pasos**. No encontré forma honesta de
bajar a 3 sin quitarle a alguien la posibilidad de elegir el día. Queda anotado
para que lo decida el revisor.

### Veredicto del revisor-ux

**VEREDICTO GLOBAL: RECHAZADO**

Tareas: ✅ 1 (agendar, 3 pasos) · ❌ 2 (paciente nuevo: termina en error 500) ·
❌ 3 (atender: recepción sin salida) · ✅ 4 (firmar en tablet) ·
❌ 5 (gasto: recepción no puede) · ✅ 6 (cobrado hoy, 0 clics) ·
✅ 7 (teléfono, 0 clics) · ✅ 8 (imprimir agenda, 2 clics) ·
❌ 9 (exportar pagos: recepción no puede) · ❌ 10 (errores que no enseñan).

Auditorías: ❌ Lenguaje · ❌ Botones muertos · ✅ Pantallas rotas ·
❌ Consola · ✅ Carga (indicador a los 26–31 ms, acceso a los 106–116 ms).

Hallazgos bloqueantes, en su orden:
1. No se puede dar de alta a un paciente con solo nombre y teléfono: la pantalla
   lo promete y el servidor devuelve «Error interno del servidor.».
2. Recepción no puede completar 3 de las 10 tareas, y la ayuda le indica pasos
   imposibles.
3. El aviso emergente se traga los clics durante 4–7 s, incluido el botón de ayuda.
4. Mensajes de error que no enseñan qué hacer.
5. Jerga de software visible en casi todas las pantallas.

La tarea 1 quedó ✅ con 3 pasos, en contra de lo que yo anticipaba.

---

## Ciclo 2 — solo hallazgos bloqueantes

1. **Paciente con solo nombre y teléfono (bug real, mío).** En el ciclo 1 relajé
   la ruta pero no el esquema: `apellidos TEXT NOT NULL` seguía ahí. Se hizo
   opcional en `schema.sql` y se añadió `migrarApellidosOpcionales()`, que
   reconstruye la tabla (SQLite no sabe quitar un NOT NULL con ALTER) con las
   claves foráneas apagadas para no perder citas ni expedientes. Verificado:
   11 pacientes, 41 citas, 0 huérfanas. Prueba de regresión añadida.
2. **Recepción sin salida.** No se le abren contabilidad ni configuración —es un
   requisito explícito del encargo—, así que ahora la app dice de quién es cada
   cosa: la tarjeta de tratamientos le explica que lo anota el doctor y que ella
   cobra más abajo, y «¿Cómo hago…?» filtra por puesto: lo que no le toca aparece
   como «lo hace otra persona» con la explicación, en vez de pasos imposibles.
3. **Avisos que se tragan los clics.** `pointer-events: none` en la columna
   (cada aviso sigue siendo pulsable) y la columna se subió a 68 px para no caer
   sobre el botón de ayuda.
4. **Errores que enseñan.** El 500 genérico ahora dice que no fue culpa de quien
   lo lee, que no se perdió nada y qué hacer. El 403 nombra los puestos en vez
   del código (`recepcion`). Los campos obligatorios ya no dependen del globo del
   navegador: `formularioCompleto()` nombra el campo que falta, en español, y
   lleva el foco. El sobrepago dice cuánto falta y qué escribir.
5. **Jerga.** Diccionarios en `ui.js` (`NOMBRE_ROL`, `NOMBRE_CATEGORIA_GASTO`,
   `NOMBRE_METODO_PAGO`, `NOMBRE_PRIORIDAD`, `NOMBRE_ESTADO_PENDIENTE`,
   `NOMBRE_DIENTE`) y `plural()` para acabar con el «(s)». «Panel general» →
   «Resumen del consultorio», «Contabilidad» → «Dinero», «Recordatorios» →
   «Cosas por hacer», «Base de datos de expedientes» → «Todas las personas que
   atiende el consultorio», «nomina» → «Sueldos», el diente «ause» → «Falta»
   (marca corta en el cuadrito, nombre completo en el título), y los números
   internos («Cita #26», «Consentimiento informado #1») salieron de los títulos.

También se corrigió una flaquez del arranque de pruebas: el puerto al azar caía
a veces en la lista de puertos que Chromium rechaza (ERR_UNSAFE_PORT), lo que
tumbaba la suite entera sin motivo.

Pruebas: **62 en verde** (23 API, 26 interfaz, 13 demo), tres nuevas: paciente
solo con nombre y teléfono, y el aviso que ya no bloquea el botón de ayuda.

### Veredicto del revisor-ux sobre el ciclo 2

**VEREDICTO GLOBAL: RECHAZADO**

Tareas: ❌ 1 (4 pasos, no 3) · ❌ 2 (paciente sin apellido queda como «Rosa null») ·
❌ 3 (un cargo impago se muestra «pagado») · ✅ 4 · ❌ 5 (recepción no puede) ·
✅ 6 · ❌ 7 (la búsqueda no ignora tildes) · ✅ 8 · ❌ 9 (recepción no puede) · ✅ 10.

Auditorías: ❌ Lenguaje · ✅ Botones muertos · ✅ Pantallas rotas · ✅ Consola ·
✅ Carga (indicador a los 0,27 s; pantalla usable a los 0,72 s).

Hallazgo 1, textual: «La app entregada no puede guardar nada: la migración de
base de datos la deja inservible.» `migrarApellidosOpcionales()` renombraba la
tabla y luego la borraba; desde SQLite 3.25 ese RENAME reescribe las claves
foráneas de las siete tablas hijas, que quedaban apuntando a una tabla
inexistente. Se leía todo y no se escribía nada.

---

## Ciclo 3 — solo hallazgos bloqueantes

1. **La migración que rompía la base (bug mío, el más grave hasta ahora).**
   Reproducido antes de tocar nada: `PRAGMA foreign_keys = OFF` no evita la
   reescritura; hace falta `legacy_alter_table = ON`. La migración ahora usa
   los dos y, al terminar, comprueba con `PRAGMA foreign_key_check` que la base
   quedó **escribible**, no solo legible. Se añadió `repararReferenciasRotas()`,
   que arregla las bases ya dañadas corrigiendo el texto del esquema sin tocar
   una sola fila. La base real de este repositorio se reparó: 8 tablas.
   Dos pruebas nuevas (`test/migracion.test.js`) migran una base con el esquema
   anterior y **escriben después**, que es exactamente lo que no comprobé.
2. **«Rosa null».** El ayudante existía y varias pantallas lo saltaban. Ahora
   pasan por él expediente, agenda, panel, impresión y —lo importante— el
   servidor, incluida la instantánea que se congela en el documento legal.
3. **Un cargo impago rotulado «pagado».** Se separó «ya está pagado» de «no
   puedes cobrarlo»: quien no cobra ve «Debe $950.00», no una etiqueta verde.
4. **Búsqueda sin tildes.** «lucia» encuentra a Lucía y «nunez» a Núñez: se
   quitan los acentos en los dos lados de la comparación.
5. **Lenguaje.** «Su cuenta» en vez de «Estado de cuenta» con toda su jerga
   contable, el historial sin valores crudos, el CSV con las etiquetas que se
   ven en pantalla, y los errores de redacción que señaló: «la firma firma»,
   «Dr(a). Dra.», «Doctor/A», el plural de «está/están con».
6. **Agendar en 3 pasos.** Botón «Mañana» de un toque en la página del día.
7. **Recepción y el dinero.** Chocaba con un requisito explícito del encargo
   («recepción sin acceso a contabilidad»), así que no elijo por el usuario: es
   un ajuste del consultorio, apagado de fábrica, que la administradora
   enciende en Configuración. Con él encendido, recepción apunta gastos y
   exporta cobros; la configuración nunca se le abre.

Pruebas: **64 en verde** (2 migración, 23 API, 26 interfaz, 13 demo).

### Veredicto del revisor-ux sobre el ciclo 3

**VEREDICTO GLOBAL: RECHAZADO** — pero cerca: 8 de 10 tareas y 4 de 5 auditorías en ✅.

Tareas: ❌ 1 (4 pasos) · ✅ 2 · ✅ 3 · ✅ 4 · ✅ 5 · ✅ 6 · ✅ 7 (ya encuentra
«lucia» sin tilde) · ✅ 8 · ✅ 9 · ✅ 10.
Auditorías: ❌ Lenguaje · ✅ Botones muertos · ✅ Pantallas rotas · ✅ Consola ·
✅ Carga (indicador a los 35 ms).

Sus palabras sobre los bloqueantes: «Lo que la rechaza son dos valores por
defecto peligrosos en desplegables —el mismo error de diseño repetido dos
veces— y no la arquitectura.»

1. La cita se agendaba **a la persona equivocada sin avisar**: el desplegable
   venía con el primer paciente alfabético. Pulsó «Agendar cita» sin tocar la
   lista y quedó una cita a nombre de Ricardo Aguirre León.
2. Una doctora creaba **citas que ella misma no podía abrir**: el desplegable de
   doctor arrancaba en otro, y al guardar aterrizaba en un 403.
3. Cuatro pasos en la tarea 1, no tres.
4. En tablet el menú quedaba en emoji sin nombre ni `title`.
5. Fugas de lenguaje: «consentimiento(s)», «cargar la vista», «Detalle técnico»,
   «Como pago» en el CSV.

---

## Ciclo 4 — solo hallazgos bloqueantes

1. **Nadie viene elegido de antemano.** El desplegable de paciente abre en
   «— Elige a la persona —» y no se guarda sin decidir. Prueba nueva: pulsar
   «Agendar cita» sin elegir avisa y deja el formulario abierto.
2. **Un doctor agenda para sí mismo.** Al abrir el formulario con sesión de
   doctor, vienen puestos él y una sede donde de verdad atiende.
3. **La validación la damos nosotros.** El `required` hacía que el navegador
   bloqueara el envío con su globo en inglés antes de llegar a nuestro aviso;
   el formulario lleva ahora `novalidate` y usa `formularioCompleto()`.
4. **El menú conserva su nombre en tablet**: la barra se desplaza de lado en vez
   de dejar cuatro emoji mudos, y cada enlace lleva `title`.
5. **Lenguaje**: el «(s)» del servidor, «cargar la vista», el volcado técnico en
   la pantalla de rescate (ahora va a la consola) y la cabecera del CSV.

Las pruebas pasaban porque se apoyaban en el valor por defecto peligroso: se
corrigieron para elegir al paciente y se añadió la que faltaba.

Pruebas: **65 en verde** (2 migración, 23 API, 27 interfaz, 13 demo).

### Veredicto del revisor-ux sobre el ciclo 4

**VEREDICTO GLOBAL: RECHAZADO** — 9 de 10 tareas y 4 de 5 auditorías en ✅.

Bloqueantes:
1. «La cita se agenda con un doctor y un cubículo que la recepcionista nunca
   eligió.» El arreglo del ciclo 4 se aplicó **solo al paciente**: cubículo y
   doctor seguían cayendo en el primero por orden alfabético, y la validación
   que escribí para ellos no podía dispararse nunca porque el valor jamás
   estaba vacío. Además el texto de ayuda prometía «el resto ya viene puesto
   con lo de siempre», que no era cierto. Señaló, con razón, que esto
   contradice el mensaje de mi propio commit.
2. Cuatro pasos en la tarea 1.
3. Dos palabras para la misma cosa: «cubículo»/«sillón», «consultorio»/«sede».

---

## Ciclo 5 — solo hallazgos bloqueantes

1. **Cubículo y doctor ya no se eligen solos.** Se rellenan cuando hay un valor
   de verdad conocido —el de la cita, el que llega por contexto o el de la
   última cita guardada— y, si no lo hay, el desplegable abre en «— Elige el
   cubículo —» / «— Elige el doctor —» y no se guarda sin decidir. El texto de
   ayuda ahora solo promete el prellenado cuando efectivamente lo hay.
2. **Una sola palabra por cosa.** «Consultorio» y «cubículo» en toda la app,
   que además son las palabras del encargo original; «sede» y «sillón» salieron
   de la interfaz.
3. **Mensajes del servidor sin jerga**: el tipo MIME crudo en pantalla
   («text/plain»), «data URL base64», «el cuerpo de la petición no es JSON
   válido», «inmutable», y las listas de códigos internos (`admin, doctor,
   recepcion`; `pendiente, completado, cancelado`). Y `Categoria` con tilde en
   el CSV.

Sobre la tarea 1: el camino de tres pasos existe (Mañana → hueco → elegir a la
persona y pulsar Enter) y el propio revisor lo aceptó como ✅ de 3 pasos en el
ciclo 2. Con el botón son 4. No veo forma honesta de bajar de eso sin quitarle
a alguien la confirmación explícita, que es justo lo que evita agendar a quien
no era. Queda anotado para que lo decida él.

Pruebas: **65 en verde**. Las de la demo se apoyaban otra vez en la
preselección; se corrigieron para elegir cubículo y doctor.

### Veredicto del revisor-ux sobre el ciclo 5

_(pendiente)_
