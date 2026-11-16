# T-F1-10b — Verificación independiente de f1-hotels-e2e

- **Fecha (evidencia):** 2026-11-16 (ejecuciones en `artifacts-*.txt`)
- **Commit:** `013b914` (`main`, sin cambios de código durante la verificación)
- **Estado git:** limpio salvo artefactos no rastreados `artifacts-*.txt` y este informe (`openspec/changes/f1-hotels-e2e/verification-10b.md`). No se realizaron commits, pushes ni cambios funcionales. **`T-F1-10b` permanece sin marcar `[x]` en `tasks.md` hasta entrega de este informe.**
- **Alcance:** verificación de solo lectura según `openspec/changes/f1-hotels-e2e/{tasks.md,scope.md,design.md,proposal.md}` y specs delta/base. No se leyó ni imprimió `.env` (solo `.env.example`).
- **Entorno:** Node v24.16.0, pnpm 12.18.0, Docker `caribe-postgres-1:5433` y `caribe-redis-1:6380` (healthy). No existe `.env` local; las pruebas usan variables inline de `apps/api/test/setup-env.ts` y defaults de `docker-compose.yml`. API tests en serie sobre BD compartida, sin `REDIS_URL` en pruebas (BullMQ deshabilitado en test).

## Resumen ejecutivo y semáforo

| Área | Estado | Evidencia / nota |
|---|---|---|
| Gates base (install/typecheck/lint/check-specs) | **VERDE** | `artifacts-install.txt`, `artifacts-typecheck.txt`, `artifacts-lint.txt`, `artifacts-check-specs.txt` (`OK: 8 specs válidas`) |
| Suite completa (≥2 limpias) | **VERDE** | Run 2 limpia y run 4 uncached limpia: `@caribe/api` 31 archivos / 517 tests passed, 5/5 tareas (`artifacts-test-2.txt`, `artifacts-test-4-uncached.txt`, 321.79s). Run 3 uncached **incompleta/no concluyente** sin resumen final, cortada en `catalog-api.e2e.ts` (`artifacts-test-3-uncached.txt`, 150424 bytes). Run 3 turbo-cached (`artifacts-test-3.txt`) no contabilizada como ejecución fresca. |
| Concurrencia dedicada (2–3 repeticiones) | **VERDE** | 3 ejecuciones limpias de `bookings.e2e.ts`, `payments.e2e.ts`, `cancellations.e2e.ts`, `exchange-rates.e2e.ts`: 4 files / 111 tests passed cada una (`artifacts-concurrency-1.txt` 114.35s, `artifacts-concurrency-2.txt` 44.01s, `artifacts-concurrency-3.txt`, tail con warns esperados de tasa). Sin fallos ni flakes observados; logs esperados de fallos simulados/circuit breaker en escenarios de prueba. |
| Dinero / Decimal / tasa congelada / 422 / redondeo | **VERDE** | `payments.service.ts`, `bookings.service.ts`, `exchange-rate.service.ts`, `packages/shared` esquemas/serialización, migraciones/triggers de congelamiento e inmutabilidad (`payments_frozen`, `booking_items` frozen fields), `payments.e2e.ts`, `bookings.e2e.ts`, `exchange-rates.e2e.ts`, `transactions.e2e.ts`, `database.test.ts`, `api-errors.e2e.ts`, `artifacts-card-cvv.txt`. Montos/tasas calculados en servidor, `amount_ves` ROUND_HALF_UP, `exchange_rate_id`/pares congelados. |
| Tenancy / RLS / GUC / aislamiento | **VERDE** | `tenant.service.ts` contextos (`tenant/owner/platform/public/rates_global`), `caribe_app rolbypassrls=f` (`artifacts-db-rls.txt`), inventario RLS/forced y políticas incl. `exchange_rates`/`idempotency_keys`/tablas `*_platform` (`artifacts-db-rls-full.txt`, `artifacts-db-exchange-rates.txt`, `artifacts-db-policies-exchange-rates.txt`), `transactions.e2e.ts`, `tenant.e2e.ts`, `database.test.ts`, `products-admin.e2e.ts`. |
| Concurrencia/estado/expiración/idempotencia | **VERDE** | `FOR UPDATE` / `SKIP LOCKED`, `idempotency.ts`, máquinas de estado y transacciones en `bookings.service.ts`, `payments.service.ts`, `booking-expiration.service.ts`, `jobs.scheduler.ts`; e2e `bookings.e2e.ts`, `payments.e2e.ts`, `cancellations.e2e.ts`, `transactions.e2e.ts` y 3 corridas de concurrencia limpias. |
| Auth / guards / IDOR / inventario rutas / plugins / token auth | **VERDE (con observación)** | Plugins Better Auth cerrados a `organization, admin, twoFactor` (`artifacts-betterauth-plugins.txt`, `apps/api/src/auth.ts`). Sin bearer/API-key/OAuth/SSO auth entrante en API (`artifacts-token-auth-grep.txt`, búsqueda en `apps/api/src`). Inventario de controladores/rutas y clasificación admin cerrada (`artifacts-routes.txt`, `artifacts-controllers.txt`, `apps/api/src/admin/admin-route.ts`, `apps/api/test/auth*.e2e.ts`, `apps/api/test/tenant.e2e.ts`). Cotizave usa `x-api-key` **saliente** desde env, no URL (`apps/api/src/rates/cotizave.provider.ts`). |
| Validación / abuso (422, campos calculados, card/CVV, idempotency) | **VERDE** | `ZodValidationPipe` estricto, `api-errors.e2e.ts`, `payments.e2e.ts`, `bookings.e2e.ts`, `audit-sanitize.ts` (`cardNumber/pan/cvv`), `artifacts-card-cvv.txt`, `idempotency/idempotency.ts`. |
| T-F1-5b Cotizave / lazy refresh / sin fuga de clave | **VERDE** | Refresco perezoso en sesión/pago (`apps/api/src/auth.ts`, `exchange-rate.service.ts`), sin trabajo BullMQ de tasa (`jobs.scheduler.ts`, `apps/api/test/jobs.e2e.ts`), clave solo env+header (`cotizave.provider.ts`), `ctz_live_` solo placeholder/tests (`artifacts-ctz-live-grep.txt`, `artifacts-ctz-live-log.txt`, `.env.example`, `setup-env.ts`). |
| Secretos / deps / config | **AMARILLO** | Sin `.env`; `.env.example` con placeholders (`artifacts-env-example.txt`); `pnpm-workspace.yaml` conserva `allowBuilds.esbuild: true` (`artifacts-workspace-builds.txt`); `pnpm audit --prod` reporta 1 **moderate** `minimatch < 11.0.1` (`GHSA-g3hv-75wg-m249`, parche `>=11.0.1`, 31 rutas, `artifacts-audit-prod.txt`). |
| DB integridad / migraciones | **VERDE** | `prisma migrate status` al día, 10 migraciones (`artifacts-migrate-status.txt`), RLS/constraints/triggers/frozen fields (`database.test.ts`, `transactions.e2e.ts`, migraciones). |
| Cobertura 188 obligatorios / 93 deseables | **AMARILLO** | Suite completa y suites de dominio limpias (517 tests API) cubren las áreas de los 188 obligatorios según `scope.md` y tareas; matriz exhaustiva por escenario incluida abajo anclada a `scope.md`. Discrepancia de conteo: deltas actuales contienen 288 escenarios totales (17/24/32/51/36/23/24/13/35/33) vs 281/188/93 declarados en `scope.md`; la matriz marca obligatorios por la clasificación de `scope.md` y señala diferencias donde el título exacto no aparece 1:1. Deseables/áreas F2 fuera de alcance no bloquean. |
| Docs/spec/SDD y desviaciones §15 | **AMARILLO** | Alineación general observada en implementación/pruebas y tareas cerradas; persisten desviaciones conocidas y pendientes documentadas (`design.md` §15 → T-F1-17, M1/M2, F2/aplazables). |

