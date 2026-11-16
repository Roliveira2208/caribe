# Diseño: f1-hotels-e2e

Implementa el primer flujo completo —buscar hotel, reservar con retención, pagar simulado y descargar
voucher/comprobante— sobre el esquema multi-tenant de F0. Este documento fija las decisiones que las
specs delta dejan como contrato; el código las implementa, no las reinventa.

## 1. Decisiones del dueño (2026-11-11)

| # | Decisión | Efecto |
| --- | --- | --- |
| Q1 | Catálogo público con contexto `public` y política `PUBLISHED AND deleted_at IS NULL` | Ver §3 |
| Q2 | Cliente sin membresía: crear por producto, leer por dueño; política combinada por agencia o propietario | Ver §3 y §4 |
| Q3 | Jobs por agencia con `withTenant`; el refresco de la tasa es global y no usa tenant; sin `BYPASSRLS` ni contexto `system` | Ver §3.5 |
| Q4 | Auditoría de intentos: escrituras admin + fallos TOTP en `auth_events`; fallos de credenciales en change futura | Ver §8 |
| Q5 | `auth_events` separada; `audit_logs` conserva acción sensible con antes/después | Ver §8 |
| Q20/Q24 | Atributos de hotel en JSONB, imágenes dentro como URLs (máx. 10, dominios permitidos) | Ver §2.2 |
| Resto | Se aplican las recomendaciones del plan `docs/plans/f1-hotels-e2e-plan.md` | §2–§12 |

## 2. Modelo de datos

Todo se implementa con migraciones Prisma versionadas (`pnpm db:migrate:dev`), nunca `db push`. Las
tablas de negocio llevan `tenant_id`, RLS habilitada y forzada, y las políticas de §3.

### 2.1 Ajustes de la agencia

`tenant_settings` (1:1 con `organization.id`), separada del modelo `organization` que genera Better
Auth:

| Columna | Tipo | Regla |
| --- | --- | --- |
| `tenant_id` | TEXT PK | FK a `organization.id` |
| `hold_minutes` | INTEGER | default 30; CHECK 5–1440 |
| `payment_mode` | ENUM `AUTO`/`MANUAL` | default `AUTO` para la demo; el seed crea una agencia `MANUAL` |
| `base_currency` | TEXT | default `USD`; CHECK `^[A-Z]{3}$` (Prisma no modela CHAR(3) y evita drift) |
| `legal_name` | TEXT | razón social para el comprobante |
| `rif` | TEXT | RIF para el comprobante |
| `address` | TEXT | contacto del voucher |
| `phone` | TEXT | contacto del voucher |
| `email` | TEXT | contacto del voucher |
| `updated_at` | TIMESTAMP | — |

La migración refuerza los límites con `CHECK` y deja RLS habilitada y forzada: la política de agencia
(`FOR ALL`, con `WITH CHECK`) permite leer y escribir solo `tenant_id = app.tenant_id`, y la de
plataforma (`FOR SELECT`) permite leer con `app.platform = 'on'` pero no escribir.

El SDD §5 pone `base_currency`, `payment_mode` y `hold_minutes` en `organization`. No se edita el modelo
generado por Better Auth: la tabla propia evita migraciones que la lib pueda pisar y permite auditoría
del cambio. Es una desviación consciente, listada en §15 y aplicada al SDD en T-F1-17.

`user.locale` se añade por `additionalFields` de Better Auth (soportado por la lib), con `es` por
defecto y `en` soportado. No se crea una tabla `user_settings` para un solo campo.

### 2.2 Catálogo

- `providers`: `id`, `tenant_id`, `user_id`, `name`, `contact`. `user_id` identifica al proveedor que
  puede editar sus productos.
- `destinations`: `id`, `tenant_id`, `name` JSONB `{es,en}`, `country`, `code`. Lectura pública solo de
  nombre, país y código.
