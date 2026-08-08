# Alertas climáticas El Niño — Ecuador

Aplicación web estática que emite alertas por provincia (lluvia extrema, riesgo
de inundación, ola de calor y sequía) a partir de datos abiertos, mostrando en
cada alerta su fuente, el umbral climatológico que la disparó y el desacuerdo
real entre modelos.

No hay backend: todo el procesamiento ocurre en el navegador. Se puede servir
como archivos estáticos (GitHub Pages, cualquier servidor web) sin build step.

## Principios

1. **Ninguna certeza inventada.** La app no genera probabilidades propias. Cuando
   expresa confianza lo hace con dos cosas observables: la dispersión entre cinco
   centros meteorológicos independientes, y el desempeño verificado del propio
   sistema en el backtest.
2. **Umbrales locales, no universales.** El percentil 95 de lluvia diaria de
   Esmeraldas no es el de Loja. Cada provincia y cada día del año tiene su propio
   umbral, calculado sobre 30 años de reanálisis ERA5.
3. **La métrica se publica con su contexto.** Los extremos son raros: no alertar
   nunca ya acierta una fracción alta de los días. Por eso junto a la exactitud
   global se publican siempre el baseline trivial y el desempeño restringido a
   los días con evento.
4. **Si la fuente falla, no hay alerta.** La app nunca rellena con datos viejos
   ni generados.

## Estructura

```
elnino/
  index.html            página única
  css/style.css
  js/
    app.js              orquestador (único archivo que toca el DOM y la red a la vez)
    sources.js          acceso a Open-Meteo (sin DOM → reutilizable en Node)
    map.js              mapa SVG de provincias
    ui.js               tarjetas de alerta, panel ENSO, limitaciones
    lib/
      classifier.js     motor de clasificación (puro; lo comparte el backtest)
      alerts.js         construcción de alertas (puro; lo comparte el smoke test)
      bias.js           corrección de sesgo modelo→ERA5
      doy.js            índice de día del año estable ante años bisiestos
      oni.js            lectura del índice ONI
  data/
    provinces.json      24 provincias, capitales y punto oceánico costero
    provinces.geo.json  polígonos simplificados y pre-proyectados a SVG
    climatology.json    percentiles ERA5 por provincia y día del año
    oni.json            snapshot de la serie ONI de NOAA CPC
    bias.json           corrección de sesgo por provincia
    backtest.json       resultado de la última verificación
```

`tools/` y `backtest/` (en la raíz del repositorio) contienen los generadores de
esos datos y el harness de verificación.

## Regenerar los datos

Requiere Node 20+ y salida a internet.

```bash
node tools/build-climatology.mjs           # ERA5, normal móvil de 30 años
node tools/build-oni.mjs                   # serie ONI de NOAA CPC
node tools/build-geo.mjs                   # polígonos desde geoBoundaries
node tools/build-bias.mjs --test-start AAAA-MM-DD
node tools/selftest.mjs                    # coherencia, sin red
node tools/smoke-live.mjs                  # pipeline completo contra APIs reales
node backtest/run.mjs --out elnino/data/backtest.json
```

`build-climatology.mjs` descarga rangos de 30 años y Open-Meteo aplica un límite
horario agresivo: la descarga cachea en `tools/.cache/` y reintenta con backoff,
así que puede tardar y es seguro re-ejecutarla.

## Verificación

`backtest/run.mjs` compara, para cada provincia y cada día de la ventana:

- **predicho**: la clasificación aplicada al pronóstico que el modelo emitió el
  día anterior (`previous-runs-api`, variables `*_previous_day1`);
- **observado**: la clasificación aplicada al reanálisis ERA5 de ese día
  (`archive-api` con `models=era5`).

La corrección de sesgo se ajusta siempre en días anteriores a la ventana
verificada; `run.mjs` aborta si detecta solapamiento.

Los resultados y el diagnóstico de cada iteración están en
[`backtest/ITERACIONES.md`](../backtest/ITERACIONES.md).

## Fuentes

- [Open-Meteo](https://open-meteo.com/) — pronóstico determinista y multi-modelo,
  Marine API, reanálisis ERA5 (CC BY 4.0).
- [NOAA CPC](https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt) — Oceanic
  Niño Index (anomalía de TSM en Niño 3.4).
- [geoBoundaries](https://www.geoboundaries.org/) — límites ADM1 (CC BY 4.0).
- ERA5 — ECMWF / Copernicus Climate Change Service.

## Aviso

Producto informativo construido sobre datos abiertos. **No es una fuente oficial
de alerta temprana.** Para decisiones de emergencia, el
[INAMHI](https://www.inamhi.gob.ec/) y el
[Servicio Nacional de Gestión de Riesgos](https://www.gestionderiesgos.gob.ec/)
son las autoridades competentes.