## Veredicto (Go/No-Go para T-F1-11)

**GO condicionado para continuar con T-F1-11 (documentos), con observaciones no bloqueantes registradas.**

- **Criterios de calidad/gates cumplidos:** install/typecheck/lint/check-specs en verde; suite completa limpia 2 veces (run 2 y run 4 uncached); concurrencia dedicada 3/3 limpia; migraciones al día; `caribe_app` sin `rolbypassrls`.
- **Criterios funcionales/de seguridad críticos de F1 observados en evidencia:** dinero Decimal/calculado en servidor/congelado, 422 en campos calculados y datos sensibles de tarjeta, RLS/GUC/aislamiento, máquinas de estado/concurrencia/idempotencia/expiración, auth/roles/2FA admin route inventory sin plugins/token auth no aprobados, Cotizave lazy refresh sin clave expuesta en código/config versionada.
- **No bloquea T-F1-11 pero debe gestionarse:** vulnerabilidad moderada `minimatch` en dependencias prod (`GHSA-g3hv-75wg-m249`, `artifacts-audit-prod.txt`) — evaluar actualización/aceptación antes de demo/cierre; M1 `trustedProxies` y M2 Helmet/CSP/CORS siguen abiertos (F5/demo pública); reconciliar conteos/títulos `scope.md` vs deltas (288 vs 281 escenarios) y mantener `design.md` §15 → T-F1-17; deseables/F2 no implementados según `scope.md`.

## Método y evidencia

- **Comandos/gates:** `pnpm install --frozen-lockfile` (`artifacts-install.txt`), `pnpm typecheck` (`artifacts-typecheck.txt`), `pnpm lint` (`artifacts-lint.txt`), `node scripts/check-specs.mjs` (`artifacts-check-specs.txt`), suite `pnpm test`/turbo (runs 2/3/4 en `artifacts-test-*.txt`), concurrencia `pnpm --filter @caribe/api exec vitest run test/bookings.e2e.ts test/payments.e2e.ts test/cancellations.e2e.ts test/exchange-rates.e2e.ts` x3 (`artifacts-concurrency-{1,2,3}.txt`), `prisma migrate status` (`artifacts-migrate-status.txt`), SQL RLS/policies en `caribe-postgres-1` (`artifacts-db-rls.txt`, `artifacts-db-rls-full.txt`, `artifacts-db-exchange-rates.txt`, `artifacts-db-policies-exchange-rates.txt`), `pnpm audit --prod` (`artifacts-audit-prod.txt`), `git grep/git log -S ctz_live_` (`artifacts-ctz-live-grep.txt`, `artifacts-ctz-live-log.txt`), inventarios/barridos (`artifacts-routes.txt`, `artifacts-controllers.txt`, `artifacts-betterauth-plugins.txt`, `artifacts-token-auth-grep.txt`, `artifacts-card-cvv.txt`, `artifacts-workspace-builds.txt`, `artifacts-env-example.txt`).
- **Lectura de código/specs (muestra clave):** `apps/api/src/auth.ts`, `admin/admin-route.ts`, `tenant/tenant.service.ts`, `bookings/bookings.service.ts`, `payments/payments.service.ts`, `rates/exchange-rate.service.ts`, `rates/cotizave.provider.ts`, `jobs/jobs.scheduler.ts`, `jobs/booking-expiration.service.ts`, `audit/audit-interceptor.ts`, `audit/audit-sanitize.ts`, `idempotency/idempotency.ts`, controladores, `apps/api/prisma/schema.prisma` y migraciones; specs delta `openspec/changes/f1-hotels-e2e/specs/*/spec.md`; tests `apps/api/test/*.ts,*.e2e.ts`.
- **Suite API (run 4):** 31 archivos, 517 tests passed, 321.79s (`artifacts-test-4-uncached.txt`). Run 2 idéntico en conteo (`artifacts-test-2.txt`). Run 3 uncached terminó sin resumen tras actividad en `api-errors.e2e.ts`/inicio de `catalog-api.e2e.ts` (`artifacts-test-3-uncached.txt`) — tratado como ejecución no concluyente, no como fallo funcional demostrado.
- **Concurrencia:** 4 archivos/111 tests passed en cada repetición (`artifacts-concurrency-1.txt`, `artifacts-concurrency-2.txt`, `artifacts-concurrency-3.txt`), incluyendo escenarios de `AVAILABILITY_EXHAUSTED`, idempotencia en vuelo/replay/conflicto, carreras de revisión/expiración/cancelación/pago y refresco lazy de tasa.

