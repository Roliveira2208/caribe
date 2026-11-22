# Verificación final de `f1-hotels-e2e` (T-F1-16)

- **Fecha:** 2026-11-22.
- **Alcance:** cierre de F1 en conversación limpia: verificación independiente, revisión de seguridad,
  trazabilidad de specs y archivado. No se leyó ni imprimió `.env` (solo `.env.example`).
- **Código revisado:** `main`, commits `9add12c` (e2e/k6), `738db38` (SDD) y los cambios de cierre de
  esta tarea. Sin `git push`.

## Semáforo

| Área | Estado | Evidencia |
| --- | --- | --- |
| Tareas | 🟢 | `tasks.md`: `T-F1-0`…`T-F1-17` marcadas `[x]`, con evidencia por tarea. |
| OpenSpec | 🟢 | `pnpm exec openspec archive f1-hotels-e2e --yes --json` → `specsUpdated: true` (+42, ~23). Tras el archivado, `pnpm exec openspec validate --all` → `Totals: 12 passed, 0 failed (12 items)`. Solo warnings no bloqueantes por secciones que no se conservan al archivar. |
| Lint y typecheck | 🟢 | `pnpm lint` (4/4 tareas) y `pnpm typecheck` (5/5 tareas). |
| Tests | 🟢 | `pnpm test` final: **5/5 tareas**, API 48 archivos / 640 pruebas en 339,83 s y web 18 archivos / 122 pruebas. Antes apareció `Hook timed out in 30000ms` en `tenant-settings.e2e.ts`; aislado pasó 24/24 y con `hookTimeout: 60_000` la suite completa quedó limpia. |
| E2E de negocio | 🟢 | `pnpm --filter @caribe/web test:e2e` → 2/2; `docs/plans/f1-hotels-e2e-verification.md`. Concurrencia real en `apps/api/test/bookings.e2e.ts` › «crea exactamente una reserva cuando dos clientes compiten por el último cupo». |
| Trazabilidad specs ↔ tests | 🟢 | Matriz por dominio abajo; matriz escenario a escenario de `verification-10b.md` actualizada con los tres deltas posteriores y los archivos de prueba reales. Conteo final: 291 escenarios, 194 obligatorios y 97 deseables (`scope.md`). |
| Seguridad | 🟡 | Sin hallazgos críticos ni altos. Tres riesgos medios nuevos y M1/M2 heredados: cierre local seguro, demo pública condicionada. |
| k6 | 🟢 | `scripts/k6/f1-hotels-e2e.js` entregado; ejecución manual documentada. El binario k6 no está instalado en este entorno, por lo que no se simuló su resultado. |

## Correcciones realizadas durante la verificación

1. **`pnpm test` rojo por configuración de Vitest.** El spec de Playwright
   `apps/web/e2e/f1-hotels-e2e.spec.ts` era recogido por `vitest run`, que lanzaba
   `Playwright Test did not expect test() to be called here`. `apps/web/vitest.config.ts` ahora limita
   `include` a `test/**/*.test.{ts,tsx}`; el e2e sigue corriendo con `test:e2e`.
2. **Conteos de alcance desalineados.** `scope.md` y `tasks.md` seguían con 281/188/93. Se añadió el
   delta `web-ui` (3 escenarios: 2 obligatorios y 1 deseable) y el total final es **291/194/97**.
3. **Evidencia obsoleta del informe intermedio.** `verification-10b.md` citaba
   `auth-access.e2e.ts` (inexistente) y marcaba documentos y notificaciones como «no evaluables» por ser
   posteriores a T-F1-10b. En el cierre ya están implementados y probados; la correspondencia final
   está en la matriz siguiente.
4. **Flake de arranque de la suite API.** `Hook timed out in 30000ms` apareció en `beforeAll` de
   `api-errors.e2e.ts`, `notifications.e2e.ts` y `tenant-settings.e2e.ts` en corridas completas
   sucesivas; cada archivo pasó aislado. `apps/api/vitest.config.mts` usa `hookTimeout: 60_000` para
   absorber la carga sin relajar `testTimeout`.

## Matriz final por delta