- `products`: `id`, `tenant_id`, `provider_id`, `type` (`hotel` en F1), `hotel_key` UUID, `room_type`
  (código estable en minúsculas), `title`/`description` JSONB, `destination_id`, `status`
  (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `base_price_usd` DECIMAL(14,2), `cancellation_policy_id`,
  `source` (`OWN`), `external_ref` NULL, `attributes` JSONB, `deleted_at`.
- **Unidad de venta:** cada fila de `products` es un tipo de habitación vendible de un hotel.
  `hotel_key` agrupa los tipos del mismo hotel y `room_type` los distingue (`standard`, `suite`…). No
  hay tabla `hotels` en F1: título del hotel, `stars`, `amenities` e `images` se repiten en cada tipo.
  Editar los datos de hotel desde el panel actualiza todos los tipos con la misma `hotel_key` en una
  sola transacción; `maxGuests` es la ocupación del tipo. El panel limita a 5 tipos por `hotel_key`
  (validación de aplicación, no de base). La normalización en una tabla `hotels` queda como deuda
  conocida para F2.
- `attributes` de hotel: `stars` 1–5, `maxGuests` 1–20, `amenities` (máx. 30 códigos),
  `images` (máx. 10 URLs `https` de dominios permitidos). Esquema Zod estricto en `packages/shared`;
  el orden del array es el orden de presentación y el alt accesible es el título del producto. La lista
  de dominios permitidos se configura por `ALLOWED_IMAGE_HOSTS` (separada por comas) y el esquema
  compartido la recibe como parámetro.
- `availability`: `id`, `tenant_id`, `product_id`, `night` DATE, `capacity`, `reserved`, `price_usd`
  DECIMAL(14,2). Una fila por producto y noche; `capacity` y `reserved` se cuentan en habitaciones del
  producto y `quantity` de reserva son habitaciones. `night` es una fecha calendario en
  `America/Caracas`; la estancia ocupa `[check_in, check_out)`, la noche de salida no se bloquea ni se
  cobra. El total es `Σ(price_usd_de_la_noche × quantity)`. `CHECK (reserved >= 0 AND reserved <=
  capacity)` y `CHECK (price_usd > 0)`. Único `(product_id, night)`, índice `(night, product_id)` para
  búsquedas por rango e índices `products (type, destination_id, status, deleted_at)` y
  `products (tenant_id, type, destination_id, status)`. Sin rangos ni `btree_gist`: dos filas para la
  misma noche chocan con el único y responden 409 `AVAILABILITY_DUPLICATED`.
- La lectura pública de disponibilidad NO expone `capacity` ni `reserved`: una función SQL
  `public_availability(product_id, from, to)` (o vista equivalente) devuelve solo `night`, `remaining`
  y `price_usd`, y exige producto `PUBLISHED` sin borrado lógico.
- `cancellation_policies`: `id`, `tenant_id`, `name`, `rules` JSONB `[{ hours_before, percentage }]`.
  `rules` tiene entre 1 y 10 reglas, `hours_before` es entero no negativo estrictamente descendente y
  `percentage` entero 0–100; lo valida el esquema Zod y lo refuerza un trigger en la base.
- **Contrato de lectura pública (T-F1-3).** `GET /products` acepta `destinationId`, `checkIn`+`checkOut`
  (juntos), `guests` 1–20, `type=hotel`, `q` (coincidencia simple sin mayúsculas sobre
  `title.es`/`title.en`), `limit` (20 por defecto, máximo 50) y `cursor` opaco. Con fechas exige una
  fila de disponibilidad por cada noche de `[checkIn, checkOut)` con `reserved + 1 <= capacity`, y
  `totalUsd` es la suma de `price_usd` para una habitación; sin fechas lista los publicados aunque no
  tengan disponibilidad y ordena por `basePriceUsd`. Orden precio ASC + id ASC; el cursor base64url
  codifica `{ order, price, id }` con `order` = `base` o `stay:<checkIn>:<checkOut>` y se rechaza con
  422 si no corresponde. Respuesta `{ items, nextCursor }`; cada oferta lleva `id`, `hotelKey`,
  `roomType`, `type`, `title`, `description`, `destination`, `attributes` (incluye `images`),
  `basePriceUsd`, `basePriceVes` y `totalUsd`/`totalVes` (`null` sin fechas). El detalle repite la
  oferta sin `totalUsd`/`totalVes`.
  `GET /products/:id/availability` acepta `from`/`to` y devuelve
  `{ productId, from, to, nights: [{ night, remaining, priceUsd, priceVes }] }`, por defecto 31 noches
  desde hoy en Caracas, nunca `capacity` ni `reserved`. Un producto no público responde 404 en ambas
  lecturas. El VES es informativo y usa la tasa global vigente (USD × tasa, `ROUND_HALF_UP` a 2
  decimales); sin tasa global los campos VES son `null` y el catálogo muestra solo USD (T-F1-6).
- **Contrato del panel (T-F1-4).** `GET/POST /admin/products`, `GET/PUT/DELETE /admin/products/:id` y
  `POST /admin/products/:id/publish|archive`. El listado usa keyset `updated_at DESC, id DESC` con
  `limit` 20 por defecto (máximo 100), cursor opaco y filtros `status`, `providerId`, `hotelKey`,
  `destinationId` y `q` (coincidencia literal sobre `title.es`/`title.en`). La respuesta de panel lleva
  datos internos (`tenantId`, `providerId`, `status`, destino, `hotelKey`, `roomType`, `attributes`,
  precios y timestamps) y nunca `capacity`/`reserved`; `{ items, nextCursor }` en el listado y la ficha
  suelta en el resto. `DELETE` es borrado lógico: todas las lecturas posteriores responden 404.
- **Propiedad y propagación (T-F1-4).** `ProductsGuard` exige la acción `product:*` de la matriz
  (owner/admin/provider) y deja el resto al servicio: un proveedor solo alcanza los productos de su
  `providers.user_id` (403 para otro proveedor de la misma agencia) y un producto de otra agencia
  responde 404. El Super Admin sin agencia activa solo lee (403 en escrituras). En el alta, el admin
  elige `providerId` y el proveedor solo puede usar el suyo; sin `hotelKey` el servidor genera uno nuevo
  y con `hotelKey` se valida el máximo de 5 tipos. Al editar, `title`, `stars`, `amenities` e `images`
  se propagan a todos los tipos no borrados con la misma `hotel_key` en la misma transacción;
  `description`, `roomType`, `maxGuests`, `basePriceUsd`, destino y política de cancelación son del
  tipo editado.

### 2.3 Reservas

- `bookings`: `id`, `tenant_id`, `code` único global `CRB-[0-9A-HJKMNP-TV-Z]{8}`, `user_id`, `status`,
  `total_usd` DECIMAL(14,2), `travelers` JSONB (1–9), `expires_at`, `created_at`.
- `booking_items`: `booking_id`, `tenant_id`, `product_id`, `hotel_key`, `room_type`, `check_in`,
  `check_out`, `quantity`, `nightly_prices` JSONB `[{ night, price_usd }]`, `subtotal_usd`
  DECIMAL(14,2), `product_title` JSONB `{es,en}` (copia del título al reservar), `policy_snapshot`
  JSONB. `hotel_key` y `room_type` son copias del producto al reservar; el detalle y el voucher usan
  `product_title`, no el producto actual. `policy_snapshot` y los precios congelados son inmutables:
  un trigger `BEFORE UPDATE` rechaza cambios en `policy_snapshot`, `nightly_prices`, `subtotal_usd`,
  `product_title`, `hotel_key`, `room_type`, `check_in`, `check_out` y `quantity`.
- Fechas: `check_in` y `check_out` son fechas calendario en `America/Caracas`; se exige
  `check_out > check_in` y un máximo de 30 noches por reserva. Las fechas pasadas se rechazan con 422
  `VALIDATION_ERROR`.
- `idempotency_keys`: `id`, `user_id`, `endpoint`, `key`, `request_hash`, `response_status`,
  `response_body` JSONB, `expires_at`, `created_at`; único `(user_id, endpoint, key)`; TTL 24 h; RLS
  solo por `user_id` (`user_id = app.user_id`), sin `tenant_id`. `response_body` guarda solo `{ id,
  code }` del recurso creado, nunca viajeros ni datos de pago. La agencia se resuelve después de
  consumir la clave y las filas vencidas se purgan por un trabajo de mantenimiento.

### 2.4 Tasas

`exchange_rates`: `id`, `tenant_id` NULL para BCV global, `source`, `rate` DECIMAL(18,4),
`value_date` DATE, `fetched_at` TIMESTAMP UTC, `is_override`, `reason` NULL, `created_by` NULL.
Unicidad:

- filas de agencia: único `(tenant_id, value_date)`;
- filas globales: índice único parcial `(value_date) WHERE tenant_id IS NULL` (en PostgreSQL los NULL
  no colisionan en un único normal).

Precedencia por agencia y fecha: override de la agencia > override global > BCV global. El proveedor
solo escribe la fila BCV global y no toca ninguna fila `is_override`. El catálogo público usa la tasa
global; el pago usa la tasa de la agencia.

### 2.5 Pagos y reembolsos

`payments`: `id`, `tenant_id`, `booking_id`, `method`, `amount_usd` DECIMAL(14,2), `amount_ves`
DECIMAL(14,2), `exchange_rate_id`, `rate` DECIMAL(18,4) (copia), `value_date` DATE (copia),
`reference`, `status`, `reported_by`, `reviewed_by` NULL, `reviewed_at` NULL, `rejection_reason` NULL,
`paid_at` NULL, `created_at`.

- Trigger `BEFORE UPDATE` que rechaza cambios en `exchange_rate_id`, `amount_usd`, `amount_ves`,
  `rate` y `value_date` (defensa en profundidad, como `audit_logs`).
- Único parcial `(tenant_id, method, reference) WHERE reference IS NOT NULL`.
- Estados: `PENDING` interno, `IN_REVIEW`, `APPROVED`, `REJECTED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
  `PARTIALLY_REFUNDED` es una adición a los cinco estados del SDD §5; se justifica porque el reembolso
  parcial es observable y la UI debe distinguirlo. Es una desviación canónica (§15) y se aplica al SDD
  en T-F1-17.

`refunds`: `id`, `tenant_id`, `payment_id`, `booking_id`, `amount_usd` DECIMAL(14,2), `amount_ves`
DECIMAL(14,2), `exchange_rate_id`, `rate` DECIMAL(18,4), `value_date` DATE, `reason`, `created_by`,
`created_at`. Append-only; único por pago en F1. `refund_usd = round(amount_usd × pct/100, 2)`;
`refund_ves = round(refund_usd × rate_congelada, 2)`; la suma no supera `amount_usd`.

### 2.6 Documentos

`documents`: `id`, `tenant_id`, `booking_id`, `payment_id` NULL, `refund_id` NULL, `type`
(`VOUCHER`/`RECEIPT`/`REFUND_NOTE`), `number`, `file_url` relativa, `language` (`es`/`en`), `status`
(`PENDING`/`READY`/`FAILED`), `issued_at`, `error` NULL. En F1 solo se emiten `VOUCHER` y `RECEIPT`, y
`language` es siempre `es`; `REFUND_NOTE` y `en` quedan para F2 aunque el tipo exista. Únicos parciales
por entidad y tipo: `UNIQUE (booking_id) WHERE type = 'VOUCHER'`,
`UNIQUE (payment_id) WHERE type = 'RECEIPT'` y `UNIQUE (refund_id) WHERE type = 'REFUND_NOTE'`.

`document_counters`: `tenant_id`, `type`, `next_value`; se incrementa con
`UPDATE ... RETURNING` dentro de la transacción de emisión. Único `(tenant_id, type, number)` en
`documents`.

### 2.7 Auditoría y avisos

- `auth_events`: `id`, `tenant_id` NULL, `correlation_id`, `phase` (`attempt`/`result`), `actor_id` NULL,
  `route`, `method`, `ip` NULL, `outcome` NULL, `error_code` NULL, `error_status` NULL,
  `error_name` NULL, `entity` NULL, `entity_id` NULL, `at`. Append-only con trigger que rechaza
  `UPDATE`/`DELETE`; RLS por `tenant_id` con visibilidad de plataforma.
- `notification_logs`: `id`, `tenant_id`, `dedupe_key` único, `template`, `recipient`, `locale`,
  `status` (`PENDING`/`SENT`/`FAILED`), `attempts`, `last_error` NULL, `created_at`, `sent_at` NULL.
  No es auditoría.

## 3. Contextos RLS y resolución de tenant

GUC (parámetros de sesión, `set_config(..., true)` dentro de la transacción):

| Contexto | GUC | Quién | Alcance |
| --- | --- | --- | --- |
| `tenant` | `app.tenant_id` | Personal con organización activa | Filas de esa agencia |
| `owner` | `app.user_id` | Cliente autenticado | Filas propias |
| `tenant`+`owner` | `app.tenant_id` + `app.user_id` | Cliente pagando su reserva | Filas de esa agencia o del usuario |
| `public` | `app.public = 'on'` | Catálogo anónimo | `products` `PUBLISHED` sin borrado, su disponibilidad y sus destinos, solo lectura |
| `platform` | `app.platform = 'on'` | Super Admin | Todas las agencias y filas `tenant_id` NULL; escribe solo overrides globales de `exchange_rates` (`tenant_id` NULL) |
| `rates_global` | `app.rates_global = 'on'` | Refresco de la tasa | Solo escritura de `exchange_rates` con `tenant_id` NULL; ninguna otra tabla |

`TenantService` gana `withOwner(userId)`, `withOwnerTenant(userId, tenantId)`, `withPublic()` y
`withRatesGlobal()` junto a `withTenant` y `withPlatform`. Sin GUC, las políticas no devuelven filas y
`WITH CHECK` rechaza escrituras.

### 3.1 Políticas

- Dueño directo: `bookings` por `user_id` y `payments` por `reported_by`. La condición es
  `tenant_id = app.tenant_id OR <propietario> = app.user_id` y el mismo `WITH CHECK`.
  `idempotency_keys` es la excepción: sin `tenant_id`, su política es solo `user_id = app.user_id` en
  lectura y escritura.
- Tablas hijas (`booking_items`, `refunds`, `documents`): el propietario se deriva del `booking` padre
  con `EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.user_id = app.user_id)`; el
  `tenant_id` se compara directo. La escritura usa la misma condición.
- Sin dueño (`providers`, `products`, `availability`, `cancellation_policies`, `tenant_settings`):
  lectura por `tenant_id = app.tenant_id` o `app.platform = 'on'`; escritura por
  `tenant_id = app.tenant_id`. `exchange_rates` añade lectura global (`tenant_id IS NULL`) para los
  contextos `tenant`, `owner` y `public`, y escritura global con `app.rates_global = 'on'` (refresco de
  la tasa) o
  `app.platform = 'on'` (override del Super Admin), siempre con `tenant_id IS NULL`. Ninguno de los dos
  puede leer ni escribir otra tabla ni filas de agencia.
- `products` y `availability`: política `public` de solo lectura con
  `status = 'PUBLISHED' AND deleted_at IS NULL`; la disponibilidad pública exige producto publicado y
  `destinations` es de lectura pública (solo nombre, país y código).
- `audit_logs` y `auth_events`: `tenant_id = app.tenant_id` o `app.platform = 'on'`; nunca `public` ni
  `owner`.
- `bookings`, `booking_items`, `payments`, `refunds` y `documents` añaden una política `*_platform` de
  **solo lectura** (`current_setting('app.platform', true) = 'on'`). El Super Admin ve las reservas y
  pagos de todas las agencias desde el panel, pero no puede escribir en ellas: la escritura sigue
  siendo del personal de la agencia o del dueño. Se añadió en T-F1-9 (migración
  `20261115090000_business_platform_read`) porque la spec exige que `platform` lea todas las agencias.

### 3.2 Resolución del cliente

Crear: sesión obligatoria → leer el producto en contexto `public` → resolver `tenant_id` del producto →
`withTenant` para bloquear las noches del rango e insertar la reserva con `user_id` de la sesión. Leer,
cancelar o descargar: `withOwner(userId)` sin exigir organización activa; las políticas combinadas
devuelven la fila si es del usuario. Pagar: `withOwner` para verificar propiedad → `withOwnerTenant(userId,
booking.tenant_id)` para leer la tasa de la agencia y escribir el pago. El personal usa `withTenant`. Un
cliente puede tener reservas en varias agencias; "Mis reservas" consulta por `user_id` en contexto
`owner`.

### 3.3 Jobs

- Expiración: lista de agencias → por cada una `withTenant` en su propia transacción; un fallo se
  registra y sigue la siguiente. Dentro: `FOR UPDATE SKIP LOCKED` sobre reservas vencidas, omite pagos
  `IN_REVIEW`/`APPROVED`, marca `EXPIRED` y decrementa. El decremento es un único `UPDATE ... FROM
  booking_items` por reserva y la auditoría (`booking.expire`, actor NULL) se escribe en la misma
  transacción. `expireDueBookings(now, organizationIds?)` permite acotar una pasada a agencias
  concretas para un reproceso manual.
- BullMQ v6 (`bullmq@6.7.6`): una cola `caribe-jobs` con un solo planificador por
  `upsertJobScheduler`: `bookings.expire` con `* * * * *`. Cola y worker usan conexiones propias con
  `maxRetriesPerRequest: null`; el worker cierra en `onModuleDestroy`. Sin `REDIS_URL` o con
  `NODE_ENV=test` el planificador no arranca: la API sigue sirviendo y los e2e no dependen de Redis.
- La tasa no tiene trabajo programado (T-F1-5b): `ensureTodayRate()` se dispara al crear una sesión y
  antes de crear un pago, como máximo una vez al día por `fetched_at`. `withRatesGlobal`, sin tenant,
  solo escribe `exchange_rates` globales y no lee ninguna otra tabla.
- PDF y correo: `withTenant` de la reserva/pago para leer y escribir el documento o el registro de
  aviso.
- Ningún job usa `withPlatform` ni un rol con `BYPASSRLS`.

### 3.4 Verificación

La suite de aislamiento corre como `caribe_app` (NOBYPASSRLS, no dueña), con `SET ROLE` en tests. Un
inventario de tablas de negocio falla si alguna no tiene RLS habilitada y forzada. El contexto
`rates_global` se prueba también como `caribe_app`: solo puede escribir filas globales de
`exchange_rates` y no lee ninguna otra tabla.

## 4. Concurrencia y orden de bloqueo

- Crear: bloquear `availability` (`FOR UPDATE`) de todas las noches del rango y del tipo, en orden
  ascendente de `night` → comprobar que hay fila y cupo en todas → incrementar en todas → insertar
  reserva y líneas. Si falta una noche o una no tiene cupo, no se incrementa ninguna.
- Aprobar pago: bloquear `bookings` → revalidar estado y `expires_at` → actualizar pago y reserva.
- Expirar/cancelar: bloquear `bookings` → revalidar → actualizar reserva → bloquear `availability` y
  decrementar una sola vez.
- Nunca se bloquea `bookings` después de `availability` en una operación que ya tenga ambas; el orden
  global es `bookings` antes que `availability`, salvo la creación, que solo toca `availability`.
- `idempotency_keys` se inserta con único `(user_id, endpoint, key)`; una clave en vuelo se detecta por
  la fila existente sin respuesta completa y responde 409 `IDEMPOTENCY_KEY_IN_PROGRESS`. Guarda solo
  `{ id, code }`, expira a las 24 h y se purga por un trabajo de mantenimiento.

## 5. Dinero y tiempo

- `Prisma.Decimal` (decimal.js) en todo cálculo; prohibido `number` para dinero. DECIMAL(14,2) montos,
  DECIMAL(18,4) tasas.
- Redondeo `ROUND_HALF_UP` a 2 decimales en VES; la tasa conserva 4.
- JSON: montos y tasas como cadenas (`"100.00"`, `"900.0000"`); fechas ISO 8601 UTC y `value_date`
  `YYYY-MM-DD` en `America/Caracas`.
- `amount_usd` de un pago = total de la reserva; `amount_ves = round(amount_usd × rate, 2)`.
- `subtotal_usd` de una línea = `Σ(price_usd_de_la_noche × quantity)`; `total_usd` de la reserva =
  `Σ(subtotal_usd)`. Con precio constante equivale a `precio por noche × habitaciones × noches`.
- Un monto, una tasa, un precio o un campo calculado enviados por el cliente se rechazan con 422
  `VALIDATION_ERROR`; el servidor no los ignora.
- Reembolso: USD primero, VES desde el USD reembolsado con la tasa congelada (no el VES original por
  porcentaje).
- Las horas de una regla `hours_before` se cuentan desde las 15:00 de `America/Caracas`
  (`CHECK_IN_HOUR = 15`, `19:00Z` en F1) del día de check-in; con el check-in ya pasado no se reembolsa.

## 6. Tasas

- `ExchangeRateProvider` (interfaz en `packages/shared`): `getRate(date: string)`, timeout 5 s, un
  reintento, circuit breaker 3 fallos consecutivos / 60 s. `CotizaveProvider` la implementa contra
  `COTIZAVE_API_URL` (`https://api.cotizave.com/v2/fx/VE/rates`) con la cabecera `X-API-Key` leída de
  `COTIZAVE_API_KEY` (nunca en la URL ni en logs); elige la tasa `id = "ve-bcv"` y lee `mid`. La tasa se
  recibe como texto decimal y se acepta solo si es > 0 y tiene ≤ 4 decimales; un valor inválido o la
  ausencia de la clave se tratan como fallo del proveedor. `value_date` sale de `effective_date` si la
  fuente lo publica; si no, de `updated_at` convertido a `America/Caracas`; si tampoco, de la fecha
  pedida (un fin de semana conserva la del viernes).
