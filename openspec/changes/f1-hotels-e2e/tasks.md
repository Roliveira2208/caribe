# Tareas: f1-hotels-e2e
Requiere `f0-foundations` archivada. Una tarea a la vez, un commit por tarea.

> Fase 0 (especificar): deltas de specs y `design.md` aprobados por el dueño el 2026-11-11 con seis
> cambios (inventario por noche, alcance reducido, idempotencia mínima, 422 estricto, `rates_global` y
> PDFs, `minimumReleaseAge`). El alcance por escenario está en `scope.md`.
>
> **Regla de alcance (2026-11-12):** solo los **188 escenarios obligatorios** bloquean el cierre de F1.
> Los **93 deseables** se implementan si son baratos y, si no, pasan a F2 con una nota aquí. Los
> aplazables ya están listados en `scope.md` y no cuentan en los deltas.

- [x] T-F1-0 Endurecer el inventario de rutas (primera tarea, antes de tocar catálogo; análisis en
  `docs/plans/inventory-hardening-f0.md`).
  - Registro cerrado de rutas no administrativas: toda ruta fuera de `/admin`, `/organization` y
    `/two-factor` declarada en una lista explícita; un prefijo nuevo rompe el test.
  - Huérfanas en todas las declaraciones (plataforma incluidas) y en la allowlist.
  - Inventario de todos los métodos HTTP, no solo el primero.
  - Fallo explícito si un path contiene `:` hasta que la clasificación soporte patrones.
  - Justificación por entrada de la allowlist (lectura o self-service).
  - Prerrequisito de cualquier autenticación por token (API key, bearer, SSO, OAuth): política para
    rutas clasificadas sin sesión y espejo del inventario en Nest. Sin esto no se habilita ningún
    plugin de Better Auth.
  - Prueba: auth-access › "Ruta administrativa sin exigencia de segundo factor" (inventario Nest +
    Better Auth) y los casos nuevos del registro cerrado.
  - Hecho: 30 rutas fuera de las familias + 15 de allowlist con justificación; métodos exactos;
    paths con `:` solo en no administrativas; sin sesión ninguna ruta admin responde 2xx; plugins
    cerrados a organization/admin/two-factor; registro Nest cerrado; `joinRoutePath` sin barra final.
- [x] T-F1-0b Implementar `auth_events`: migración, RLS, hooks `before`/`after`, resultado del rechazo
  TOTP en el `catch`, consulta de solo lectura y prueba de inmutabilidad.
  Prueba: audit › "Registro de intentos y resultados de acciones administrativas" y "Visibilidad de los intentos".
- [x] T-F1-0c Contrato de errores: Problem Details, tabla de códigos, pipe de validación Zod y
  serialización de dinero/fechas.
  Prueba: escenarios de `api-errors` (spec nueva). Hecho: filtro global `application/problem+json`
  con `code` estable, tabla `API_ERROR_STATUS` en `@caribe/shared` (incluye `METHOD_NOT_ALLOWED`
  405 y `CONFLICT` 409 genérico), `ZodValidationPipe` estricto (claves desconocidas y campos
  calculados → 422), puente Express para los errores de body-parser (JSON inválido → 422, cuerpo
  grande → 413) que no pasan por el pipeline de Nest, y serializadores de dinero/tasa/fechas.
  `/api/auth/*` conserva el formato de Better Auth.
- [x] T-F1-0d Contextos RLS `owner`, `public`, `tenant`+`owner` y `rates_global` en `TenantService`,
  políticas por dueño directo, por `EXISTS` del `booking` padre, lectura pública de `products`,
  `availability` y `destinations`, `WITH CHECK` e inventario de tablas con RLS forzada.
  Prueba: escenarios de `tenant-isolation` (spec nueva) y auth-access › "Aislamiento entre tenants".
  Hecho: `TenantService` gana `withOwner`, `withOwnerTenant`, `withPublic` y `withRatesGlobal` (y
  `withContext` despacha los siete contextos), con GUC `app.user_id`, `app.public` y
  `app.rates_global`; las pruebas de `caribe_app` cubren el fallo cerrado sin contexto, que los
  contextos `owner`/`public`/`rates_global` no ven auditoría y que `WITH CHECK` rechaza escrituras
  ajenas, más un inventario dinámico que falla nombrando cualquier tabla de negocio sin RLS
  habilitada y forzada (excepciones explícitas: tablas de Better Auth y `_prisma_migrations`).
  Las políticas por tabla llegan con su migración (T-F1-1a/1b/1c): el inventario es la barrera que
  impide que una tabla nueva se cuele sin RLS.
