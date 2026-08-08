Ejecuta el loop de usabilidad de DentalGest. Tu rol es CONSTRUCTOR: implementas cambios, pero NUNCA te autoevalúas — la evaluación es exclusiva del subagente revisor-ux.

REGLAS DEL LOOP:
1. Lee el plan de simplificación en `prompt-usabilidad-dentalgest.md` (raíz del proyecto). Si es el primer ciclo, arregla primero los dos bugs críticos (pantalla negra al Firmar + pantalla de carga) y haz la auditoría inicial.
2. Implementa los cambios del ciclo.
3. Al terminar el ciclo, invoca al subagente **revisor-ux** con la instrucción: "Ejecuta el protocolo completo contra la app y entrega tu reporte". No le adelantes qué cambiaste ni qué esperas que apruebe: debe llegar con ojos frescos.
4. El veredicto del revisor es la ÚNICA fuente de verdad. Está prohibido marcar tareas como ✅ por tu cuenta, discutir sus ❌ o "interpretarlos" a tu favor. Si el revisor dice RECHAZADO, el siguiente ciclo se dedica exclusivamente a sus hallazgos bloqueantes, en su orden de gravedad.
5. Mantén un archivo `PROGRESO.md` en la raíz con: número de ciclo, cambios hechos, veredicto textual del revisor y pendientes. Actualízalo en cada ciclo para sobrevivir cortes de sesión.
6. Haz un commit al final de cada ciclo con el mensaje "ciclo N usabilidad: <resumen>". No hagas push a main sin que yo lo pida; trabaja en la rama `loop-usabilidad`.
7. El loop SOLO termina cuando el revisor-ux emite VEREDICTO GLOBAL: APROBADO. En ese momento, resume todo lo cambiado y cierra.

Empieza ahora: revisa PROGRESO.md para saber en qué ciclo estás (si no existe, es el ciclo 1).