- `ExchangeRateService`: precedencia por fecha y ámbito: override de agencia > override global > tasa
  BCV global. Respaldo: última `value_date <= hoy` (Caracas) del ámbito. Sin ninguna fila → 503
  `RATE_UNAVAILABLE`.
- Caché en Redis (`REDIS_URL`) con TTL de 1 h para el resultado del proveedor global; si Redis no
  responde, caché en memoria del proceso. La caché no sustituye la lectura de respaldo: al expirar se
  vuelve a resolver. La instancia que usa el hook de login no abre Redis: su caché es solo en memoria.
- `ensureTodayRate()` (T-F1-5b): comprueba si hay una fila global con `fetched_at` de hoy en
  `America/Caracas` (`("fetched_at" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Caracas')::date`). Si la
  hay, no llama al proveedor; si no, obtiene la tasa (caché de 1 h), hace upsert de la fila global
  (`tenant_id NULL`, `is_override = false`, `source = 'COTIZAVE'`) con `fetched_at` UTC y nunca pisa una
  fila `is_override`. Un fallo del proveedor se registra como advertencia y conserva la fila guardada;
  la resolución posterior decide el 503. Las comprobaciones simultáneas del proceso comparten una sola
  promesa.
- Disparo del refresco: `databaseHooks.session.create.after` de Better Auth lo lanza en segundo plano
  (`void ... .catch(...)`) y `PaymentsService.create` lo espera antes de abrir la transacción del pago.
  El login no espera al proveedor. No hay trabajo de tasa en BullMQ.