- [x] T-F1-1a `tenant_settings` y `user.locale`: migración con RLS, defaults y auditoría del cambio.
  `tenant_settings` es 1:1 con `organization.id`, con CHECK 5–1440 y moneda ISO, RLS forzada (agencia
  `FOR ALL` con `WITH CHECK`, plataforma solo lectura) y auditoría antes/después del PUT. `user.locale`
  se añade por `additionalFields` de Better Auth y el CLI regenera la columna con default `es`. API:
  GET/PUT `/api/v1/admin/tenant-settings` (owner/admin con TOTP; GET devuelve defaults sin crear fila).
  Prueba: auth-access › "Operación de agencia sin agencia activa"; audit › "Cambio de ajustes de la agencia".
- [x] T-F1-1b Catálogo y disponibilidad (absorbe T-F1-2): migraciones de `providers`, `destinations`,
  `products` (cada fila es un tipo de habitación con `hotel_key` y `room_type`, sin tabla `hotels`),
  `availability` por noche y `cancellation_policies`, con RLS e índices; único `(product_id, night)`
  sin `btree_gist`; `CHECK (reserved BETWEEN 0 AND capacity)`, `CHECK (price_usd > 0)`; función SQL
  `public_availability` que devuelve solo `remaining` y `price_usd` de productos publicados.
  - Esquema Zod de `attributes` de hotel en `packages/shared`: `stars` 1–5, `maxGuests` 1–20,
    `amenities` (máx. 30), `images` (máx. 10 URLs `https` de `ALLOWED_IMAGE_HOSTS`), estricto.
  - Esquema Zod de `rules` de cancelación (1–10 reglas, horas no negativas estrictamente descendentes,
    porcentajes enteros 0–100) y trigger que lo refuerza en la base.
  - Esquema Zod de rango de estancia: fechas calendario en `America/Caracas`, `checkOut > checkIn`,
    no pasadas y máximo 30 noches.
  - Pruebas primero: `database.test.ts` (esquema, RLS, CHECKs, triggers, índices), e2e de RLS de
    catálogo como `caribe_app` (`withPublic` no ve borradores ni borrados y no escribe; una agencia no
    toca el catálogo de otra), tests Zod de atributos, reglas y rango de fechas.
  - Prueba: catalog › "Atributos inválidos", "Estados", "Noche duplicada" y "Precio o fechas inválidos".
- [x] T-F1-1c Migraciones de reservas, pagos y documentos (`bookings`, `booking_items` con precios por
  noche, `idempotency_keys` sin `tenant_id` y RLS solo por `user_id`, `exchange_rates`, `payments`,
  `refunds`, `documents`, `document_counters`, `notification_logs`) con RLS, triggers de congelamiento
  e inmutabilidad y unicidad. `booking_items` guarda copias de `hotel_key`, `room_type` y
  `product_title`; un trigger `BEFORE UPDATE` rechaza cambios en `policy_snapshot`, `nightly_prices`,
  `subtotal_usd`, `product_title`, `hotel_key`, `room_type`, `check_in`, `check_out` y `quantity`.
  Prueba: booking › "Reservas concurrentes sobre el último cupo" y "Fechas inválidas"; payments ›
  "Reembolso".
- [x] T-F1-1d Ampliar `pnpm db:seed` con una agencia, un tipo de habitación publicado, disponibilidad,
  política, tasa global y `payment_mode`; idempotente.
  Prueba: demo manual documentada.
- [x] T-F1-3 `CatalogModule`: listado con filtros y cursor, detalle y disponibilidad públicos.
  Prueba: catalog › "Búsqueda y filtros" y "Detalle y disponibilidad públicos".
- [x] T-F1-4 CRUD de hoteles para proveedor y admin (API) con comprobación de propiedad.
  Prueba: auth-access › "Proveedor edita su producto" y "Propiedad de productos".