## Hallazgos

### F-10B-001 (Bajo, proceso/evidencia, cerrado para criterio de gate) — Run 3 uncached no concluyente
- **Evidencia:** `artifacts-test-3-uncached.txt` (150424 bytes, estable 12:09:55) finaliza en arranque de `test/catalog-api.e2e.ts` tras `api-errors.e2e.ts` sin bloque `Test Files/Tests` final. Runs 2 y 4 completas y limpias (`artifacts-test-2.txt`, `artifacts-test-4-uncached.txt`).
- **Impacto:** la repetición específica no aporta resultado; no invalida las dos corridas limpias completas.
- **Recomendación:** mantener registro como no concluyente; no requiere corrección de código salvo recurrencia.

### F-10B-002 (Medio, dependencias, abierto/no bloqueante T-F1-11) — Vulnerabilidad moderada en `minimatch`
- **Evidencia:** `pnpm audit --prod` (`artifacts-audit-prod.txt`): 1 moderate `GHSA-g3hv-75wg-m249` "minimatch: nested extglobs can cause ReDoS", vulnerable `<11.0.1`, parche `>=11.0.1`, 31 rutas de dependencia.
- **Impacto:** riesgo de cadena de suministro/DoS por patrón en dependencias afectadas; explotabilidad en runtime/API no evaluada en profundidad en esta verificación.
- **Recomendación:** evaluar `pnpm update`/overrides a versión parcheada con regresión de tests antes de cierre/demo pública; si se difiere, documentar aceptación formal.

### F-10B-003 (Bajo, trazabilidad documental, abierto/no bloqueante) — Discrepancia de conteos/títulos scope vs deltas
- **Evidencia:** `scope.md` declara 281/188/93 y totales por spec (api-errors 17, audit 24, auth-access 30, booking 48, catalog 36, documents 23, exchange-rates 24, notifications 13, payments 35, tenant-isolation 31). Conteo actual de `#### Scenario:` en deltas: 288 totales (17/24/32/51/36/23/24/13/35/33) (`Select-String` sobre `openspec/changes/f1-hotels-e2e/specs/*/spec.md`). Algunos nombres de `scope.md` no coinciden literalmente 1:1 con títulos de escenarios actuales (p.ej. variaciones de redacción en auth-access/booking/tenant-isolation).
- **Impacto:** dificulta trazabilidad automática exacta; no se observó pérdida funcional en suites correspondientes.
- **Recomendación:** reconciliar `scope.md`/deltas en la tarea de documentación/archivo o como nota de verificación; mantener matriz anclada a `scope.md` para obligatoriedad de cierre.

### Observaciones positivas (evidenciadas)
- **RLS y tenancy:** `caribe_app` sin bypass; tablas de negocio con RLS forzada y políticas por contexto (`artifacts-db-*.txt`, `tenant.service.ts`, `transactions.e2e.ts`, `database.test.ts`, `tenant.e2e.ts`).
- **Dinero/tasas:** `Prisma.Decimal`/cadenas, cálculo en servidor, congelamiento de `exchange_rate_id`/`amount_ves`/snapshot, redondeo half-up, rechazo 422 de campos calculados (`payments.service.ts`, `exchange-rate.service.ts`, `api-errors.e2e.ts`, `payments.e2e.ts`, `exchange-rates.e2e.ts`).
- **Concurrencia e integridad:** bloqueos/estado transaccional, idempotencia, expiración con `SKIP LOCKED`, revisiones concurrentes y carreras cubiertas en e2e/concurrency runs (`bookings.e2e.ts`, `payments.e2e.ts`, `cancellations.e2e.ts`, `transactions.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt`).
- **Auth/permisos:** Better Auth limitado a plugins aprobados; rutas admin/TOTP/inventario y sin auth por token entrante no aprobada (`auth.ts`, `admin-route.ts`, `artifacts-betterauth-plugins.txt`, `artifacts-token-auth-grep.txt`, `auth*.e2e.ts`).
- **Datos sensibles:** rechazo/sanitización de `cardNumber/pan/cvv`, sin `ctz_live_` real versionado (`audit-sanitize.ts`, `artifacts-card-cvv.txt`, `artifacts-ctz-live-*.txt`).

## Checklist de seguridad

| Control | Estado | Evidencia |
|---|---|---|
| Sin `.env` leído/impreso/versionado; `.env.example` placeholders | **OK** | verificación de sesión; `artifacts-env-example.txt`, `artifacts-env-files.txt` |
| `ctz_live_` solo placeholder/fixtures/tests | **OK** | `artifacts-ctz-live-grep.txt`, `artifacts-ctz-live-log.txt`, `apps/api/test/setup-env.ts` |
| Clave Cotizave solo por env, enviada en header saliente, no en URL/respuesta | **OK (observado)** | `apps/api/src/rates/cotizave.provider.ts` (`process.env.COTIZAVE_API_KEY`, `x-api-key`), `artifacts-routes.txt`/controladores sin exposición de clave, `exchange-rates.e2e.ts` |
| No tarjeta/CVV/PAN aceptados ni persistidos | **OK** | `apps/api/src/audit/audit-sanitize.ts`, `artifacts-card-cvv.txt`, `payments.e2e.ts`, `api-errors.e2e.ts` |
| Sin plugins/token auth Better Auth no aprobados | **OK** | `apps/api/src/auth.ts` (`organization/admin/twoFactor`), `artifacts-betterauth-plugins.txt`, `artifacts-token-auth-grep.txt`, `apps/api/src/admin/admin-route.ts` |
| RLS forzada, GUC y rol app sin bypass | **OK** | `artifacts-db-rls.txt`, `artifacts-db-rls-full.txt`, `artifacts-db-policies-exchange-rates.txt`, `apps/api/src/tenant/tenant.service.ts`, `transactions.e2e.ts`, `database.test.ts` |
| Auditoría de acciones sensibles/inmutable/sanitizada | **OK (observado)** | migraciones/triggers de auditoría, `audit-interceptor.ts`, `audit-sanitize.ts`, `audit.e2e.ts`, `auth-events.e2e.ts` |
| Dependencias prod auditadas | **AMARILLO** | `artifacts-audit-prod.txt` (`minimatch` moderate) |
| Secretos en logs/auditoría | **OK (observado, muestreo)** | sanitización y barridos; no se observó `ctz_live_` real ni datos de tarjeta en evidencia revisada |

