# Revisión de seguridad — F1 núcleo (reservas, pagos, tasas)

**Fecha:** 2026-11-16 (revisión) · 2026-11-17 (endurecimiento y cierre) · **Modo:** revisión de primera mano y endurecimiento con tests; cambios limitados al alcance revisado y a las specs delta.  
**Guía:** `.claude/agents/security-reviewer.md` (7 áreas) + checklist dinámico solicitado (8 categorías).  
**Alcance:** F1 hasta T-F1-10b — `apps/api/src/bookings`, `payments`, `rates`, `idempotency`, guards/controladores/schemas relacionados, `tenant`/RLS usado por el flujo, `errors`, `audit`. Fuentes de verdad: `docs/constitution.md`, `openspec/specs/{booking,payments,exchange-rates,auth-access}/spec.md`. No existe `openspec/specs/tenant-isolation/spec.md`; el aislamiento se evalúa contra auth-access y la constitución (arts. 10, 11, 23).  
**Método:** revisión del código fuente; pruebas dinámicas por HTTP con las suites e2e de Vitest que levantan la app Nest real (`createApp`); reproducción de los dos fallos intermitentes, análisis de causa raíz, corrección con test determinista y repeticiones en paralelo. Artefactos: `artifacts-sec-f1-*.txt`, `artifacts-repro-*.txt`, `artifacts-verification-flaky.txt`, `artifacts-verification-flaky-rerun.txt`, `artifacts-lint-f1.txt`, `artifacts-typecheck-f1.txt`, `artifacts-test-f1.txt`, `artifacts-test-f1-rerun.txt`, `artifacts-api-errors-rerun.txt`. No se leyó `.env`.

## Semáforo global: 🟢 — sin hallazgos abiertos; un defecto medio real corregido y dos fallos intermitentes explicados

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| F1-S1 | Dos tests intermitentes (auditoría de pagos y expiración por agencia) atribuidos inicialmente a cobertura/entorno | ⚪ informativo | **Resuelto.** Defecto del arnés de pruebas, no de producción: triggers con nombre fijo compartido. 22/22 iteraciones válidas de ambos archivos en paralelo y 20/20 aisladas en verde |
| F1-S2 | `GET /bookings`/`GET /bookings/:id` confiaban solo en RLS con el `activeOrganizationId` de la sesión; una membresía revocada no lo limpia y permitía leer/listar reservas de esa agencia | 🟠 media | **Corregido.** Comprobación explícita de membresía y revalidación de propiedad en la lectura; escenario añadido a la spec delta y test de regresión |
| F1-S3 | `tenantId` de la agencia en `PaymentResponse`, también en respuestas al cliente final | ⚪ informativo | **Corregido.** Campo eliminado del DTO y del serializador; test que verifica su ausencia |
| F1-S4 | Sondas adversarias faltantes: misma `Idempotency-Key` con otro usuario, IDs de otra agencia en query, montos/tasas extremas y `quantity` que desborda | ⚪ informativo | **Corregido.** Tests añadidos en reservas y pagos |

**Veredicto:** **F1 puede continuar hacia documentos y panel.** No quedan hallazgos críticos, altos ni medios abiertos. El único fallo real encontrado (F1-S2) está corregido y cubierto; los dos fallos intermitentes eran del arnés y ya no se reproducen. T-F1-10b queda cerrada con este informe.

---

## Entorno y evidencia dinámica