- [x] T-F1-5 `ExchangeRateModule`: provider, caché, respaldo, circuit breaker, override con auditoría y
  tenencia global/agencia. Incluye el refresco global bajo `rates_global`; la programación diaria con
  BullMQ entró en T-F1-8.
  Prueba: exchange-rates › "Fuente disponible", "Ajuste manual" y "Tenencia de las tasas".
  Nota: el proveedor (DolarAPI) y el refresco programado se sustituyen en T-F1-5b por Cotizave y un
  refresco perezoso al login y al alta de pago.
- [x] T-F1-6 Precio VES informativo en catálogo con la tasa global.
  Prueba: catalog › "Sin tasa disponible" y "Equivalente en VES".
- [x] T-F1-7 `BookingModule`: crear reserva con retención multi-noche, viajeros, código e
  `Idempotency-Key`.
  Prueba: booking › "Hay cupo en todas las noches", "Reservas concurrentes sobre el último cupo",
  "Falta una noche" e "Idempotencia".
  Nota: deseables cubiertos aquí: fechas inválidas, clave expirada, reserva sin viajeros, demasiados
  viajeros, viajero sin documento, falta la clave, reintento sin auditoría duplicada y alta con
  auditoría. Deseables que siguen a su tarea natural: datos del viajero en el voucher (T-F1-11),
  filtro por estado y producto despublicado después de reservar (T-F1-7b), cancelación repetida y
  cancelar una reserva vencida (T-F1-10), expirar deja auditoría (T-F1-8). La colisión de código se
  cubre en unitarios de `withCodeRetry`; forzarla por HTTP queda para T-F1-7b si sale barata.
- [x] T-F1-7b Eliminar los stubs `TODO(F1)` de products/bookings creados en F0.
  Prueba: auth-access › "Ruta protegida sin sesión" y "Catálogo público" con los endpoints reales;
  booking › "Consulta y propiedad".
  Nota: `GET /bookings` y `GET /bookings/:id` son reales; el `PUT /products/:id` de F0 se retiró
  porque la escritura real vive en `/admin/products/:id` (T-F1-4) y la matriz de permisos de
  auth-access apunta al endpoint real sin duplicar products-admin. Deseables cubiertos: filtro por
  estado y producto despublicado después de reservar. La colisión de código sigue cubierta solo en
  unitarios de `withCodeRetry`: forzarla por HTTP exige mockear el generador y no sale barata.
- [x] T-F1-8 Trabajo de expiración de reservas por agencia, con omisión de pagos en revisión; más la
  programación diaria del refresco de la tasa global con BullMQ.
  Prueba: booking › "Expiración de la retención" (vence, idempotente, omite `IN_REVIEW`/`APPROVED`,
  expira con `REJECTED`, no toca no vencidas ni `CONFIRMED`, aislamiento por agencia, un fallo no
  detiene a las demás); jobs › calendarios, zona horaria, reintentos, despacho y `jobsEnabled`.
  Nota: el escenario "Carrera entre pago y expiración" y el 410 `HOLD_EXPIRED` quedan en T-F1-9, que
  es donde existe el endpoint de pago. El planificador no arranca con `NODE_ENV=test` ni sin
  `REDIS_URL`, así que los e2e no dependen de Redis; `expireDueBookings(now, organizationIds?)` acota
  una pasada para reprocesos manuales y pruebas. T-F1-5b retira el trabajo de tasa: el planificador
  solo expira reservas y la tasa se refresca al login y al alta de pago.
