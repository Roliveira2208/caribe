# Verificación de F1: recorrido e2e y carga (T-F1-15)

## Playwright (ejecutado)

Requiere API y web levantadas con la base sembrada. Se usaron puertos propios
(3102/3100) porque 3000/3002 estaban ocupados por otro proyecto:

```sh
pnpm --filter @caribe/api build
# API en 3102 con WEB_URL=http://localhost:3100
WEB_URL=http://localhost:3100 API_URL=http://localhost:3102 pnpm --filter @caribe/web dev -- -p 3100
CARIBE_API_URL=http://localhost:3102 CARIBE_WEB_URL=http://localhost:3100 \
  pnpm --filter @caribe/web test:e2e
```

Resultado (2026-11-22): `2 passed (9.2s)`; informe JSON en
`apps/web/f1-hotels-e2e-results.json`.

1. **buscar, reservar, pagar y ver documentos sin enlaces falsos**: catálogo,
   disponibilidad y tasa reales; reserva y pago simulados con los contratos
   estrictos; comprueba que el cuerpo de pago no contiene tarjeta, montos ni
   tasas, que la confirmación muestra «Documento no fiscal» y que no aparece
   ningún enlace de descarga sin documento `READY`.
2. **el detalle de Mis viajes congela la política y la descarga**: comprueba la
   política guardada, el reembolso estimado calculado en servidor y un único
   enlace `Descargar PDF` para un documento `READY`.

Durante esta prueba se detectó y corrigió un fallo real: las plantillas i18n con
marcadores (`tripsTotalUsd`, `tripsPolicyRule`, `tripsRefundUsd`,
`tripsRefundVes` y `tripsRefundEstimatePercentage`) se resolvían con `t()` sin
valores, por lo que la vista mostraba la clave cruda. Ahora usan `t.raw()`.

## Concurrencia de cupo (ejecutada en e2e de API)

`apps/api/test/bookings.e2e.ts` › «crea exactamente una reserva cuando dos
clientes compiten por el último cupo» cubre el `SELECT ... FOR UPDATE` con
PostgreSQL y Redis reales: una respuesta 201 y otra 409, sin sobreventa.

## k6 (script entregado, ejecución manual pendiente)

`scripts/k6/f1-hotels-e2e.js` mide búsqueda + reserva con 5 VU durante 30 s,
usa `Idempotency-Key` por VU e iteración y verifica que el cliente nunca envía
montos ni tasas. k6 **no está instalado** en este entorno (`Get-Command k6` sin
resultado), así que no se ha ejecutado aquí; su ejecución queda documentada
para el entorno de carga:

```sh
CARIBE_API_URL=http://localhost:3102 \
CARIBE_E2E_COOKIE='better-auth.session_token=...' \
CARIBE_PRODUCT_ID=<uuid publicado con cupo> \
k6 run --vus 5 --duration 30s scripts/k6/f1-hotels-e2e.js
```

La cookie es de un usuario de demostración y solo se pasa por variable de
entorno: nunca se guarda en el repositorio.