## Riesgos aceptados / diferidos

- **F2 / fuera de F1 (según `scope.md`):** avisos adicionales, nota de reembolso en PDF, PDF voucher en inglés, reintento manual de documentos, reembolsos parciales múltiples, retención por producto, almacenamiento externo firmado, etc.; 93 escenarios deseables no bloqueantes.
- **Pendientes conocidos:** M1 `trustedProxies` (hosting), M2 Helmet/CSP/CORS antes de demo pública (`design.md`/`tasks.md` notas heredadas).
- **T-F1-17:** aplicar desviaciones canónicas de `design.md` §15 al SDD (sin cambiar D1–D15).
- **Run 3 uncached:** ejecución incompleta no concluyente, sin fallo funcional demostrado.

## Matriz de escenarios obligatorios (188, anclada a `scope.md`)

> **Método:** cada escenario obligatorio listado en `scope.md` se mapea a su spec y a evidencia principal (test(s)/archivo(s)/artefacto(s)). Estado: **Cubierto** = evidencia directa observada en suite/e2e/tests de dominio; **Cubierto (indirecto)** = cubierto por contrato/guardas transversales y suites relacionadas pero sin test nombrado literalmente igual al título de `scope.md`; **Pendiente** = sin evidencia localizada. Los 188 obligatorios bloquean F1; deseables se omiten salvo nota. Conteos/títulos pueden diferir respecto de los deltas actuales (F-10B-003).

### api-errors — 10 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Sin sesión | `apps/api/test/api-errors.e2e.ts`, `auth.e2e.ts`, `bookings.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Sin permiso | `apps/api/test/api-errors.e2e.ts`, `auth-access.e2e.ts`, `products-admin.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Cupo agotado | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt` (`AVAILABILITY_EXHAUSTED`) | Cubierto |
| Reserva vencida | `apps/api/test/payments.e2e.ts`, `bookings.e2e.ts` (`HOLD_EXPIRED`/410) | Cubierto |
| Sin tasa | `apps/api/test/exchange-rates.e2e.ts`, `catalog-api.e2e.ts`, `payments.e2e.ts` (`RATE_UNAVAILABLE`) | Cubierto |
| Campo desconocido | `apps/api/test/api-errors.e2e.ts` (422/VALIDATION_ERROR, strict Zod) | Cubierto |
| Monto, tasa o campo calculado enviado por el cliente | `apps/api/test/api-errors.e2e.ts`, `payments.e2e.ts`, `bookings.e2e.ts` | Cubierto |
| Monto con dos decimales | `apps/api/test/api-errors.e2e.ts`, `payments.e2e.ts` (serialización cadenas) | Cubierto |
| Tasa con cuatro decimales | `apps/api/test/api-errors.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| Recurso de otra agencia | `apps/api/test/api-errors.e2e.ts`, `auth-access.e2e.ts`, `tenant.e2e.ts`, `transactions.e2e.ts` (404 cross-tenant) | Cubierto |

### audit — 13 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Admin aprueba un pago | `apps/api/test/audit.e2e.ts`, `payments.e2e.ts`, `audit-interceptor.ts` | Cubierto |
| Cliente crea una reserva | `apps/api/test/audit.e2e.ts`, `bookings.e2e.ts` | Cubierto |
| Expiración de una reserva | `apps/api/test/bookings.e2e.ts`, `cancellations.e2e.ts`/booking-expiration flows, `booking-expiration.service.ts` | Cubierto |
| Cambio de ajustes de la agencia | `apps/api/test/tenant-settings.e2e.ts`/`audit.e2e.ts`, `tenant-settings.controller.ts` | Cubierto |
| Agente consulta auditoría | `apps/api/test/audit.e2e.ts`, `auth-access.e2e.ts` (rol/permisos) | Cubierto |
| Rechazo por falta de segundo factor | `apps/api/test/auth-events.e2e.ts`, `two-factor.e2e.ts`, `apps/api/src/auth.ts` hooks | Cubierto |
| Sin sesión | `apps/api/test/audit.e2e.ts`, `auth-events.e2e.ts` | Cubierto |
| Sin secretos en el evento | `apps/api/src/audit/audit-sanitize.ts`, `apps/api/test/audit.e2e.ts`, `artifacts-card-cvv.txt` | Cubierto |
| Evento de plataforma | `apps/api/test/audit.e2e.ts`, `auth-events.e2e.ts` | Cubierto |
| Evento de agencia | `apps/api/test/audit.e2e.ts` | Cubierto |
| Admin de agencia no ve eventos de plataforma | `apps/api/test/audit.e2e.ts`, `transactions.e2e.ts` (RLS contextos) | Cubierto |
| Agente no lee eventos | `apps/api/test/audit.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Super Admin consulta todos | `apps/api/test/audit.e2e.ts` | Cubierto |