- [x] T-F1-9 `PaymentModule`: pago simulado, estados y modos AUTO/MANUAL, datos por método, monto
  calculado en servidor y revisor distinto.
  Prueba: payments › "Pago en VES por Pago Móvil", "Cliente envía un monto o una tasa", "Reserva
  vencida", "Reserva cancelada", "Reserva ya confirmada", "Pago de una reserva ajena", "Sin sesión",
  "Modo AUTO", "Modo MANUAL aprobado", "Modo MANUAL rechazado", "Rechazo sin motivo", "Aprobar sin
  permiso", "Revisor distinto del pagador", "Agencia de una sola persona", "Dos revisiones
  concurrentes", "Aprobar sobre una reserva vencida", "Transición no listada", todos los de "Datos por
  método de pago" y "Serialización de montos", y "Carrera entre pago y expiración" (heredado de
  T-F1-8). Unitarios: cursor del listado, query, rechazo, métodos y respuesta guardada.
  Nota: incluye la migración `20261115090000_business_platform_read` (políticas `*_platform` de solo
  lectura para `bookings`, `booking_items`, `payments`, `refunds` y `documents`, que faltaban desde
  T-F1-1c y que el panel del Super Admin necesita). El 410 `HOLD_EXPIRED` y la carrera pago/expiración
  heredados de T-F1-8 se cubren aquí. El alta exige `Idempotency-Key`, congela la tasa de la agencia
  (override > global; sin ninguna, 503 `RATE_UNAVAILABLE`) y audita `payment.create` en su transacción;
  la revisión vive en `/admin/payments` (desviación §15-8), audita `payment.approve`/`payment.reject` y
  responde 403 al revisor que es el propio pagador. Los reembolsos (`refunds`, estados
  `REFUNDED`/`PARTIALLY_REFUNDED`, `REFUND_ALREADY_ISSUED` y los escenarios de "Reembolso") pasan a
  T-F1-10.
- [x] T-F1-9b Admin: organización activa (una membresía auto, varias selector, cero sin panel, Super
  Admin plataforma). Wireframe del selector aprobado antes de construir.
  Prueba: auth-access › "Organización activa en el panel".
- [x] T-F1-9c Admin: pantalla mínima de aprobación de pagos (`IN_REVIEW`, aprobar/rechazar con motivo).
  Wireframe aprobado antes de construir.
  Prueba: payments › "Modo MANUAL aprobado" y "Modo MANUAL rechazado".
- [x] T-F1-10 Cancelación y reembolso con `policy_snapshot` y tasa congelada (sin nota de reembolso,
  diferida a F2). `POST /bookings/:id/cancel` responde `{ id, code, status, refund }`; las horas de
  cada regla se cuentan desde las 15:00 de `America/Caracas`; owner/admin cancelan cualquier reserva
  de su agencia, el agente solo las propias, y proveedor y Super Admin sin agencia reciben 403. Un
  pago `IN_REVIEW` responde 409 `PAYMENT_IN_REVIEW`; la repetición devuelve el reembolso existente y
  una reserva vencida no toca cupo. Los montos salen del USD del pago y su tasa congelada; 0 % no
  crea fila y deja el pago `APPROVED`. "Reembolsar un pago en revisión" (deseable) pasa a F2: choca
  con el 409 `PAYMENT_IN_REVIEW` que exige la spec.
  Prueba: booking › "Cliente cancela reserva confirmada", "Cancelar reserva ajena", "Cancelar una
  reserva pendiente sin pago", "Cancelar con un pago en revisión", "Política congelada",
  "Cancelación repetida", "Cancelar una reserva vencida" y "Horas antes del check-in"; payments ›
  "Política flexible con 100 %", "Reembolso parcial", "La tasa cambia después del pago", "Reembolso
  duplicado", "Reembolso por encima del pago" y "Reembolso del 0 %"; auth-access › "Admin cancela
  una reserva de su agencia", "Agente intenta cancelar una reserva ajena", "Proveedor intenta
  cancelar" y "Super Admin intenta cancelar".
- [x] T-F1-5b Sustituir DolarAPI por Cotizave y el trabajo diario por un refresco perezoso: `ensureTodayRate()`
  al crear la sesión (en segundo plano, sin bloquear el login) y antes de crear un pago, como máximo una
  vez al día por `fetched_at` en `America/Caracas`. Quita `exchange-rate.refresh` de BullMQ y deja la
  última fila guardada como respaldo.
  Prueba: exchange-rates › "Fuente disponible", "Fuente caída", "Segundo login del mismo día no
  consulta" y "Alta de pago asegura la tasa del día"; jobs › sin trabajo de tasa. Unitarios del
  proveedor Cotizave y de `ensureTodayRate`.
  Nota: reemplaza el proveedor de T-F1-5 y la programación diaria de T-F1-8; `scope.md` suma dos
  escenarios obligatorios (281/188/93).