| Delta | Escenarios (obl./des.) | Evidencia principal |
| --- | --- | --- |
| `api-errors` | 17 (10/7) | `apps/api/test/api-errors.e2e.ts`, `api-errors.test.ts`; 422 estricto, `cardNumber` rechazado y no devuelto. |
| `audit` | 24 (13/11) | `apps/api/test/audit.e2e.ts`, `audit-sanitize.test.ts`, `auth-events.e2e.ts`; reversión y sanitización. |
| `auth-access` | 32 (28/4) | `apps/api/test/access.test.ts`, `active-membership.e2e.ts`, `products-admin.e2e.ts`, `two-factor.e2e.ts`, `auth.e2e.ts`, `admin-route.test.ts`. Sustituye la referencia inexistente a `auth-access.e2e.ts`. |
| `booking` | 51 (34/17) | `apps/api/test/bookings.e2e.ts` (carrera por el último cupo), `cancellations.e2e.ts` (política y reembolso congelados), `booking-code.test.ts`, `cancellation-policy.test.ts`. |
| `catalog` | 36 (19/17) | `apps/api/test/catalog-api.e2e.ts`, `catalog-pricing.test.ts`, `catalog-query.test.ts`, `catalog-mappers.test.ts`, `public-rate.e2e.ts`. |
| `documents` | 23 (12/11) | `apps/api/test/documents-issuance.e2e.ts`, `documents-lifecycle.e2e.ts`, `documents-list.e2e.ts`, `documents-download.e2e.ts`, `documents-integration.e2e.ts`, `documents-render.test.ts`, `documents-path.test.ts`. Sustituye las filas «T-F1-11 pendiente» de `verification-10b.md`. |
| `exchange-rates` | 24 (18/6) | `apps/api/test/exchange-rates.e2e.ts`, `rates.test.ts`, `public-rate.e2e.ts`, `cancellations.e2e.ts` (tasa congelada en reembolso). |
| `notifications` | 13 (2/11) | `apps/api/test/notifications.e2e.ts`, `notifications.test.ts`, `mailpit.test.ts`. Sustituye las filas «T-F1-12 pendiente» de `verification-10b.md`. |
| `payments` | 35 (26/9) | `apps/api/test/payments.e2e.ts`, `payments.test.ts`, `api-errors.e2e.ts`; AUTO, validación estricta y tasa congelada. |
| `tenant-isolation` | 33 (30/3) | `apps/api/test/tenant.e2e.ts`, `transactions.e2e.ts`, `database.test.ts`, `tenant-context.test.ts`, `tenant-settings.e2e.ts`; RLS y contextos `owner`/`public`/`rates_global`. |
| `web-ui` | 3 (2/1) | `apps/web/e2e/f1-hotels-e2e.spec.ts`, `apps/web/test/routing.test.ts`, `apps/web/src/app/[locale]/reservas/[code]/page.tsx`, `apps/web/test/messages.test.ts`. |

La matriz escenario a escenario de `verification-10b.md` sigue siendo la base de trazabilidad para los
primeros diez deltas; se considera actualizada por las sustituciones de esta tabla y por el nuevo delta
`web-ui`. Los números de `scope.md` son la referencia de cierre (291/194/97).

## Revisión de seguridad final

Ejecutada como `/security-review` en conversación limpia y solo de lectura. **Sin hallazgos críticos ni
altos.** Controles confirmados: SQL parametrizado con `Prisma.sql`, RLS forzada y GUC con fallo cerrado,
`SELECT ... FOR UPDATE` para cupo, `Prisma.Decimal`/`ROUND_HALF_UP` y cálculo en servidor, esquemas
Zod sin tarjeta/montos/tasas del cliente, idempotencia transaccional, guard global de `/admin`, TOTP,
descarga autenticada sin `file_url`, secretos solo en `process.env`, auditoría inmutable y sanitizada,
sin XSS/innerHTML, y `minimatch >= 11.0.1` ya resuelto en el lockfile.

### Riesgos medios nuevos (deuda para la siguiente change)

| ID | Riesgo | Ubicación | Disposición |
| --- | --- | --- | --- |
| F-FINAL-001 | `provider` recibe `tenantId` en el guard de documentos y puede listar/descargar PDFs de cualquier reserva de la agencia; no hay cruce entre agencias, pero sí más alcance que «solo los suyos» en la matriz aprobada. | `apps/api/src/documents/documents.guard.ts:69-75`, `apps/api/src/access.ts:104-108`, `document-list.service.ts:47-62`, `document-download.service.ts:33-49`. | Documentado como pendiente de decisión; no bloquea el cierre local. Filtrar por `product_id` del proveedor o quitar `tenantId` en una change con su escenario GIVEN/WHEN/THEN. |
| F-FINAL-002 | Sin rate limiting en rutas de negocio (`POST /bookings`, pagos, descargas); solo Better Auth tiene límites. | `apps/api/src/auth.ts:153-161`; controladores sin `@Throttle`. | Registrar `ThrottlerModule` o reglas de firewall antes de demo pública. |
| F-FINAL-003 | El reembolso en el proveedor se confirma antes de persistirlo dentro de la transacción; con un proveedor real, un rollback dejaría un reembolso externo sin registro. | `apps/api/src/payments/payments.service.ts:630-660`, `bookings.service.ts:552`. | Seguro hoy porque el proveedor es simulado. Llevar a outbox o `refundId` idempotente con reconciliación al conectar un proveedor real. |
| Bajo | La aprobación manual no captura en pasarela. | `apps/api/src/payments/payments.service.ts:450-474`. | Límite explícito del MVP de pagos simulados. |

### Heredados, siguen abiertos

- **M1**: `trustedProxies` al decidir hosting; la IP tras proxy resuelve a null y el rate limit de login
  degenera en bucket global (`apps/api/src/auth.ts:38,48-53`).
- **M2**: Helmet, CSP y CORS antes de cualquier demo pública (faseados en F5 por el SDD §13).

## Veredicto

**`f1-hotels-e2e` archivada el 2026-11-22 como `2026-11-22-f1-hotels-e2e`; F1 cerrado en entorno local.** No hay regresiones críticas ni altas,
los invariantes del SDD se cumplen y las gates están en verde. La demo pública queda condicionada a M1,
M2, F-FINAL-001, F-FINAL-002 y F-FINAL-003; este último se resuelve al sustituir el proveedor simulado.
OpenAPI/Swagger siguen diferidos y k6 queda como ejecución manual documentada.