### auth-access — 26 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Proveedor edita su producto | `apps/api/test/products-admin.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Proveedor edita producto de otro proveedor | `apps/api/test/products-admin.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Cliente ve solo sus reservas | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Super Admin intenta editar un producto | `apps/api/test/products-admin.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Super Admin intenta aprobar un pago | `apps/api/test/payments.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Admin de otra agencia | `apps/api/test/auth-access.e2e.ts`, `tenant.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Agente de otra agencia | `apps/api/test/auth-access.e2e.ts`, `bookings.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Prueba con el rol de aplicación | `apps/api/test/database.test.ts`, `transactions.e2e.ts`, `artifacts-db-rls.txt` (`caribe_app rolbypassrls=f`) | Cubierto |
| Operación de agencia sin agencia activa | `apps/api/test/auth-access.e2e.ts`, `tenant-settings.e2e.ts` (`ACTIVE_ORGANIZATION_REQUIRED`) | Cubierto |
| Elegir una agencia ajena | `apps/api/test/auth-access.e2e.ts` (Better Auth org selection constraints) | Cubierto (indirecto) |
| Reserva anónima | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts` (401) | Cubierto |
| Cliente reserva en una agencia | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Cliente con reservas en dos agencias | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Cliente en un endpoint de agencia | `apps/api/test/auth-access.e2e.ts`, `products-admin.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Cliente intenta fijar la agencia o el usuario | `apps/api/test/bookings.e2e.ts`, `api-errors.e2e.ts` (422 campos calculados/ajenos) | Cubierto |
| Proveedor edita su producto (propiedad) | `apps/api/test/products-admin.e2e.ts` | Cubierto |
| Proveedor edita el producto de otro proveedor | `apps/api/test/products-admin.e2e.ts` | Cubierto |
| Proveedor edita un producto de otra agencia | `apps/api/test/products-admin.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Admin edita un producto de su agencia | `apps/api/test/products-admin.e2e.ts` | Cubierto |
| Super Admin intenta publicar | `apps/api/test/products-admin.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Agente crea su propia reserva | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Agente intenta reservar para otra persona | `apps/api/test/bookings.e2e.ts` (422 `user_id` ajeno) | Cubierto |
| Admin ve las reservas de su agencia | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Admin cancela una reserva de su agencia | `apps/api/test/cancellations.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Super Admin intenta cancelar | `apps/api/test/cancellations.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Revisor distinto del pagador | `apps/api/test/payments.e2e.ts`, `auth-access.e2e.ts` | Cubierto |

### booking — 33 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Hay cupo en todas las noches | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Falta una noche | `apps/api/test/bookings.e2e.ts`, `catalog-api.e2e.ts` | Cubierto |
| No hay cupo suficiente en una noche | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Reservas concurrentes sobre el último cupo | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt` | Cubierto |
| Sin sesión | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Monto, tasa o campo calculado enviados por el cliente | `apps/api/test/bookings.e2e.ts`, `api-errors.e2e.ts` | Cubierto |
| Producto no publicado | `apps/api/test/bookings.e2e.ts`, `catalog-api.e2e.ts` | Cubierto |
| Vence sin pago | `apps/api/test/bookings.e2e.ts`, `booking-expiration.service.ts` | Cubierto |
| Retención configurada | `apps/api/test/bookings.e2e.ts`, `tenant-settings.e2e.ts` | Cubierto |
| Retención por defecto | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Pago aprobado justo antes de vencer | `apps/api/test/payments.e2e.ts`, `bookings.e2e.ts` (carrera pago/expiración) | Cubierto |
| Pago tardío sobre reserva vencida | `apps/api/test/payments.e2e.ts` (`HOLD_EXPIRED`) | Cubierto |
| Expiración idempotente | `apps/api/test/bookings.e2e.ts`, `cancellations.e2e.ts` (expiración/skip) | Cubierto |
| Carrera entre pago y expiración | `apps/api/test/payments.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt` | Cubierto |
| Reintento del mismo POST | `apps/api/test/bookings.e2e.ts` (Idempotency-Key) | Cubierto |
| Misma clave con otro cuerpo | `apps/api/test/bookings.e2e.ts`, `idempotency/idempotency.ts` | Cubierto |
| Clave en vuelo | `apps/api/test/bookings.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt` | Cubierto |
| Respuesta guardada mínima | `apps/api/test/bookings.e2e.ts`, `idempotency/idempotency.ts` | Cubierto |
| Cliente cancela reserva confirmada | `apps/api/test/cancellations.e2e.ts` | Cubierto |
| Cancelar reserva ajena | `apps/api/test/cancellations.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Cancelar una reserva pendiente sin pago | `apps/api/test/cancellations.e2e.ts` | Cubierto |
| Cancelar con un pago en revisión | `apps/api/test/cancellations.e2e.ts` (`PAYMENT_IN_REVIEW`) | Cubierto |
| Política congelada | `apps/api/test/cancellations.e2e.ts`, `database.test.ts` (snapshot/frozen fields) | Cubierto |
| Formato y unicidad | `apps/api/test/bookings.e2e.ts`, `apps/api/test/bookings.test.ts` (código) | Cubierto |
| Código enviado por el cliente | `apps/api/test/bookings.e2e.ts`, `api-errors.e2e.ts` (422 campo calculado) | Cubierto |
| Sin datos personales en logs ni auditoría | `apps/api/src/audit/audit-sanitize.ts`, `audit.e2e.ts`, `bookings.e2e.ts` | Cubierto (observado) |
| Dueño consulta su reserva | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Personal consulta una reserva de su agencia | `apps/api/test/bookings.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Personal de otra agencia | `apps/api/test/bookings.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Mis reservas entre agencias | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Confirmar una reserva cancelada | `apps/api/test/bookings.e2e.ts`/estado transitions (409/invalid transition paths) | Cubierto (indirecto) |
| Fallo de auditoría | `apps/api/test/audit.e2e.ts`, `bookings.e2e.ts` (transacción/auditoría) | Cubierto |
| Transición no listada | `apps/api/test/bookings.e2e.ts`, `payments.e2e.ts` (`INVALID_STATE_TRANSITION`) | Cubierto |

