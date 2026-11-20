# Design: public-rate-and-price-filters

## Context
Ver `proposal.md` para el motivo. El estado relevante es: `GET /products` ya filtra destino, fechas,
personas, tipo y texto, ordena por precio e id y devuelve VES informativo con la tasa global; la tasa
solo se lee en Rutas administrativas con sesión y TOTP. La webNext usa el rewrite `/api/:path*` hacia
NestJS y ya tiene componentes shadcn/ui (Button, Input, Label, Card). Los wireframes aprobados están
en `docs/wireframes/busqueda*.svg` e `inicio*.svg`.

## Goals / Non-Goals

**Goals:**
- Exponer la tasa global vigente y su fecha valor a visitantes anónimos sin crear una nueva superficie administrativa.
- Filtrar el catálogo por precio en USD antes de paginar, usando el mismo precio que muestra la tarjeta.
- Permitir que la web muestre tasa, VES y filtros sin inventar datos ni depender de una sesión.

**Non-Goals:**
- Cambiar el orden del catálogo, los tipos publicados en F1 o las reglas de congelación de la tasa al pagar.
- Añadir dominios de imágenes, endpoints de destinos, PWA offline o dependencias de UI.
- Mostrar overrides de agencia en la lectura pública.

## Decisions

1. **Lectura pública nueva en `RatesModule`.** Un controlador anónimo `GET /rates/today` reutiliza
   `ExchangeRateService.globalRate()`, que ya corre en contexto `public` y resuelve la última fila
   global con `value_date <= hoy`. No llama a `ensureTodayRate()`: el refresco perezoso sigue ocurriendo
   solo en login y alta de pago, y un visitante nunca dispara al proveedor. El contrato es
   `{ available, rate, valueDate }`; `rate` es texto decimal y `valueDate` es `YYYY-MM-DD`.
   - Alternativa descartada: reutilizar `GET /admin/exchange-rates/current`. Exige sesión, TOTP y
     permisos, y devuelve la tasa de la agencia, no la global del catálogo.
   - Alternativa descartada: derivar la tasa de `basePriceVes / basePriceUsd`. Falla sin productos y no
     revela la fecha valor; además haría depends de aritmética de coma flotante en el cliente.

2. **Sin tasa global = 200 con `available: false`.** El catálogo ya sigue sirviendo USD en ese caso, y
   una web pública no debe romperse con un 503. La web oculta el equivalente VES cuando `available` es
   falso; el administrador sigue viendo 503 `RATE_UNAVAILABLE` en la lectura privada.

3. **Filtro de precio sobre el precio visible, en SQL.** `catalogQuerySchema` acepta `minPriceUsd` y
   `maxPriceUsd` como cadenas decimales mayores que cero, con hasta 14 enteros y 2 decimales; se
   rechazan con 422 si el mínimo supera al máximo. En `searchRows` se comparan contra `s.order_price`,
   la columna ya calculada por la subconsulta (total de la estancia con fechas, `base_price_usd` sin
   ellas). Las condiciones de precio y de cursor se combinan en un único `WHERE` para que el filtro se
   aplique antes del `LIMIT` y el cursor siga siendo válido solo dentro del conjunto filtrado.
   - Alternativa descartada: filtrar en memoria en la web. Con paginación por cursor daría menos
     resultados de los esperados y mezclaría páginas.
   - Alternativa descartada: filtrar siempre `base_price_usd`. No coincide con el precio mostrado
     cuando se busca por fechas.

4. **Destinos derivados del propio catálogo.** La web hace una primera consulta sin filtros
   (`limit=50`) y extrae los destinos únicos para el selector y los chips. No se crea un endpoint de
   destinos: no existe en F1 y ampliaría el contrato más allá de lo decidido.

5. **Tipos visibles pero deshabilitados.** El selector ofrece Tour, Hotel, Paquete y Vuelo; los tres
   primeros llevan `disabled` y la etiqueta «próximamente» desde mensajes es/en. Solo `hotel` se envía
   a la API, evitando un 422 del esquema estricto.

6. **UI con componentes existentes.** `Button`, `Input`, `Label` y `Card` de shadcn/ui; `<select>`
   nativo estilizado para destino, fechas, personas y tipo. No se añade Radix Select ni Checkbox: el
   beneficio no justifica una dependencia nueva en F1, y el control nativo ya cumple teclado y etiquetas.
   Las tarjetas usan un placeholder decorativo en vez de `next/image`, para no introducir configuración
   de dominios remotos en esta change.

7. **Dónde vive la tasa en la web.** `SiteHeader` incluye un componente cliente `TodayRateBadge` que
   pide `/api/rates/today` con URL relativa (rewrite de primera parte) y muestra
   `Tasa BCV 36,00 Bs/$ · 10/11/2026` con `Intl.NumberFormat` e `Intl.DateTimeFormat` según el locale.
   Con `available: false` no renderiza el badge. La página `/[locale]/buscar` es cliente y consulta
   `/api/products` con la query construida por helpers puros; así las pruebas pueden renderizar con
   `react-dom/server` sin jsdom.

8. **Textos y accesibilidad.** Toda cadena visible sale de `messages/es.json` y `messages/en.json` con
   las mismas claves. Cada campo lleva `<label htmlFor>`; los resultados y el estado vacío usan
   `role="status"` y `aria-live="polite"`; el foco visible ya viene de las clases `focus-visible` de los
   componentes shadcn/ui; los botones y selectores mantienen áreas táctiles >= 44 px en móvil.

## Risks / Trade-offs

- [La tasa global no existe todavía] → el badge se oculta y las tarjetas muestran solo USD; cubierto por
  un escenario de la spec.
- [Rangos de precio inválidos desde la URL] → el esquema estricto responde 422 y la web no envía
  valores que no haya validado; se prueba el caso inválido en la API.
- [El cursor podría filtrar de más] → la condición de precio entra en el mismo `WHERE` que el cursor;
  se prueba con 30 resultados y dos páginas.
- [Los tipos deshabilitados frustran al usuario] → se muestran con «próximamente» y textos es/en; F2
  los habilitará sin cambiar el contrato.
- [Orden de despliegue] → la API debe desplegarse antes que la web; si la web llega primero, los filtros
  responderían 422. No hay migración de base de datos ni datos que convertir.

## Casos límite y aceptación
- Tasas: `rate` se devuelve como texto decimal, nunca como número de punto flotante; `valueDate` es
  `YYYY-MM-DD` en `America/Caracas` y no se expone `fetched_at`; la lectura no escribe `audit_logs`.
  Cada escenario de la spec tiene un test de API que verifica código, cuerpo y ausencia de llamada al
  proveedor. Fuera de alcance: tasa de agencia para visitantes, historial y cálculo de VES en esta lectura.
- Precios: los límites son decimales > 0 con hasta 14 enteros y 2 decimales; con fechas se contrasta el
  total de `[checkIn, checkOut)` y la noche de salida no cuenta; el VES se calcula después del filtro con
  la tasa global habitual. Los escenarios tienen tests de API y la web envía los parámetros; el cursor
  sigue siendo opaco y se rechaza con 422 si no corresponde. Fuera de alcance: filtrar por VES, por
  precio por noche o por otra moneda, y cualquier orden distinto de precio/id.

## Migration Plan
Sin cambios de esquema. Despliegue: primero la API, luego la web. Rollback: revertir los commits de la
web y después los de la API; no hay datos persistentes nuevos que limpiar.

## Open Questions
Ninguna que pueda diferirse sin cambiar las specs o las tareas.