- **Infra local:** PostgreSQL y Redis de compose (DB 5433 / Redis 6380). La app se levanta con `createApp()` dentro de cada suite; no hay API Caribe standalone.
- **Reproducción de la intermitencia (antes del fix):** ejecutar completos `payments.e2e.ts` y `bookings.e2e.ts` en paralelo reproducía los dos fallos: `si falla la auditoría no se confirma ni el pago ni la reserva` (`expected 200 to be 500`) y `un fallo en una agencia no detiene a las demás` (`summary.failed=0`). Evidencia en `artifacts-repro-*.txt`.
- **Causa raíz:** los triggers/funciones `audit_logs_fail_test` y `audit_logs_fail_test_fn` tenían nombre fijo por esquema. En PostgreSQL el nombre identifica al objeto en todo el esquema, así que dos procesos que se solapan se pisan al crear el trigger (gana el último `WHEN`) y el fallo inyectado deja de dispararse. El mismo nombre fijo se usaba en ambas suites aunque cada una inyectara una agencia distinta.
- **Corrección:** `apps/api/test/audit-failure-trigger.ts` genera un UUID por instancia para el trigger y la función, valida que el `tenantId` sea UUID y expone un `drop()` que solo elimina los objetos de esa instancia. Ambas suites lo usan y ya no definen triggers locales. Regresión: `dos inyecciones de auditoría simultáneas no se pisan entre sí`.
- **Verificación posterior:**
  - 20 iteraciones de `payments.e2e.ts` + `bookings.e2e.ts` completos y en paralelo: **19/20 en verde**; la única iteración con fallo duró ~700 s en ambos procesos y coincide con una suspensión del equipo (Kernel-Power 506 a las 23:54:07 y 507 a las 00:06:40), no con una carrera. Se descarta esa iteración y se repite **3/3 en verde** (`artifacts-verification-flaky-rerun.txt`): **22/22 iteraciones válidas**.
  - 20 repeticiones aisladas de `si falla la auditoría no se confirma ni el pago ni la reserva` (payments) y de `un fallo en una agencia no detiene a las demás` (bookings), ejecutadas además en paralelo entre sí: **20/20 en verde cada una, 0 fallos** (`artifacts-verification-flaky.txt`).
  - Suites: `bookings.e2e.ts` 50/50 y `payments.e2e.ts` 38/38.
  - `pnpm lint` y `pnpm typecheck` en verde. Suite completa en verde en la segunda corrida: 31/31 archivos y 527/527 tests de la API, 5/5 tareas de Turbo (`artifacts-test-f1-rerun.txt`). La primera corrida tuvo un `Hook timed out` de arranque en `test/api-errors.e2e.ts` (archivo ajeno al alcance), que pasó 13/13 aislado (`artifacts-api-errors-rerun.txt`) y en la repetición completa.

---

## 1) Manipulación de montos (precios, tasas, totales)

**Comportamiento esperado:** el cliente no envía montos/tasa/total; el servidor calcula `total_usd`, congela tasa y deriva `amount_ves`; entradas inválidas → 422; precios/cantidades/noches inválidas rechazadas.