### catalog — 19 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Filtro por destino y fechas | `apps/api/test/catalog-api.e2e.ts`, `catalog.e2e.ts` | Cubierto |
| Una noche sin cupo (búsqueda) | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Sin tasa disponible | `apps/api/test/catalog-api.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| Equivalente en VES | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Precio enviado por el cliente | `apps/api/test/api-errors.e2e.ts`, `catalog-api.e2e.ts`/contrato | Cubierto (indirecto) |
| Producto en borrador | `apps/api/test/catalog-api.e2e.ts`, `products-admin.e2e.ts` | Cubierto |
| Producto archivado | `apps/api/test/catalog-api.e2e.ts`, `products-admin.e2e.ts` | Cubierto |
| Producto con borrado lógico | `apps/api/test/catalog-api.e2e.ts`, `database.test.ts` | Cubierto |
| Hay cupo en todas las noches | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Falta una noche | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Una noche sin cupo (disponibilidad) | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Noche duplicada | `apps/api/test/database.test.ts`, `catalog-api.e2e.ts` (`AVAILABILITY_DUPLICATED`) | Cubierto |
| Precio o fechas inválidos | `apps/api/test/catalog-api.e2e.ts`, `database.test.ts` (CHECKs/Zod) | Cubierto |
| Total por noche y habitación | `apps/api/test/catalog-api.e2e.ts`, `catalog-pricing.test.ts` | Cubierto |
| Precio distinto por noche | `apps/api/test/catalog-api.e2e.ts`, `bookings.e2e.ts` (nightly_prices) | Cubierto |
| Detalle de un producto no público | `apps/api/test/catalog-api.e2e.ts` | Cubierto |
| Catálogo de dos agencias | `apps/api/test/catalog-api.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Sin datos internos | `apps/api/test/catalog-api.e2e.ts` (`public_availability`/DTOs públicos) | Cubierto |
| Escritura anónima | `apps/api/test/catalog-api.e2e.ts`, `auth-access.e2e.ts` | Cubierto |

### documents — 12 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Descargar voucher ajeno | `apps/api/src/*document*` (si implementado) / delta+tasks: T-F1-11 pendiente | **No evaluable en F1 actual (T-F1-11 pendiente)** |
| Numeración correlativa | T-F1-11 pendiente | **No evaluable** |
| Reintento del mismo pago | T-F1-11 pendiente | **No evaluable** |
| Descarga autenticada | T-F1-11 pendiente | **No evaluable** |
| Personal de la agencia descarga | T-F1-11 pendiente | **No evaluable** |
| Sin sesión | T-F1-11 pendiente | **No evaluable** |
| Documento de otra agencia | T-F1-11 pendiente | **No evaluable** |
| Nombre no adivinable | T-F1-11 pendiente | **No evaluable** |
| Ruta manipulada | T-F1-11 pendiente | **No evaluable** |
| Un voucher por reserva | T-F1-11 pendiente | **No evaluable** |
| Un comprobante por pago | T-F1-11 pendiente | **No evaluable** |
| Número único por agencia y tipo | T-F1-11 pendiente | **No evaluable** |

> **Nota:** `documents` (12 obligatorios) y su implementación corresponden a **T-F1-11**, explícitamente posterior a T-F1-10b (`tasks.md`). No son defectos del estado actual, pero permanecen fuera de evidencia ejecutable en esta verificación.

### exchange-rates — 18 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Fuente disponible | `apps/api/test/exchange-rates.e2e.ts`, `cotizave.provider.test.ts` | Cubierto |
| Fuente caída | `apps/api/test/exchange-rates.e2e.ts`, `cotizave.provider.test.ts` | Cubierto |
| Tasa inválida del proveedor | `apps/api/test/exchange-rates.e2e.ts`, `cotizave.provider.test.ts` | Cubierto |
| Override sin motivo o sin permiso | `apps/api/test/exchange-rates.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Precedencia del override | `apps/api/test/exchange-rates.e2e.ts` | Cubierto |
| El proveedor no pisa el override | `apps/api/test/exchange-rates.e2e.ts` | Cubierto |
| Override global gana a la tasa BCV | `apps/api/test/exchange-rates.e2e.ts` | Cubierto |
| Agencia no ve el override de otra | `apps/api/test/exchange-rates.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Catálogo público usa la tasa global | `apps/api/test/catalog-api.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| Pago usa el override de la agencia | `apps/api/test/payments.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| El refresco de la tasa no escribe overrides | `apps/api/test/exchange-rates.e2e.ts` | Cubierto |
| La tasa cambia después | `apps/api/test/payments.e2e.ts`, `exchange-rates.e2e.ts` (frozen) | Cubierto |
| Cálculo del monto en VES | `apps/api/test/payments.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| Redondeo half-up | `apps/api/test/exchange-rates.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Modificación directa del par congelado | `apps/api/test/database.test.ts`, `transactions.e2e.ts` (triggers/inmutabilidad) | Cubierto |
| Reembolso con la tasa congelada | `apps/api/test/cancellations.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Segundo login del mismo día no consulta | `apps/api/test/exchange-rates.e2e.ts`, `auth.e2e.ts` | Cubierto |
| Alta de pago asegura la tasa del día | `apps/api/test/exchange-rates.e2e.ts`, `payments.e2e.ts` | Cubierto |

### notifications — 2 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Destinatario único | T-F1-12 pendiente (módulo/escenarios de envío) | **No evaluable en F1 actual (T-F1-12 pendiente)** |
| Sin datos sensibles | T-F1-12 pendiente | **No evaluable** |

> **Nota:** `notifications` obligatorios pertenecen a T-F1-12 (posterior a T-F1-10b). No bloquean por implementación ausente en este punto salvo como dependencia futura de flujo completo.

### payments — 26 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Pago en VES por Pago Móvil | `apps/api/test/payments.e2e.ts` | Cubierto |
| Cliente envía un monto o una tasa | `apps/api/test/payments.e2e.ts`, `api-errors.e2e.ts` | Cubierto |
| Reserva vencida | `apps/api/test/payments.e2e.ts` | Cubierto |
| Reserva cancelada | `apps/api/test/payments.e2e.ts` | Cubierto |
| Reserva ya confirmada | `apps/api/test/payments.e2e.ts` | Cubierto |
| Pago de una reserva ajena | `apps/api/test/payments.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Sin sesión | `apps/api/test/payments.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Modo AUTO | `apps/api/test/payments.e2e.ts` | Cubierto |
| Modo MANUAL aprobado | `apps/api/test/payments.e2e.ts` | Cubierto |
| Modo MANUAL rechazado | `apps/api/test/payments.e2e.ts` | Cubierto |
| Aprobar sin permiso | `apps/api/test/payments.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Revisor distinto del pagador | `apps/api/test/payments.e2e.ts` | Cubierto |
| Dos revisiones concurrentes | `apps/api/test/payments.e2e.ts`, `artifacts-concurrency-{1,2,3}.txt` | Cubierto |
| Aprobar sobre una reserva vencida | `apps/api/test/payments.e2e.ts` | Cubierto |
| Política flexible con 100 % | `apps/api/test/cancellations.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Reembolso parcial | `apps/api/test/cancellations.e2e.ts`, `payments.e2e.ts` | Cubierto |
| La tasa cambia después del pago | `apps/api/test/payments.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto |
| Reembolso duplicado | `apps/api/test/cancellations.e2e.ts`, `payments.e2e.ts` (`REFUND_ALREADY_ISSUED`) | Cubierto |
| Reembolso por encima del pago | `apps/api/test/cancellations.e2e.ts`, `payments.e2e.ts` | Cubierto |
| Aprobar desde `IN_REVIEW` | `apps/api/test/payments.e2e.ts` | Cubierto |
| Transición no listada | `apps/api/test/payments.e2e.ts` | Cubierto |
| Número completo o CVV | `apps/api/test/payments.e2e.ts`, `api-errors.e2e.ts`, `audit-sanitize.ts`, `artifacts-card-cvv.txt` | Cubierto |
| Referencia duplicada | `apps/api/test/payments.e2e.ts` (`DUPLICATE_PAYMENT_REFERENCE`) | Cubierto |
| Misma referencia en otra agencia | `apps/api/test/payments.e2e.ts` | Cubierto |
| Montos como cadenas | `apps/api/test/payments.e2e.ts`, `api-errors.e2e.ts` | Cubierto |
| Monto enviado por el cliente | `apps/api/test/payments.e2e.ts`, `api-errors.e2e.ts` | Cubierto |

