# Registro de iteraciones

Cada iteración: construir → probar contra datos reales → medir → corregir.
Todas las métricas provienen de `node backtest/run.mjs` sobre datos descargados
de Open-Meteo y NOAA. Ninguna cifra de este archivo está simulada.

**Definición de la métrica principal.** Para cada par (provincia, día) se compara
el vector de severidades de las 4 categorías obtenido del pronóstico emitido con
24 h de anticipación contra el obtenido del reanálisis ERA5 de ese día.
"Coincidencia exacta" exige que las 4 coincidan.

**Por qué se publican cuatro números y no uno.** Los eventos extremos son raros:
un sistema que no alerte nunca ya acierta una fracción alta de los días. Por eso
junto a la coincidencia exacta se reporta siempre el baseline trivial y la
exactitud restringida a los días en que hubo o se predijo evento.

---

## Iteración 1 — línea base

- Climatología: ERA5 **1991-2020**
- Modulación ENSO: activada · Corrección de sesgo: no
- Ventana: 2026-07-03 → 2026-08-01 · 720 pares provincia-día

| Métrica | Valor |
|---|---|
| Coincidencia exacta del estado | **50.8 %** |
| Acuerdo binario hay/no hay alerta | 72.2 % |
| Baseline "nunca alertar" | 39.3 % |
| Exactitud sólo en días con evento | 33.6 % (n=533) |

| Categoría | Obs | Pred | POD | FAR | CSI |
|---|---|---|---|---|---|
| lluvia_extrema | 20 | 39 | 25 % | 87 % | 9 % |
| inundacion | 3 | 3 | 67 % | 33 % | 50 % |
| ola_calor | 381 | 377 | 73 % | 26 % | 58 % |
| sequia | 88 | 82 | 85 % | 9 % | 79 % |

**Diagnóstico.** La categoría `ola_calor` se activa en 381 de 720 casos: el 53 %
de los días. Un umbral de percentil 95 debe dispararse en torno al 5 %. La causa
no es el pronóstico sino el período de referencia: con el calentamiento
observado, el p95 de temperatura máxima de 1991-2020 ya no describe un extremo
en 2026, así que un día corriente lo supera. Eso convierte la categoría en ruido
permanente y arrastra la coincidencia exacta, porque basta con que `ola_calor`
discrepe para que todo el estado discrepe.

Segundo hallazgo: `lluvia_extrema` tiene FAR 87 % y POD 25 %. El modelo predice
casi el doble de eventos de los observados, lo que sugiere sesgo húmedo del
modelo respecto a ERA5 además del error de temporización propio de la lluvia
diaria puntual.

**Correcciones para la iteración 2.**
1. Cambiar el período de referencia a la normal móvil de 30 años más reciente
   (1996-2025), que es la práctica estándar para umbrales operativos.
2. Preparar corrección de sesgo modelo→ERA5 ajustada fuera de muestra (se mide
   por separado en la iteración 3 para poder atribuir el efecto de cada cambio).