| Caso | Evidencia (comando/test o código) | Resultado |
|---|---|---|
| Montos/tasa/campos calculados en creación de reserva rechazados | `test/bookings.e2e.ts` › `rechaza montos, tasas y campos calculados enviados por el cliente` (PASS). Código: `createBookingSchema` es `z.strictObject` sin `total_usd/rate/tenant_id/code` (`apps/api/src/bookings/bookings.schemas.ts`); `BookingsService.reserve` calcula noches/precio/total en servidor (`apps/api/src/bookings/bookings.service.ts`). | **422 VALIDATION_ERROR** (estricto) / montos ignorados por no existir en contrato; total calculado en servidor. |
| quantity/noches/fechas inválidas | Bookings e2e: `rechaza quantity no positiva, fechas iguales, pasadas o de más de 30 noches` (PASS). Schema usa `stayRangeSchema` con hoy Caracas y máx 30 noches, `quantity >= 1` (`bookings.schemas.ts`). | **422** |
| `quantity` que desborda el cupo | Nueva sonda: `rechaza una quantity que desborda el cupo sin tocar las noches` (PASS). `quantity = 2_147_483_648` no llega a modificar `reserved`: el bloqueo y la comprobación de capacidad ocurren antes. | **409 AVAILABILITY_EXHAUSTED**, cupo intacto y sin reserva |
| Precios/montos/tasa extremos en reserva | Nueva sonda: `rechaza precios y montos extremos enviados por el cliente` (PASS): `total_usd`, `price_usd` y `exchange_rate` fuera de rango. | **422 VALIDATION_ERROR** por campo; sin reserva |
| Producto no reservable | `rechaza un producto DRAFT, ARCHIVED, borrado lógico o inexistente con 409` (PASS). Servicio revalida `PUBLISHED` y visible en tx; lectura pública filtra borrados (`bookings.service.ts`, `publicProduct`). | **409 PRODUCT_INACTIVE** |
| Montos/tasa/campos calculados en pago rechazados | `test/payments.e2e.ts` › `rechaza montos, tasas y campos calculados enviados por el cliente` (PASS). Alta usa `paymentBodySchema` compartida (solo método/datos) y el servidor calcula `amountUsd` desde `booking.total_usd`, congela la tasa vía `rateForPayment` y deriva `amountVes` (`apps/api/src/payments/payments.service.ts`, `payments.schemas.ts`). | **422** por esquema estricto; montos/tasa del cliente no participan |
| Montos/tasa extremos en pago | Nueva sonda: `rechaza montos y tasas extremos enviados por el cliente` (PASS). | **422 VALIDATION_ERROR** por campo; sin pago |

**Hallazgos:** ninguno abierto. La lógica de dinero/tasa vive en servidor y los esquemas son estrictos; las sondas de extremos y desbordamiento añaden cobertura explícita.

---

## 2) Idempotencia

**Comportamiento esperado:** `Idempotency-Key` obligatoria (8–128), misma clave+cuerpo → misma respuesta sin duplicar; distinto cuerpo → conflicto; clave ajena no reutilizable; reintento tras fallo posible; claves largas/forma inválida rechazadas.

| Caso | Evidencia | Resultado |
|---|---|---|
| Falta header en reserva/pago | Bookings: `exige el encabezado Idempotency-Key` (PASS). Pagos: `exige el encabezado Idempotency-Key` (PASS). `requireIdempotencyKey` (`apps/api/src/idempotency/idempotency.ts`). | **400 IDEMPOTENCY_KEY_REQUIRED** (según helper/problema) |
| Reintento idéntico sin duplicar | Bookings: `reintenta el mismo POST sin crear una segunda reserva` (PASS), `no duplica la auditoría al reintentar` (PASS). Pagos: `devuelve la misma respuesta en un reintento y rechaza la clave con otro cuerpo` (PASS). `claimIdempotencyKey` replay por `requestHash` (`idempotency.ts`, `bookings.service.ts`, `payments.service.ts`). | **misma respuesta**, sin segunda reserva/pago/auditoría |
| Misma clave, cuerpo distinto | Bookings: `rechaza la misma clave con otro cuerpo` (PASS). Pagos: ídem (PASS). | **409 IDEMPOTENCY_KEY_REUSED** |
| Misma clave, otro usuario | Nuevas sondas: `la misma clave de otro usuario no reutiliza la respuesta ni la reserva` (bookings, PASS) y `la misma clave de otro usuario no reutiliza la respuesta` (pagos, PASS). La clave es por `userId` + endpoint; cada usuario obtiene su propio recurso. | **recursos distintos**, sin replay cruzado |
| Clave en vuelo / expirada / respuesta mínima | Bookings: `rechaza una clave que sigue en vuelo`, `procesa como nueva una clave expirada hace más de 24 horas`, `guarda solo id y código como respuesta idempotente` (PASS). | **409 IN_PROGRESS** / reutilización tras TTL 24 h / cuerpo guardado mínimo |
| Claves largas / inválidas | Validación longitud 8–128 en `requireIdempotencyKey` (`idempotency.ts`). | **422 VALIDATION_ERROR** esperado por contrato del helper |