- [x] T-F1-10b Pausa planificada: verificación independiente y revisión de seguridad en sesión limpia
  con reservas y pagos ya cerrados (T-F1-7 a T-F1-10), antes de documentos (T-F1-11) y del resto del
  panel y la web (T-F1-13/T-F1-14).
  Prueba: informe de verificación con semáforo y hallazgos de seguridad; los bloqueantes se corrigen
  antes de T-F1-11.
  Resultado: `docs/plans/security-f1-core.md` en verde, sin fallos intermitentes (22/22 archivos
  completos en paralelo y 20/20 aislados); F1-S2 corregido y F1-S3 sin `tenantId`.
- [x] T-F1-11a Infraestructura de documentos: instalar `pdfkit` y `qrcode` con pin exacto (justificado en
  design §12), añadir `DOCUMENTS_DIR` a `.env.example` y a la configuración, crear y validar el
  directorio al arrancar (falla el arranque si no se puede escribir) y helper puro de ruta relativa que
  rechace `..`, ruta absoluta, esquema de URL y barra invertida con 400 `INVALID_PATH`.
  Prueba: `documents-config` (configuración y directorio) y `documents-path` (ruta manipulada).
- [x] T-F1-11b `InvoiceProvider`/`FreeFormReceiptProvider`: PDF en español generado solo desde datos
  congelados, leyenda "Documento no fiscal" en todas las páginas, QR con la URL absoluta
  `${WEB_URL}/reservas/<code>` sin datos personales ni tokens y textos del viajero como datos planos.
  Prueba: `documents-render` (leyenda, QR, escaping) y documents › "QR sin datos personales".
- [x] T-F1-11c Numeración e idempotencia: `DocumentIssuanceService.reserve()` crea la fila `PENDING`
  dentro de la transacción de negocio con el contador por agencia y tipo bloqueado
  (`SELECT ... FOR UPDATE` + `UPDATE ... RETURNING`), reutiliza el documento existente sin consumir
  número y respeta la identidad inmutable.
  Prueba: `documents-issuance` (dos emisiones concurrentes, reintento, inmutabilidad) y documents ›
  "Numeración correlativa", "Reintento del mismo pago", "Un voucher por reserva", "Un comprobante por
  pago" y "Número único por agencia y tipo".
- [x] T-F1-11d Ciclo de vida y reintentos: renderizado invocable sin Redis, `READY` con `file_url` de
  UUID, `FAILED` tras 3 intentos con el error registrado, sin bloquear reserva ni pago.
  Prueba: `documents-lifecycle` (PENDING/READY/FAILED y 3 intentos) y documents › "Generación fallida".
- [x] T-F1-11e Descarga autenticada: `GET /documents/:id/download` con sesión, propiedad del dueño o de
  la agencia activa revalidada, 401/404, `Content-Disposition: attachment`, 409 `DOCUMENT_PENDING`,
  503 `DOCUMENT_UNAVAILABLE` y 400 `INVALID_PATH` sin leer archivo.
  Prueba: `documents-download` y documents › "Descarga autenticada", "Descargar voucher ajeno",
  "Personal de la agencia descarga", "Sin sesión", "Documento de otra agencia", "Nombre no
  adivinable", "Ruta manipulada" y "URL pública".
- [x] T-F1-11f Integración: reservar voucher y comprobante en la aprobación manual y automática del
  pago, dentro de la misma transacción, sin revertir la confirmación si falla la generación del PDF.
  Prueba: e2e de pago aprobado → ambos documentos; marcar T-F1-11 como terminada.
- [x] T-F1-12 `NotificationModule` con un solo correo de confirmación de reserva (SMTP local, `SMTP_*`
  en `.env.example`), `user.locale` y deduplicación. Los demás avisos son F2.
  Prueba: escenarios de `notifications` (spec nueva): confirmación, sin otros avisos e idempotencia.
- [x] T-F1-12b Barrido cada minuto de documentos y avisos `PENDING` con más de 5 minutos desde su
  creación (configurable por entorno); re-encola por agencia con `withTenant` para recuperar filas
  huérfanas si el proceso cae entre el commit y el encolado, sin tocar agencias que fallen.
  Prueba: `pending-recovery` (simulación de caída, umbral, entregas duplicadas, fallo por agencia) y
  `jobs` (calendario y despacho del barrido).
- [x] T-F1-13a Web: buscador y resultados. Wireframe aprobado antes de construir.
  Prueba: catalog › "Búsqueda y filtros".