- **Confirmación (T-F1-10b, por escrito):** se usa **Cotizave** (`ve-bcv`, tasa BCV vía `X-API-Key`) por
  decisión del dueño (T-F1-5b, desviación §15.9): reemplaza DolarAPI y el refresco diario programado por
  una fuente con clave y un refresco perezoso (al login y al alta de pago), acotado a una vez al día por
  `fetched_at` en `America/Caracas`, sin bloquear el login. **Respaldo si la fuente cae:** el proveedor
  falla controlado (timeout/reintento/circuit breaker/clave ausente o respuesta inválida), se registra
  advertencia, no se pisa la tasa existente y la resolución usa la última fila global guardada con
  `value_date <= hoy` (Caracas) según la precedencia configurada; si no hay ninguna fila utilizable, el
  consumo responde **503 `RATE_UNAVAILABLE`** (catálogo conserva solo USD cuando no hay tasa global
  informativa). **No hay ninguna clave real versionada:** `COTIZAVE_API_KEY` se lee solo de variable de
  entorno y se envía únicamente en la cabecera saliente `X-API-Key` (nunca en URL, logs ni respuestas);
  `.env.example` y `apps/api/test/setup-env.ts` usan placeholders de prueba (`ctz_live_test_no_usar`) y
  las verificaciones (`git grep`/historial) no muestran claves reales en el repositorio.