**Hallazgos:** ninguno. La sugerencia informativa de la primera pasada (test explícito de «misma clave, otro usuario») está implementada.

---

## 3) Concurrencia

**Comportamiento esperado:** último cupo sin sobreventa; no doble pago efectivo/confirmación inconsistente; no doble revisión; no cancelar mientras hay pago en revisión; expiración vs pago resuelta por una sola transacción.

| Caso | Evidencia | Resultado |
|---|---|---|
| Último cupo (carrera) | Bookings: `crea exactamente una reserva cuando dos clientes compiten por el último cupo` (PASS). `FOR UPDATE` sobre noches y validación `reserved + quantity <= capacity` (`bookings.service.ts`), incremento en la misma tx. | **1 creada, otra 409 `AVAILABILITY_EXHAUSTED`** |
| Doble pago/reintento | Pagos: idempotencia PASS (ver §2); validación de estado pagable y bloqueo de reserva (`payments.service.ts` `pay` con `FOR UPDATE` de booking, `assertPayable`). | Sin duplicado lógico por reintento idéntico |
| Doble revisión concurrente | Pagos: `resuelve dos revisiones concurrentes con una sola ganadora` (PASS). `review` bloquea booking y payment y detecta `PAYMENT_ALREADY_REVIEWED` (`payments.service.ts`). | **una gana, otra 409** |
| No aprobar si expiró / pago en revisión bloquea expiración | Pagos: `no aprueba sobre una reserva vencida...`, `un pago en revisión impide la expiración de su reserva` (PASS). Bookings: `no expira una reserva con un pago en revisión`, `no expira una reserva con un pago aprobado` (PASS). | Estados protegidos |
| Cancelación mientras pago en revisión | Cancelaciones: `rechaza cancelar con un pago en revisión` (PASS). Servicio verifica pagos `IN_REVIEW` (`bookings.service.ts`, `payments.service.ts` refund path). | **409 PAYMENT_IN_REVIEW** |
| Carrera pago/expiración | Pagos: `la carrera entre pago y expiración la gana una sola transacción` (PASS). Bloqueos `FOR UPDATE` y comprobaciones de vencimiento/estado. | **una transacción gana** |
| Expiración: aislamiento ante fallo en otra agencia | Bookings: `un fallo en una agencia no detiene a las demás` (PASS). El fallo inyectado de `orgFail` no aborta las demás agencias y `summary.failed` refleja la agencia fallida. El fallo intermitente previo era del trigger compartido, no del job. | **Aislamiento correcto**, 20/20 aislado y 22/22 en archivo completo |

**Hallazgos:** ninguno. El riesgo operativo que se había anotado (robustez del job ante fallos parciales) queda descartado como defecto: el comportamiento es correcto y el falso negativo era del arnés.

---

## 4) Cruce de agencias y propiedad (IDOR/tenancy)

**Comportamiento esperado:** 404/403 según contrato (reservas ajenas 404), sin lectura/pago/descarga/acción sobre recursos de otra agencia; `tenant_id`/IDs ajenos en body/query no elevan acceso.