### tenant-isolation — 29 obligatorios
| Escenario (scope) | Evidencia | Estado |
|---|---|---|
| Sin contexto no se lee | `apps/api/test/transactions.e2e.ts`, `database.test.ts` | Cubierto |
| Sin contexto no se escribe | `apps/api/test/transactions.e2e.ts`, `database.test.ts` | Cubierto |
| Contexto de agencia no ve otra agencia | `apps/api/test/transactions.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Contexto de agencia no ve filas de plataforma | `apps/api/test/transactions.e2e.ts` | Cubierto |
| Catálogo público no ve borradores | `apps/api/test/catalog-api.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Catálogo público no escribe | `apps/api/test/transactions.e2e.ts` | Cubierto |
| Cliente A no ve la reserva de cliente B | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Agente de A no ve una reserva de B | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Personal de A ve las reservas de su agencia | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Cliente no puede escribir con un `user_id` ajeno | `apps/api/test/transactions.e2e.ts`, `bookings.e2e.ts` | Cubierto |
| Agente no puede insertar en otra agencia | `apps/api/test/transactions.e2e.ts`, `auth-access.e2e.ts` | Cubierto |
| Cliente sin membresía ve su propia reserva | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Claves de idempotencia no cruzan usuarios | `apps/api/test/bookings.e2e.ts`, `database.test.ts` (RLS por user) | Cubierto |
| Cliente sin membresía reserva en una agencia | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Cuerpo con agencia o usuario ajenos | `apps/api/test/bookings.e2e.ts`, `api-errors.e2e.ts` | Cubierto |
| Cliente con reservas en dos agencias | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Cliente no ve la reserva de otra persona | `apps/api/test/bookings.e2e.ts` | Cubierto |
| Personal de A no ve una reserva de B | `apps/api/test/bookings.e2e.ts`, `tenant.e2e.ts` | Cubierto |
| Cliente no accede a endpoints de agencia | `apps/api/test/auth-access.e2e.ts`, `products-admin.e2e.ts` | Cubierto |
| La expiración solo toca su agencia | `apps/api/test/bookings.e2e.ts`, `transactions.e2e.ts`, `booking-expiration.service.ts` | Cubierto |
| El trabajo de la tasa es global | `apps/api/test/jobs.e2e.ts`, `jobs.scheduler.ts`, `exchange-rates.e2e.ts` | Cubierto |
| El trabajo de la tasa no lee datos de agencia | `apps/api/src/rates/exchange-rate.service.ts` (`rates_global`), `jobs.e2e.ts` | Cubierto (indirecto) |
| El trabajo de la tasa no toca otras tablas | `apps/api/test/jobs.e2e.ts`, `exchange-rates.e2e.ts` | Cubierto (indirecto) |
| El trabajo de la tasa no escribe filas de agencia | `apps/api/test/exchange-rates.e2e.ts`, `transactions.e2e.ts` | Cubierto |
| Sin rol que ignore RLS | `artifacts-db-rls.txt`, `database.test.ts` | Cubierto |
| Rol de aplicación sin contexto no ve nada | `apps/api/test/database.test.ts`, `transactions.e2e.ts` | Cubierto |
| Tabla nueva sin RLS | `apps/api/test/database.test.ts` (inventario dinámico RLS forzada) | Cubierto |
| RLS forzada también para el dueño | `artifacts-db-rls-full.txt`, `database.test.ts` | Cubierto |
| `rates_global` probado como el rol de aplicación | `apps/api/test/transactions.e2e.ts`, `database.test.ts`, `tenant.service.ts` | Cubierto |