- Override de agencia: `PUT /api/v1/admin/exchange-rates/override`, cuerpo estricto
  `{ rate: string, valueDate?: string, reason: string }` (motivo obligatorio, no vacío; `valueDate` por
  defecto hoy en Caracas; fecha no pasada). Exige organización activa y permiso `exchange-rate:update`;
  escribe la fila con el `tenant_id` de la agencia y `is_override = true` en `withTenant`, y deja
  auditoría con antes/después en la misma transacción.
- Override global: `PUT /api/v1/admin/exchange-rates/global-override`, mismo cuerpo, solo Super Admin
  (`@Auditable({ platform: true })`); escribe con `withPlatform` una fila `tenant_id NULL` e
  `is_override = true`, y deja auditoría de plataforma en la misma transacción. Reemplaza la fila BCV
  global de esa fecha (unicidad parcial por `value_date`).
- Lectura: `GET /api/v1/admin/exchange-rates/current` devuelve `{ scope, valueDate, rate, source,
  isOverride }` con la tasa vigente del ámbito de la sesión (agencia con organización activa; global para
  el Super Admin). Las tasas se serializan como cadena con 4 decimales.
- El catálogo público usa la tasa global (T-F1-6) sin disparar al proveedor ni escribir en la base; el
  alta de un pago resuelve su tasa congelada con la precedencia override de agencia > global (T-F1-9).