| Caso | Evidencia | Resultado |
|---|---|---|
| Lectura de reserva ajena | Bookings: `un cliente ajeno recibe 404, nunca 403`, `el personal de otra agencia recibe 404` (PASS). | **404** |
| **Agencia activa sin membresía** | Nueva regresión: `una agencia activa sin membresía no da acceso a sus reservas` (FALLABA antes del fix con 200; PASS ahora). `detail`/`list` obtienen la agencia efectiva con `activeAgencyId()`, que exige membresía; `detail` revalida además dueño/agencia sobre la fila leída. Escenario en `openspec/changes/f1-hotels-e2e/specs/booking/spec.md`. | **404** en el detalle y lista degradada a «solo mis reservas» |
| Listado propio no cruza agencias ajenas del usuario ajeno | Bookings: `mis reservas reúne las del usuario en todas las agencias y excluye las ajenas` (PASS). | Correcto |
| Pago sobre reserva ajena | Pagos: `responde 404 si la reserva es de otro cliente` (PASS). `ownedBooking` y contexto `owner` (`payments.service.ts`). | **404** |
| Cancelación ajena / otra agencia / roles | Cancelaciones: `responde 404 al cancelar la reserva de otro cliente`, `rechaza una reserva ajena de otra agencia`; roles cubiertos (PASS). `BookingsGuard` + autorización en servicio. | **404/403** según rol/propiedad |
| Panel admin pagos aislado por agencia | Pagos: `el panel lista solo la agencia activa...`, `el detalle respeta la agencia y el Super Admin ve todas` (PASS). `PaymentsGuard` `read/review` y consultas por `tenantId`/plataforma. | Correcto |
| IDs/`tenant_id` ajenos en query | Nuevas sondas: `GET /bookings?tenantId=…&tenant_id=…&limit=51&status=UNKNOWN` y panel de pagos con `tenantId`, `tenant_id`, `limit=51` o `bookingId` inválido → **422**. `bookingId` válido de otra agencia → **200 con página vacía**. | Sin filtrado por agencia del cliente |
| IDs/`tenant_id` ajenos en body | Schemas estrictos (`z.strictObject`) en booking/payment/reject/list no aceptan `tenant_id`; agencia derivada de producto/reserva/sesión. | **422** por validación estricta |
| RLS/tenancy base | `artifacts-sec-f1-tenant.txt` (EXIT:0, 28 passed): fail-closed sin contexto, aislamiento por tenant, GUC por transacción, escritura vigilada, inventario RLS forzada. | **Aislamiento en BD** verificado |

**Hallazgos:** uno medio, corregido (F1-S2). El resto sin cambios.

---

## 5) Autorización de pagos

**Comportamiento esperado:** solo Admin de agencia (owner/admin) revisa en su agencia activa; revisor ≠ reportante; Super Admin no revisa; cliente/agente/proveedor no aprueban; agencia unipersonal queda en revisión si no hay otro revisor.

| Caso | Evidencia | Resultado |
|---|---|---|
| Revisor ≠ reportante | Pagos: `impide que el pagador revise su propio pago (agencia de una sola persona)` (PASS). `PaymentsService.review` rechaza `reportedBy === actor.userId` (`payments.service.ts`). | **403** |
| Super Admin no revisa | `PaymentsGuard` lanza forbidden en `review` para plataforma (`payments.guard.ts`). Pagos: `responde 403 a agente, proveedor, cliente y Super Admin` (PASS). | **403** |
| Roles sin permiso de revisión/lectura | Guard valida `payment:review/read` por rol de membresía; lectura panel solo owner/admin/agent, revisión solo owner/admin (`payments.guard.ts`). Tests de panel/revisión PASS. | **403** cuando aplica |
| AUTO vs MANUAL | Pagos: creación AUTO aprueba y confirma; MANUAL queda `IN_REVIEW` (PASS). `payments.service.ts` decide por `tenantSettings.paymentMode`. | Correcto según spec |
| Auditoría en revisión | `si falla la auditoría no se confirma ni el pago ni la reserva` (PASS; 20/20 aislado y 22/22 en archivo completo). `approve/reject` usan `@Auditable` y transacción de auditoría (`admin-payments.controller.ts`). | **rollback de pago y reserva** si falla la auditoría |

**Hallazgos:** ninguno. La incertidumbre anterior queda cerrada.

---

## 6) Tasa de cambio

**Comportamiento esperado:** override con motivo y permiso (agencia o plataforma según endpoint); sin motivo o sin permiso rechazado; sin tasa disponible → 503 `RATE_UNAVAILABLE`; tasa congelada al pagar no cambia luego.

