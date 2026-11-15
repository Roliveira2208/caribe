# Tareas: f1-hotels-e2e
Requiere `f0-foundations` archivada. Una tarea a la vez, un commit por tarea.

> Fase 0 (especificar): deltas de specs y `design.md` aprobados por el dueño el 2026-11-11 con seis
> cambios (inventario por noche, alcance reducido, idempotencia mínima, 422 estricto, `rates_global` y
> PDFs, `minimumReleaseAge`). El alcance por escenario está en `scope.md`.
>
> **Regla de alcance (2026-11-12):** solo los **186 escenarios obligatorios** bloquean el cierre de F1.
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
- [ ] T-F1-5 `ExchangeRateModule`: provider, caché, respaldo, circuit breaker, override con auditoría y
  tenencia global/agencia.
  Prueba: exchange-rates › "Fuente disponible", "Ajuste manual" y "Tenencia de las tasas".
- [ ] T-F1-6 Precio VES informativo en catálogo con la tasa global.
  Prueba: catalog › "Sin tasa disponible" y "Equivalente en VES".
- [ ] T-F1-7 `BookingModule`: crear reserva con retención multi-noche, viajeros, código e
  `Idempotency-Key`.
  Prueba: booking › "Hay cupo en todas las noches", "Reservas concurrentes sobre el último cupo",
  "Falta una noche" e "Idempotencia".
- [ ] T-F1-7b Eliminar los stubs `TODO(F1)` de products/bookings creados en F0.
  Prueba: auth-access › "Ruta protegida sin sesión" y "Catálogo público" con los endpoints reales.
- [ ] T-F1-8 Trabajo de expiración de reservas por agencia, con omisión de pagos en revisión.
  Prueba: booking › "Vence sin pago" y "Carrera entre pago y expiración".
- [ ] T-F1-9 `PaymentModule`: pago simulado, estados y modos AUTO/MANUAL, datos por método, monto
  calculado en servidor y revisor distinto.
  Prueba: payments › "Pago en VES por Pago Móvil" y "Modo MANUAL aprobado".
- [ ] T-F1-9b Admin: organización activa (una membresía auto, varias selector, cero sin panel, Super
  Admin plataforma). Wireframe del selector aprobado antes de construir.
  Prueba: auth-access › "Organización activa en el panel".
- [ ] T-F1-9c Admin: pantalla mínima de aprobación de pagos (`IN_REVIEW`, aprobar/rechazar con motivo).
  Wireframe aprobado antes de construir.
  Prueba: payments › "Modo MANUAL aprobado" y "Modo MANUAL rechazado".
- [ ] T-F1-10 Cancelación y reembolso con `policy_snapshot` y tasa congelada (sin nota de reembolso,
  diferida a F2).
  Prueba: booking › "Cliente cancela reserva confirmada"; payments › "Reembolso parcial".
- [ ] T-F1-10b Pausa planificada: verificación independiente y revisión de seguridad en sesión limpia
  con reservas y pagos ya cerrados (T-F1-7 a T-F1-10), antes de documentos (T-F1-11) y del resto del
  panel y la web (T-F1-13/T-F1-14).
  Prueba: informe de verificación con semáforo y hallazgos de seguridad; los bloqueantes se corrigen
  antes de T-F1-11.
- [ ] T-F1-11 `DocumentModule`: voucher y comprobante PDF en español, QR, numeración correlativa,
  almacenamiento local (`DOCUMENTS_DIR` en `.env.example`), nombre UUID, descarga autenticada con
  propiedad y protección de ruta, y reintentos.
  Prueba: documents › "Voucher", "Comprobante de pago", "Descarga autenticada" y "Ruta manipulada".
- [ ] T-F1-12 `NotificationModule` con un solo correo de confirmación de reserva (SMTP local, `SMTP_*`
  en `.env.example`), `user.locale` y deduplicación. Los demás avisos son F2.
  Prueba: escenarios de `notifications` (spec nueva): confirmación, sin otros avisos e idempotencia.
- [ ] T-F1-13a Web: buscador y resultados. Wireframe aprobado antes de construir.
  Prueba: catalog › "Búsqueda y filtros".
- [ ] T-F1-13b Web: detalle del hotel. Wireframe aprobado antes de construir.
  Prueba: catalog › "Detalle y disponibilidad públicos".
- [ ] T-F1-13c Web: checkout (viajero y moneda). Wireframe aprobado antes de construir.
  Prueba: booking › "Hay cupo en todas las noches" y "Reserva sin viajeros".
- [ ] T-F1-13d Web: pago con cuenta regresiva y métodos. Wireframe aprobado antes de construir.
  Prueba: payments › "Pago en VES por Pago Móvil" y "Datos por método de pago".
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
- [ ] T-F1-17 Actualizar `docs/sdd/SDD.md` con las siete desviaciones canónicas de `design.md` §15
  (`tenant_settings`, `availability` por noche, `PARTIALLY_REFUNDED`,
  `InvoiceProvider.issue(booking, payment?)`, `PENDING` interno, `idempotency_keys` sin `tenant_id` y
  producto = tipo de habitación con `hotel_key`, sin tabla `hotels`).
  Prueba: SDD §5 y §7 coinciden con las specs archivadas; sin cambios en D1–D15.

## Notas heredadas de f0-foundations (siguen abiertas)

- **M1**: configurar `trustedProxies` al decidir el hosting; hoy la IP tras un proxy resuelve a null y
  el rate limit de login degenera en bucket global.
- **M2**: Helmet, CSP y CORS antes de cualquier demo pública (faseados en F5 por el SDD §13).

## Notas de F1

- La demo de F1 es local. Una demo pública exige M1 y M2.
- Las siete desviaciones respecto del SDD están en `design.md` §15 y se aplican al SDD en T-F1-17.
- OpenAPI/Swagger y los proveedores externos quedan diferidos.
- Cierre de F1: solo bloquean los 186 escenarios obligatorios de `scope.md`. Si un deseable no entra,
  se mueve a F2 con una nota en la tarea correspondiente; no se recorta un obligatorio.