- [x] T-F1-13b Web: detalle del hotel. Wireframe aprobado antes de construir.
  Prueba: catalog › "Detalle y disponibilidad públicos".
  Evidencia: `docs/wireframes/detalle.svg`; `apps/web/test/detail-view.test.ts`; capturas `detail-*.png`
  en `openspec/changes/archive/2026-11-22-f1-visual-identity/verify.md` (sección 1 y matriz).
- [x] T-F1-13c Web: checkout (viajero y moneda). Wireframe aprobado antes de construir.
  Prueba: booking › "Hay cupo en todas las noches" y "Reserva sin viajeros".
  Evidencia: `docs/wireframes/checkout.svg`; `apps/web/test/checkout-view.test.ts`; capturas
  `checkout-*.png` en `openspec/changes/archive/2026-11-22-f1-visual-identity/verify.md`.
- [x] T-F1-13d Web: pago con cuenta regresiva y métodos. Wireframe aprobado antes de construir.
  Prueba: payments › "Pago en VES por Pago Móvil" y "Datos por método de pago".
  Evidencia: `docs/wireframes/checkout.svg` (paso 2, aprobado); `apps/web/test/checkout-view.test.ts`
  (contrato por método, importes serializados, clasificación de errores y retención); capturas
  `checkout-payment-*.png` y `checkout-success-*.png` en claro/oscuro y escritorio/móvil.
- [ ] T-F1-13e Web: confirmación con voucher/comprobante. Wireframe aprobado antes de construir.
  Prueba: documents › "Voucher" y "Comprobante de pago".
- [ ] T-F1-14a Web: "Mis reservas" (lista/detalle). Wireframe aprobado antes de construir.
  Prueba: booking › "Mis reservas entre agencias".
- [ ] T-F1-14b Web: cancelación y descarga de documentos. Wireframe aprobado antes de construir.
  Prueba: booking › "Cliente cancela reserva confirmada"; documents › "Descarga autenticada".
- [ ] T-F1-15 Prueba e2e del flujo completo (Playwright) y prueba k6 de búsqueda y reserva.
  Prueba: recorrido buscar → reservar → pagar → descargar, más concurrencia de cupo.
- [ ] T-F1-16 Verificación: `/verify f1-hotels-e2e` en conversación limpia; `/security-review`; archivar.
  Prueba: informe de verificación con semáforo y M1/M2 anotados.
- [ ] T-F1-17 Actualizar `docs/sdd/SDD.md` con las nueve desviaciones canónicas de `design.md` §15
  (`tenant_settings`, `availability` por noche, `PARTIALLY_REFUNDED`,
  `InvoiceProvider.issue(booking, payment?)`, `PENDING` interno, `idempotency_keys` sin `tenant_id` y
  producto = tipo de habitación con `hotel_key`, sin tabla `hotels`).
  Prueba: SDD §5 y §7 coinciden con las specs archivadas; sin cambios en D1–D15.

## Notas heredadas de f0-foundations (siguen abiertas)

- **M1**: configurar `trustedProxies` al decidir el hosting; hoy la IP tras un proxy resuelve a null y
  el rate limit de login degenera en bucket global.
- **M2**: Helmet, CSP y CORS antes de cualquier demo pública (faseados en F5 por el SDD §13).

## Notas de F1

- **Flake a vigilar (2026-11-17):** `apps/api/test/api-errors.e2e.ts` falló una vez con
  `Hook timed out in 30000ms` durante el `app.listen(0)` del arranque (`beforeAll`). El mismo archivo
  pasó 13/13 aislado y en la repetición completa de la suite. No hay un fallo funcional asociado;
  si reaparece, repetir primero el archivo aislado y vigilar el tiempo de arranque de `createApp()`
  cuando la suite corre en paralelo.
- La demo de F1 es local. Una demo pública exige M1 y M2.
- Las nueve desviaciones respecto del SDD están en `design.md` §15 y se aplican al SDD en T-F1-17.
- OpenAPI/Swagger y los proveedores externos quedan diferidos.
- Cierre de F1: solo bloquean los 188 escenarios obligatorios de `scope.md`. Si un deseable no entra,
  se mueve a F2 con una nota en la tarea correspondiente; no se recorta un obligatorio.