- Sin tasa global: catálogo solo USD (`basePriceVes`, `totalVes` y `priceVes` en `null`). El alta de un
  pago siempre exige una tasa (agencia o global): sin ninguna fila responde 503 `RATE_UNAVAILABLE` y no
  crea el pago. La UI deshabilita el pago en VES cuando no hay tasa y conserva USD.
- `ExchangeRateService.rateForPayment(tx, tenantId, date)` corre dentro de la transacción del pago y
  devuelve `{ id, rate, valueDate }`; el pago guarda `exchange_rate_id`, `rate` y `value_date`, y el
  trigger `payments_frozen` impide recalcularlos después.

## 7. Pagos

Rutas (desviación del SDD, §15):

- `POST /api/v1/bookings/:id/payments` (cliente dueño, `Idempotency-Key` obligatoria): reporta el pago de
  una reserva propia y responde 201 con el pago serializado.
- `GET /api/v1/bookings/:id/payments` (cliente dueño): `{ items }` con los pagos de su reserva; 404 si la
  reserva es ajena. El personal consulta desde el panel.
- `GET /api/v1/admin/payments` y `GET /api/v1/admin/payments/:id` (owner/admin/agente con `payment:read`;
  Super Admin sin agencia como plataforma): keyset `createdAt DESC, id DESC`, `limit` 20 (máx. 50),
  filtros `status`, `method` y `bookingId`, cursor opaco; fuera de alcance 404.
- `PATCH /api/v1/admin/payments/:id/approve` y `.../reject` (owner/admin con `payment:review`; Super
  Admin 403): 200 con el pago; el rechazo exige `{ reason }` no vacío de hasta 500 caracteres.

Alta:

- El cuerpo es la unión discriminada estricta de `packages/shared` (`paymentBodySchema`): solo método y
  sus datos. `PAGO_MOVIL { bank, phone, reference }`, `ZELLE { senderName?, senderEmail?,
  confirmationNumber }` (exige nombre o correo), `BINANCE_PAY { orderId }` y `CARD { last4, brand }`.
  En base, `reference` guarda la referencia, confirmación u orden; con tarjeta queda `null`.
  `cardNumber`, `pan` y `cvv` no se declaran: responden 422 y no se registran.
- `amount_usd` = `bookings.total_usd`; `amount_ves = round(amount_usd × rate, 2)` con `ROUND_HALF_UP` y
  la tasa congelada de `rateForPayment`. Montos, tasas, `tenant_id`, `user_id`, estados y fechas
  enviados por el cliente → 422 `VALIDATION_ERROR`.
- La reserva debe ser del usuario (404 si no) y estar `PENDING_PAYMENT` y vigente: `EXPIRED` o
  `expires_at <= now` → 410 `HOLD_EXPIRED`; `CANCELLED` → 409 `BOOKING_CANCELLED`; `CONFIRMED` → 409
  `BOOKING_ALREADY_PAID`.
- Idempotencia: la clave se reclama en una transacción propia antes de tocar la reserva y se libera si el
  alta falla; la respuesta guardada es exactamente `{ id, status }`. El reintento con el mismo cuerpo
  devuelve la misma respuesta (201); la misma clave con otro cuerpo → 409 `IDEMPOTENCY_KEY_REUSED`.
- `PENDING` es interno: el pago nace y sale de la transacción en `APPROVED` (AUTO, confirma la reserva) o
  `IN_REVIEW` (MANUAL). `tenant_settings.payment_mode` decide; sin fila, AUTO.
- Referencia duplicada en la misma agencia (`(tenant_id, method, reference)` parcial) → 409
  `DUPLICATE_PAYMENT_REFERENCE`; la misma referencia en otra agencia se acepta.
- Auditoría `payment.create` con el antes/después en la misma transacción (`AuditService.record` dentro
  de `withOwnerTenant`: el cliente puede no tener agencia activa).

Revisión:

- Solo owner/admin de la agencia con `payment:review`, distintos de `reported_by`: el pagador que intenta
  revisar su propio pago recibe 403. Agente, proveedor, cliente y Super Admin → 403.
- Un estado terminal observado en la lectura inicial → 409 `INVALID_STATE_TRANSITION`; el cambio entre la
  lectura inicial y el bloqueo (dos revisiones concurrentes) → 409 `PAYMENT_ALREADY_REVIEWED`.
- Aprobar bloquea la reserva: `EXPIRED` o `expires_at <= now` → 410 `HOLD_EXPIRED` (el pago sigue
  `IN_REVIEW`); `CANCELLED` → 409; ya pagada → 409; si procede, la reserva pasa a `CONFIRMED`. El
  rechazo guarda `rejection_reason` y deja la reserva pendiente.
- Aprobar y rechazar van con `@Auditable` (`payment.approve`/`payment.reject`) en la misma transacción que
  el pago y la reserva; si la auditoría falla, no se confirma nada.
