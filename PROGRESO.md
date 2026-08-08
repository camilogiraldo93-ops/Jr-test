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

_(pendiente: se registra literal cuando el subagente entregue su reporte)_