| Caso | Evidencia | Resultado |
|---|---|---|
| Override con permiso/motivo y auditoría | `test/exchange-rates.e2e.ts`: `override de agencia... escribe, audita antes/después`, `override global... solo plataforma, con auditoría...`, reemplazos y precedencias (PASS, 13/13). | **200** con auditoría |
| Override sin motivo / sin permiso / contexto incorrecto | Rates e2e: `un agente sin permiso recibe 403...`, `una agencia activa no puede fijar el override global`, `valida el cuerpo del override` (PASS). | **422** sin motivo/valor inválido, **403** sin permiso |
| Fuente caída / respaldo / sin tasa | Rates e2e: `fuente caída... se usa la última tasa guardada` (PASS). Pagos: `responde 503 RATE_UNAVAILABLE y no crea el pago si no hay tasa` (PASS). | **Respaldo** o **503** sin crear pago |
| Congelamiento al pagar | `PaymentsService.pay` guarda `exchangeRateId`, `rate`, `valueDate`, `amountVes` calculados en tx (`payments.service.ts`). Cancelaciones: `usa la tasa congelada del pago aunque la tasa del día cambie` (PASS). Rates: `alta de pago asegura la tasa del día antes de congelarla` (PASS). | **Inmutable** tras creación |

**Hallazgos:** ninguno.

---

## 7) Fuga de datos

**Comportamiento esperado:** no exponer `capacity/reserved` públicos; borrados no visibles; 5xx sin trazas/SQL; sin secretos en logs/respuestas; sin campos internos de la agencia en respuestas al cliente.

| Caso | Evidencia | Resultado |
|---|---|---|
| `capacity`/`reserved` no públicos | `apps/api/src/catalog/catalog.service.ts` documenta y consulta sin exponerlos; disponibilidad usa `public_availability` proyectando `night, remaining, price_usd`. Tests de catálogo incluyen «sin capacity ni reserved». | **No expuestos** en API pública de catálogo |
| Recursos borrados/invisibles | Lecturas públicas filtran `status='PUBLISHED'` y `deleted_at IS NULL` (`catalog.service.ts`, `bookings.service.ts` `publicProduct`). | **404/409** según flujo, sin revelar detalle interno |
| Trazas/SQL en 5xx | `problem-details.filter.ts`: 5xx se mapean a `INTERNAL_ERROR` con detalle genérico, `correlationId` en body/header y log interno; no devuelve stack/SQL al cliente. Errores de body-parser también sanitizados. | **Sin fuga** al cliente |
| Secretos/tarjeta | Pagos: `rechaza cardNumber, pan y cvv y no los registra en logs` (PASS). Esquemas/contrato no almacenan PAN/CVV; auditoría pasa por sanitizador (`audit.service.ts`). No se accedió a `.env`. | Correcto dentro del alcance |
| `tenantId` en respuestas de pago | Nueva regresión: `el cliente no recibe el tenant ni campos internos de la agencia` (PASS, fallaba antes del cambio). `PaymentResponse` ya no incluye `tenantId`; `toPaymentResponse` no lo serializa. Escenario en `specs/payments/spec.md`. | **No expuesto** en creación ni en pagos de la reserva |

**Hallazgos:** ninguno abierto (F1-S3 corregido).

---

## 8) Entradas, validación y superficie de inyección/XSS

| Caso | Evidencia | Resultado |
|---|---|---|
| Validación Zod estricta | Bookings/pagos/rates usan `ZodValidationPipe` con esquemas `strictObject`/uniones (`bookings.schemas.ts`, `payments.schemas.ts`, `exchange-rates.controller.ts`, `paymentBodySchema` compartida). Campos extra → 422, incluidas las sondas de query. | **Validado** |
| SQL y parámetros | Uso extensivo de Prisma y `$queryRaw` con `Prisma.sql` y parámetros (`bookings.service.ts`, `payments.service.ts`, `catalog.service.ts`, `exchange-rate.service.ts`); sin interpolación de input de usuario en SQL crudo. El helper de triggers solo interpola un `tenantId` validado como UUID. | **Sin inyección SQL evidente** |
| XSS en respuestas/API | La API devuelve JSON (Problem Details / recursos). No se identificó render HTML server-side en esta capa. El escape en UI es responsabilidad del front. | **Bajo riesgo en API** |
| Errores de parseo de cuerpo | `bootstrap.ts` puentea errores de body-parser a Problem Details (JSON inválido/tamaño) sin filtrar formato de `/api/auth`. | Consistente y sin HTML/stack |