- Un pago `IN_REVIEW` impide la expiración de su reserva (T-F1-8); la carrera pago/expiración la gana una
  sola transacción.

Serialización y proveedor:

- El pago expone `id`, `tenantId`, `bookingId`, `method`, `status`, `amountUsd`, `amountVes`, `rate`,
  `valueDate`, `reference`, `reportedBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `paidAt` y
  `createdAt`; montos con 2 decimales, tasa con 4 y fechas ISO 8601 UTC.
- `SimulatedPaymentProvider` detrás de `PaymentProvider` (token `PAYMENT_PROVIDER`): AUTO devuelve
  `APPROVED` y MANUAL `IN_REVIEW`; no hay cobro real.
- Reembolsos (`refunds`, `REFUNDED`/`PARTIALLY_REFUNDED`, `REFUND_ALREADY_ISSUED`) se implementan en
  T-F1-10; 0 % no reembolsa.

Cancelación y reembolso:

- `POST /api/v1/bookings/:id/cancel` (dueño; owner/admin de la agencia; agente sobre las propias;
  proveedor y Super Admin sin agencia → 403). Sin `Idempotency-Key`: repetir la cancelación es
  idempotente. Responde 200 con `{ id, code, status, refund }`; `refund` es `null` o
  `{ id, amountUsd, amountVes, rate, valueDate, paymentStatus }`.
- Autorización: una reserva ajena responde 404; el owner/admin solo opera sobre reservas de su agencia
  activa; el agente solo sobre las de su `user_id` (404 sobre las demás).
- Orden de bloqueo: `bookings` → revalidar → `availability`; el pago se lee y actualiza en la misma
  transacción. La cancelación corre en `withOwnerTenant` con el tenant de la reserva porque
  `availability_tenant` exige el GUC de la agencia.
- `CANCELLED`/`EXPIRED` → 200 sin liberar cupo ni reembolsar (si ya estaba `CANCELLED`, devuelve el
  reembolso existente); un pago `IN_REVIEW` → 409 `PAYMENT_IN_REVIEW`; un pago ya reembolsado con la
  reserva no cancelada → 409 `REFUND_ALREADY_ISSUED`. La base refuerza el tope con
  `refunds_limit_sum`, que rechaza cualquier suma por encima del pago.
- Reembolso: se aplica la primera regla del `policy_snapshot` (orden descendente) con
  `hoursUntilCheckIn >= hours_before`; sin reglas o check-in pasado → 0 % (sin fila y el pago sigue
  `APPROVED`). `refund_usd = round(amount_usd × pct / 100, 2)` y `refund_ves = round(refund_usd ×
  rate_congelada, 2)` con `ROUND_HALF_UP`. El pago pasa a `REFUNDED` si cubre el total o
  `PARTIALLY_REFUNDED` si no. Se llama a `PaymentProvider.refund` antes de insertar; la fila `refunds`
  es append-only y única por pago.
- Auditoría `booking.cancel` y `booking.refund` dentro de la transacción; el reembolso registra montos,
  tasa congelada, fecha valor y `refundId`.

## 8. Auditoría

- `audit_logs`: acciones confirmadas con antes/después, misma transacción en handlers; middleware de
  Better Auth después de confirmar, en transacción propia.
- `auth_events`: intento + resultado con `correlation_id`; escritura del intento falla cerrada,
  resultado best-effort; `after` no corre si `before` lanza, así que el rechazo TOTP escribe su
  resultado en el `catch`; sin sesión o rate limit no hay filas.
- Eventos cubiertos: escrituras admin de Better Auth y rechazos TOTP. Credenciales de login, en una
  change futura.
- Consulta: `GET /admin/auth-events` (Super Admin todo; Admin de agencia lo suyo).

## 9. Documentos

- PDF con `pdfkit`; QR con `qrcode`. `InvoiceProvider.issue(booking, payment?)` con
  `FreeFormReceiptProvider`; la firma con pago opcional cubre voucher y comprobante (el SDD §7 decía
  `issue(booking)`; la spec de documentos manda).
- Directorio local `DOCUMENTS_DIR` (fuera del repo); nombre de archivo UUID no adivinable, nunca el
  código de reserva ni el número del documento; `file_url` relativa; descarga autenticada con
  comprobación de propiedad/agencia y protección contra `..` (400 `INVALID_PATH`).
- Numeración por `document_counters` en transacción; único por entidad y tipo para idempotencia.
- Reintentos BullMQ 3 con espera creciente; `PENDING`/`READY`/`FAILED`.
- Leyenda "Documento no fiscal" en todas las páginas; en F1 el PDF se emite en español.
- La nota de reembolso, el PDF en inglés y el reintento manual quedan para F2. Al elegir hosting se
  migra a almacenamiento externo (S3/Blob) manteniendo la ruta autenticada y los nombres no
  adivinables; el disco local es solo para desarrollo y demo local.

## 10. Errores y validación

- Problem Details (RFC 9457) en `/api/v1/*` con `code` estable; `/api/auth/*` conserva el formato de
  Better Auth salvo `TWO_FACTOR_REQUIRED`.
- Zod compartido en `packages/shared`, esquemas estrictos, pipe de validación en Nest (nuevo). Las
  claves desconocidas se rechazan con 422. Los campos que el servidor calcula (`tenant_id`, `user_id`,
  `total_usd`, `amount_usd`, `amount_ves`, `rate`, `code`, estados y fechas derivadas) no se declaran
  en los esquemas de entrada: enviarlos responde 422 `VALIDATION_ERROR` y su valor no se usa. El
  servidor no ignora campos calculados. `cardNumber`, `pan` y `cvv` tampoco se declaran y se rechazan.
- Montos y tasas como cadenas; 404 para recursos de otro ámbito; 500 sin traza ni SQL, con
  identificador de correlación.

## 11. Notificaciones

- `NotificationProvider` con SMTP (`nodemailer`); Mailpit en desarrollo; doble en tests.
- Un solo aviso en F1: reserva confirmada. Pago aprobado, pago rechazado, cancelación y expiración
  quedan para F2.
- `user.locale` (`es`/`en`, respaldo `es`); plantillas en ambos idiomas.
- `notification_logs` con clave de deduplicación; reintentos no duplican; fallo no revierte la reserva.

## 12. Dependencias nuevas

Justificadas aquí, con pin exacto al instalar y revisión de `pnpm-workspace.yaml` (`allowBuilds`) después:

- `bullmq` + `ioredis`: expiración, PDF, correo y caché de tasa (D13). `ioredis` entra en T-F1-5 para
  la caché de 1 h; `bullmq` entra en T-F1-8 con el primer trabajo programado.
- `nodemailer`: correo SMTP.
- `pdfkit`: generación de PDF sin navegador.
- `qrcode`: QR del voucher.

Antes de instalar cualquier dependencia nueva se comprueba que cumple `minimumReleaseAge` de pnpm 12.
Hoy `pnpm config get minimumReleaseAge` devuelve `undefined`, así que aplica la ventana por defecto de
pnpm 12; una exclusión en `minimumReleaseAgeExclude` exige justificación escrita en este apartado. Tras
instalar se revisa `pnpm-workspace.yaml`: pnpm 12 reescribe `allowBuilds` y puede perder aprobaciones
previas (ya ocurrió con `esbuild`).

No se habilita `btree_gist` ni ninguna extensión nueva: la disponibilidad por noche se protege con el
único `(product_id, night)`. Las variables nuevas (`ALLOWED_IMAGE_HOSTS`, `DOCUMENTS_DIR`,
`SMTP_*`) se documentan en `.env.example`; los secretos no se versionan.

No se añaden pasarelas, SDK de Duffel/LiteAPI ni librerías de UI nuevas en F1.

## 13. Frontend y wireframes

Cada pantalla empieza por un SVG de baja fidelidad en `docs/wireframes/`, indexado en el README y
aprobado por el dueño antes de implementarla. Pantallas F1:

- Web: búsqueda/resultados, detalle, checkout (viajero + moneda), pago (métodos + cuenta regresiva),
  confirmación (voucher/comprobante), "Mis reservas" (lista/detalle), cancelación y descarga.
- Admin: selector de organización, aprobación mínima de pagos.
- Cada wireframe muestra USD + VES con tasa y fecha valor, cuenta regresiva, estados del pago, campos
  por método, leyenda "Documento no fiscal", estados vacío/carga/error y orden de foco por teclado.

## 14. Fuera de alcance y diferidos

- OpenAPI/Swagger: F5.
- Proveedores externos (Duffel, LiteAPI) y `InventoryProvider` externo: fase posterior; F1 usa
  `OwnInventoryProvider`.
- Reserva como invitado, reserva en nombre de otra persona, retención por producto, múltiples
  reembolsos parciales, persistencia de agencia activa entre sesiones, notificaciones push/WhatsApp.
- Avisos de pago aprobado, pago rechazado, cancelación y expiración; PDF en inglés; nota de reembolso;
  reintento manual de documentos. Todo F2.
- Almacenamiento externo de PDF (S3/Blob) y enlaces públicos firmados: al elegir hosting; F1 usa disco
  local con ruta autenticada y nombres UUID.
- M1 (`trustedProxies`) y M2 (Helmet/CSP/CORS) siguen pendientes y bloquean una demo pública, no el
  desarrollo local.

## 15. Desviaciones canónicas respecto del SDD

Nueve decisiones de F1 difieren del SDD §5 y §7. Se aplican en el código y en las specs; al cerrar F1 se
actualiza el SDD con esta lista (tarea T-F1-17), sin cambiar las decisiones D1–D15.

| # | SDD | F1 | Motivo |
| --- | --- | --- | --- |
| 1 | Ajustes de agencia en `organization` | Tabla `tenant_settings` | No editar el modelo generado por Better Auth |
| 2 | Disponibilidad por rango (`starts_on`/`ends_on`, exclusión `gist`) | Una fila `availability` por `(product_id, night)` | Precio y cupo por noche; sin `btree_gist` |
| 3 | Estados de pago sin reembolso parcial | `PARTIALLY_REFUNDED` añadido | Reembolso por política sobre el total |
| 4 | `InvoiceProvider.issue(booking)` | `InvoiceProvider.issue(booking, payment?)` | Una interfaz cubre voucher y comprobante |
| 5 | Pago creado `PENDING` visible | `PENDING` interno; sale `IN_REVIEW` o `APPROVED` | Evitar un estado intermedio observable |
| 6 | `idempotency_keys` con `tenant_id` | Sin `tenant_id`; RLS solo por `user_id` | La agencia se resuelve después de consumir la clave |
| 7 | Producto de hotel con tabla `hotels` separada | `products` es el tipo de habitación, agrupado por `hotel_key`; sin tabla `hotels` en F1 | Una fila vendible por tipo; normalización a `hotels` como deuda de F2 |
| 8 | Revisión de pagos en `PATCH /payments/:id/approve` y `/payments/:id/reject` | `PATCH /admin/payments/:id/approve` y `/reject`; listado y detalle en `/admin/payments`; pagos del cliente en `GET /bookings/:id/payments` | El panel vive bajo `/admin` y hereda TOTP y permisos `payment:*`; el cliente solo ve sus propios pagos |
| 9 | Fuente DolarAPI y refresco diario programado (SDD §7.5 y §7.7) | Fuente Cotizave (`ve-bcv`, `X-API-Key`) y refresco perezoso al login y al alta de pago, una vez al día por `fetched_at` | El dueño pidió una fuente con clave y sin cron; el login no se bloquea y el respaldo es la última fila guardada |
