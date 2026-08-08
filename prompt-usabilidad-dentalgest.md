# Loop de Usabilidad: DentalGest para usuarios de Excel y agenda física

Misión: transformar la app hasta que una recepcionista o doctor que jamás ha usado un sistema —solo Excel y una agenda física de papel— pueda operarla el primer día sin capacitación. Conservar TODA la funcionalidad actual (agenda multinivel, expedientes, tratamientos, consentimientos con firma, recordatorios, contabilidad). Prohibido eliminar funcionalidad para "simplificar": esconder lo avanzado, no borrarlo.

## EL USUARIO OBJETIVO
- Recepcionista que anota citas a lápiz en una agenda física: una página por día, una línea por hora, tacha lo cancelado.
- Doctor que apunta tratamientos en fichas de papel y cobros en un cuaderno.
- Administrador que lleva ingresos y gastos en un Excel simple.
- Ninguno conoce términos de software. Se asustan si algo "desaparece", si hay muchos botones, o si la pantalla cambia sin explicación. Si algo toma más pasos que el papel, vuelven al papel.

## PRINCIPIO RECTOR
La app debe imitar lo que ya conocen. El papel y el Excel son la referencia de diseño, no el enemigo. Cada pantalla debe responder: "¿cómo se vería esto en su agenda de papel o en su hoja de Excel?"

## BUGS CRÍTICOS (arreglar ANTES de todo)
1. El botón "Firmar" del consentimiento deja la app en pantalla negra permanente (reproducible desde el widget "Consentimientos por firmar" del panel). Arreglarlo y agregar un error boundary global: si algo falla, mensaje amable en español con botón "Volver al inicio", jamás pantalla en blanco/negra.
2. La carga inicial tarda 15–25 segundos en pantalla negra sin indicador. Agregar pantalla de carga con logo y mensaje ("Abriendo tu consultorio..."), y optimizar el arranque.

## TRANSFORMACIONES REQUERIDAS

### 1. La agenda debe sentirse como la agenda de papel
- Al abrir la app, lo primero es EL DÍA DE HOY, citas en lista vertical por hora, como una página de agenda física. Las vistas por cubículo/doctor/consultorio quedan como opción secundaria.
- Agendar una cita en máximo 3 pasos: tocar la hora libre → elegir/escribir paciente → guardar. Doctor, consultorio y cubículo se prellenan con los valores habituales (editables).
- Cancelar/reprogramar con un toque, lenguaje simple ("Cambiar de hora", "Cancelar cita"), confirmación de una línea.
- Vista imprimible "Imprimir la agenda de hoy" que parezca una página de agenda física.

### 2. Las tablas deben sentirse como Excel
- Pacientes, pagos y gastos: tablas limpias, ordenables con clic en el encabezado, búsqueda simple arriba.
- Botón "Exportar a Excel" en cada tabla (pacientes, pagos, gastos, citas del mes).
- Registrar un gasto o pago = formulario corto de 3-4 campos, fecha de hoy prellenada, sin campos técnicos.

### 3. Lenguaje humano en toda la app
- Auditar TODOS los textos: cero jerga. Nada de "registro clínico" ni "generar cargo contable"; en su lugar "anotar lo que se hizo", "cobrar", "apuntar gasto".
- Errores que dicen qué pasó y qué hacer ("Esa hora ya está ocupada por María González. Elige otra hora.").
- Confirmaciones humanas ("Listo, la cita quedó agendada para el martes 12 a las 10:00").

### 4. Menos decisiones por pantalla
- Cada pantalla con UNA acción principal obvia (botón grande); lo demás secundario o tras "Más opciones".
- Reorganizar el detalle de cita como flujo natural de atención: "El paciente llegó" → "Anotar lo que se hizo" → "Cobrar" → "Agendar la próxima". Lo demás, plegado.
- Eliminar pasos invisibles: si hay que pasar la cita a "En curso" antes de anotar tratamientos, la app lo hace sola o lo explica con un botón claro; nunca un botón que no responde.

### 5. Imposible perderse, imposible dañar algo
- Siempre visible dónde estoy y cómo volver ("← Volver a la agenda").
- Ninguna acción destructiva sin confirmación simple; preferir "Deshacer" a advertencias amenazantes.
- Todo se guarda solo o con un único botón "Guardar" grande; jamás perder lo escrito por navegar.

### 6. Ayuda para el primer día
- Primera vez en cada sección: recuadro breve y cerrable que explica qué es en 1-2 frases cotidianas.
- Botón fijo "¿Cómo hago...?" con las 6-8 tareas más comunes en pasos numerados.

## CRITERIO DE TÉRMINO
El loop termina únicamente cuando el subagente revisor-ux emite VEREDICTO GLOBAL: APROBADO sobre su protocolo de 10 tareas y 5 auditorías (definido en .claude/agents/revisor-ux.md).