**Hallazgos:** ninguno en el backend.

---

## Hallazgos consolidados y correcciones

### F1-S1 — Fallos intermitentes de auditoría y expiración (⚪ informativo, resuelto)

- **Evidencia:** reproducido al ejecutar completos ambos e2e en paralelo (`artifacts-repro-*`).
- **Causa raíz:** triggers y funciones de auditoría con nombre fijo global por esquema; dos procesos se pisaban y el `WHEN` del último desactivaba el fallo del otro.
- **Impacto:** falso verde intermitente en dos escenarios de rollback; no era un defecto de producción.
- **Corrección:** nombres únicos por instancia en `apps/api/test/audit-failure-trigger.ts`, `drop()` propio y test de regresión de dos inyecciones simultáneas.
- **Verificación:** 22/22 iteraciones válidas de archivos completos en paralelo y 20/20 de cada test aislado, sin fallos.

### F1-S2 — Lectura con agencia activa sin membresía (🟠 media, corregida)

- **Evidencia:** test que fallaba con 200 antes del fix y pasa ahora; membresía revocada en la BD con `session.activeOrganizationId` aún apuntando a esa agencia.
- **Impacto:** un usuario que ya no pertenece a una agencia podía leer y listar sus reservas mientras RLS siguiera aceptando el tenant de la sesión.
- **Corrección:** `BookingsService.activeAgencyId()` exige membresía vigente; `detail()` revalida dueño/agencia sobre la fila; `list()` degrada a «solo mis reservas».
- **Cobertura:** escenario «Agencia activa sin membresía» en la spec delta y test de regresión.

### F1-S3 — `tenantId` en respuestas de pago (⚪ informativo, corregido)

- **Evidencia:** `PaymentResponse.tenantId` (`payments.schemas.ts`, `payments.service.ts`); ningún consumidor del monorepo lo usa.
- **Corrección:** campo eliminado del DTO y del serializador; test que verifica su ausencia en la creación y en los pagos de la reserva.
- **Contrato:** cambio de respuesta del API; al no haber consumidores, no requiere migración de clientes.

### F1-S4 — Sondas adversarias ausentes (⚪ informativo, corregido)

- **Añadidas:** idempotencia con la misma clave desde otro usuario y otro cuerpo (reservas y pagos); `tenantId`/`tenant_id`/`limit`/`status`/`bookingId` fuera de contrato en query (422 y página vacía para otra agencia); montos/tasas extremas (422); `quantity` que desborda el cupo (409 sin tocar `reserved`).

---

## Veredicto final

- **Críticos:** 0 abiertos. **Altos:** 0 abiertos. **Medios:** 1 encontrado y corregido (F1-S2). **Informativos:** 3 resueltos (F1-S1, F1-S3, F1-S4).
- Las invariantes del núcleo F1 quedan respaldadas por código y pruebas HTTP: cálculo de montos/tasa en servidor, idempotencia incluso entre usuarios, ausencia de sobreventa por bloqueo transaccional, aislamiento tenant (RLS + scoping + membresía), autorización de revisión (Admin ≠ reportante, sin Super Admin), congelamiento de tasa, rollback si falla la auditoría y manejo seguro de errores 5xx.
- **F1 puede continuar hacia documentos y panel**; no hay condición pendiente sobre este alcance. T-F1-11 puede empezar en paralelo.