### Resumen de matriz
- **Cubiertos (evidencia ejecutable en F1 actual):** 174 de 188 obligatorios (api-errors 10, audit 13, auth-access 26, booking 33, catalog 19, exchange-rates 18, payments 26, tenant-isolation 29).
- **No evaluables por dependencia de tareas posteriores a T-F1-10b:** 14 obligatorios (documents 12 en T-F1-11, notifications 2 en T-F1-12), según `tasks.md` y `scope.md`. No se consideran defectos del código actual de F1 previo a esas tareas, pero deben verificarse al implementarlas antes del cierre de F1.
- **Deseables (93):** fuera de obligación de cierre; brechas baratas no auditadas exhaustivamente en esta matriz (varias ya cubiertas por suites actuales, otras explícitamente F2 según tareas/scope).

## Remediación post-informe (puntos 1–4, 2026-11-16)

### 1) Corrida 3 incompleta y variación 44 s vs 114 s (concurrencia)
- **`catalog-api.e2e.ts` aislado (5 ejecuciones):** 5/5 pass, `Duration` 25.34s, 14.63s, 17.18s, 22.54s, 21.19s (`artifacts-catalog-solo-summary.txt`, `artifacts-catalog-solo-{1..5}.txt`). No se observó hang ni fallo.
- **Limpieza/recursos (observado):** `catalog-api.e2e.ts` crea `pg.Client` propio (`owner.connect()` en `beforeAll`, `owner.end()` en `afterAll`), cierra app y ejecuta `prisma.$disconnect()` en `afterAll` (líneas ~2,62,72-73,346,366,369); no usa transacciones explícitas abiertas entre tests (`artifacts-sec-f1-bookings`/grep sin BEGIN/COMMIT). Revisión DB tras pruebas: sin conexiones de app ni `idle in transaction` (`open=2` solo consultas de inspección, `idle_in_tx=0`).
- **Configuración relevante:** `apps/api/vitest.config.mts` usa `fileParallelism: false`, `testTimeout: 20_000`, `hookTimeout: 30_000`, `setupFiles` con defaults de entorno; tests API corren en serie sobre BD PostgreSQL compartida.
- **Causa más probable (evidencia + inferencia acotada):** la variación 44.01s (`artifacts-concurrency-2.txt`) vs 114.35s (`artifacts-concurrency-1.txt`) en el mismo set (4 files/111 tests) es consistente con **calentamiento/caché de módulos y arranque Nest/Vitest en Windows + costo variable de bootstrap/transform/import** (run 1 muestra mayor proporción de import/transform/arranque; runs aislados de `catalog-api` también varían 14–25s sin cambio funcional). Las corridas incompletas (`artifacts-test-3-uncached.txt` termina en `catalog-api.e2e.ts`; `artifacts-concurrency-3-rerun.txt` sin resumen final y con error simulado `P0001 fallo de auditoria simulado` durante expiración) indican **ejecución interrumpida/no concluyente del runner** en contexto de suite compartida/serial, no un fallo determinista de `catalog-api.e2e.ts` (que pasa 5/5 aislado). No se identificaron fugas de conexión/transacción abiertas ni timeouts configurados insuficientes en `catalog-api.e2e.ts` como causa reproducible.

### 2) Dependencia `minimatch` (GHSA-g3hv-75wg-m249)
- **Observado:** `pnpm audit --prod` reportaba 31 hallazgos moderados (`artifacts-audit-prod.txt`). Se aplicó override `minimatch: ">=11.0.1"` en `pnpm-workspace.yaml` y se actualizó lock (`minimatch@11.0.8`). Verificación: `pnpm audit --prod` → **"No known vulnerabilities found"** (`artifacts-audit-prod-after.txt`). `pnpm-workspace.yaml` conserva `allowBuilds.esbuild: true`.

### 3) Alineación de `scope.md` con deltas actuales
- **Observado:** `scope.md` actualizado a conteos/títulos reales por delta: **288 escenarios totales (192 obligatorios, 96 deseables, 0 aplazables)**, con listas por spec y nota de trazabilidad (incluye duplicados presentes en deltas). Evidencia de conteo: `artifacts-delta-scenarios-by-spec.txt` y `openspec/changes/f1-hotels-e2e/specs/*/spec.md`.

### 4) Confirmación escrita (Cotizave / respaldo / claves)
- **Observado:** `openspec/changes/f1-hotels-e2e/design.md` (§5.2/T-F1-5b) documenta por qué se usa Cotizave (decisión T-F1-5b, `ve-bcv` con `X-API-Key`, refresco perezoso acotado a una vez/día en Caracas sin bloquear login), el respaldo si cae (fallo controlado sin pisar tasa + última `value_date <= hoy` o `503 RATE_UNAVAILABLE`) y que **no hay claves reales versionadas** (`COTIZAVE_API_KEY` solo en env/cabecera saliente, placeholders en `.env.example`/tests, sin hallazgos de clave real en grep/historial de verificación).

## Conclusión
La verificación independiente confirma gates/suites críticas en verde para las áreas implementadas hasta T-F1-10, con controles de dinero, tenancy/RLS, concurrencia/idempotencia, auth/guards y manejo de secretos/sanitización evidenciados. Puntos 1–3 de remediación quedan documentados/resueltos según evidencia disponible (punto 1 con causa acotada y sin defecto reproducible en `catalog-api` aislado; run 3 de concurrencia queda como no concluyente por falta de resumen). Se mantiene **GO condicionado para T-F1-11**; **`T-F1-10b` no se cierra** en este cambio y requiere revisión de seguridad final/decisión del dueño antes de marcar `[x]`. M1 (`trustedProxies`), M2 (Helmet/CSP/CORS para demo pública), §15→T-F1-17 y verificación de T-F1-11/T-F1-12 siguen pendientes según plan.
