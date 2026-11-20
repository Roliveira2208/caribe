# Tareas: public-rate-and-price-filters

Una tarea a la vez, tests primero y un commit por tarea. Antes de cada commit: `pnpm lint`,
`pnpm typecheck` y `pnpm test` en verde. Los commits de spec van aparte (`docs(spec): ...`).

## 1. Contratos de API

- [x] T-PRF-1 Añadir primero los tests e2e de `GET /rates/today` (anónimo, feriado, override global,
  override de agencia oculto, sin tasa, sin llamada al proveedor) y después el controlador público que
  reutiliza `globalRate()`; documentar el contrato en `.env.example` si hace falta.
  Prueba: exchange-rates › "Visitante sin sesión", "Feriado o fin de semana", "Override global",
  "Override de una agencia", "Sin tasa global" y "Consulta perezosa".
- [x] T-PRF-2 Añadir primero los tests e2e y unitarios del rango de precio (sin fechas, con fechas,
  un solo extremo, límites inválidos, paginación y compatibilidad) y después extender
  `catalogQuerySchema` y `searchRows` con `minPriceUsd`/`maxPriceUsd` sobre `order_price`.
  Prueba: catalog › "Rango sin fechas", "Rango con fechas", "Un solo extremo", "Límites inválidos",
  "Paginación dentro del filtro" y "Sin filtro de precio".

## 2. Web

- [x] T-PRF-3 Helpers puros de la web (`buildCatalogQuery`, formato USD/VES con fecha valor y
  resolución de texto localizado) con tests unitarios primero, sin dependencias nuevas.
  Prueba: catalog › "Rango sin fechas" y exchange-rates › "Visitante sin sesión" (presentación).
- [x] T-PRF-4 `TodayRateBadge` en `SiteHeader`, con claves es/en y test de render para tasa disponible
  y no disponible. Revisar foco, etiquetas y contraste del badge.
  Prueba: exchange-rates › "Visitante sin sesión" y "Sin tasa global".
- [x] T-PRF-5 Página `/[locale]/buscar` con buscador, filtros de destino/tipo/precio, resultados
  USD+VES, estados vacíos y tipos futuros deshabilitados; actualizar los wireframes de búsqueda con
  esa nota y marcar T-F1-13a como terminada. Textos es/en y accesibilidad de teclado.
  Prueba: catalog › "Rango sin fechas", "Sin filtro de precio" y "Sin resultados" (spec base).

## 3. Verificación

- [x] T-PRF-6 Verificación integral: `node scripts/check-specs.mjs`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test` y comprobación manual de la ruta `/es/buscar` con la agencia demo sembrada.
  Prueba: salida en verde de los cuatro comandos y resultados visibles con los filtros aplicados.

## Workflow follow-up

- Solicitar revisión del dueño y archivar la change cuando todos los escenarios tengan test.
- Hacer `git push` de los commits locales al terminalizar.
