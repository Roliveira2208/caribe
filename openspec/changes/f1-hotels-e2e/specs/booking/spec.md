# Delta: booking — f1-hotels-e2e

## MODIFIED Requirements

### Requirement: Retención de cupo sin sobreventa
Al crear una reserva el sistema SHALL exigir sesión, resolver la agencia desde el producto y fijar el
`user_id` desde la sesión. Dentro de una transacción SHALL bloquear con `SELECT ... FOR UPDATE` todas
las filas de `availability` del producto y las noches del rango `[checkIn, checkOut)`, en orden
ascendente de `night`; SHALL exigir que exista una fila por noche y que en todas se cumpla
`reserved + quantity <= capacity`; SHALL incrementar `reserved` en cada una y crear la reserva en
`PENDING_PAYMENT` con `expires_at`, sus líneas con `hotel_key`, `room_type`, `check_in`, `check_out`,
`quantity`, `nightly_prices`, `subtotal_usd`, `product_title` y `policy_snapshot`. `hotel_key`,
`room_type` y `product_title` son copias del producto al reservar. `subtotal_usd` SHALL ser la suma de
`precio_de_la_noche × quantity` de las noches de la línea y `total_usd` la suma de los subtotales. El
total y los precios SHALL calcularse en el servidor; un monto, una tasa, un precio, un `tenant_id`, un
`user_id` o un `code` enviados por el cliente SHALL rechazarse con 422 `VALIDATION_ERROR`. La base SHALL
impedir `reserved < 0` y `reserved > capacity`.

`check_in` y `check_out` SHALL ser fechas calendario en `America/Caracas`; se SHALL exigir
`check_out > check_in`, fechas no pasadas y un máximo de 30 noches por reserva. `policy_snapshot`,
`nightly_prices`, `subtotal_usd`, `product_title`, `hotel_key`, `room_type`, `check_in`, `check_out` y
`quantity` de una línea SHALL ser inmutables: un trigger `BEFORE UPDATE` SHALL rechazar cualquier
cambio.

El orden de bloqueo SHALL ser determinista: al crear se bloquea primero `availability`; al aprobar,
expirar o cancelar se bloquea primero `bookings` y después `availability`. Las filas de disponibilidad
se bloquean siempre en orden ascendente de `night`.

#### Scenario: Hay cupo en todas las noches
- GIVEN un producto con capacity 5 y reserved 3 en cada una de las 3 noches
- WHEN un cliente reserva quantity 2
- THEN la reserva queda en `PENDING_PAYMENT` y reserved pasa a 5 en las 3 noches

#### Scenario: Falta una noche
- GIVEN un rango con una noche sin fila de disponibilidad para el producto
- WHEN un cliente intenta reservar
- THEN 409 con código `AVAILABILITY_UNAVAILABLE` y no cambia ningún reserved

#### Scenario: No hay cupo suficiente en una noche
- GIVEN un producto con capacity 5 y reserved 4 en la segunda noche del rango
- WHEN un cliente reserva quantity 2
- THEN la API responde 409 con código `AVAILABILITY_EXHAUSTED` y reserved no cambia en ninguna noche

#### Scenario: Reservas concurrentes sobre el último cupo
- GIVEN un producto con un solo cupo libre en una de las noches
- WHEN dos clientes reservan a la vez el mismo rango
- THEN exactamente una reserva se crea y la otra recibe `AVAILABILITY_EXHAUSTED`

#### Scenario: Sin sesión
- WHEN un visitante anónimo intenta crear una reserva
- THEN 401

#### Scenario: Monto, tasa o campo calculado enviados por el cliente
- GIVEN una solicitud con `tenant_id`, `user_id`, `code`, `total_usd`, un precio o una tasa
- WHEN se intenta crear la reserva
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

#### Scenario: Producto no publicado
- GIVEN un producto `DRAFT`, `ARCHIVED` o borrado lógico
- WHEN un cliente intenta reservarlo
- THEN 409 con código `PRODUCT_INACTIVE`

#### Scenario: Fechas inválidas
- WHEN `quantity` es 0 o negativa, `checkIn` es igual o posterior a `checkOut`, las fechas son pasadas o el rango supera 30 noches
- THEN 422 con código `VALIDATION_ERROR`

### Requirement: Vencimiento de la retención
El sistema SHALL liberar el cupo y marcar la reserva `EXPIRED` cuando `expires_at` pase sin pago
aprobado. La retención SHALL tomarse de `tenant_settings.hold_minutes` de la agencia y su valor por
defecto SHALL ser 30 minutos. El trabajo de expiración SHALL correr cada minuto, recorrer las agencias
una por una en su propio contexto, bloquear las reservas vencidas con `FOR UPDATE SKIP LOCKED`, omitir
las que tengan un pago `IN_REVIEW` o `APPROVED`, marcar `EXPIRED` y decrementar `reserved` en cada noche
de sus líneas exactamente una vez. Un pago sobre una reserva `EXPIRED` SHALL responder 410 con código
`HOLD_EXPIRED`.

#### Scenario: Vence sin pago
- GIVEN una reserva `PENDING_PAYMENT` cuyo `expires_at` ya pasó
- WHEN corre el trabajo de expiración
- THEN la reserva pasa a `EXPIRED` y reserved se decrementa por su quantity en cada noche

#### Scenario: Retención configurada
- GIVEN una agencia con `hold_minutes = 15`
- WHEN se crea una reserva
- THEN `expires_at` es 15 minutos después de la creación

#### Scenario: Retención por defecto
- GIVEN una agencia sin `hold_minutes` configurado
- WHEN se crea una reserva
- THEN `expires_at` es 30 minutos después de la creación

#### Scenario: Pago aprobado justo antes de vencer
- GIVEN una reserva `PENDING_PAYMENT` con un pago `IN_REVIEW`
- WHEN `expires_at` pasa mientras el pago sigue en revisión
- THEN la reserva NO expira hasta que el pago se apruebe o rechace

#### Scenario: Pago tardío sobre reserva vencida
- GIVEN una reserva `EXPIRED`
- WHEN el cliente intenta pagarla
- THEN la API responde 410 con código `HOLD_EXPIRED`

#### Scenario: Expiración idempotente
- GIVEN una reserva ya `EXPIRED` con su cupo liberado
- WHEN el trabajo de expiración vuelve a correr
- THEN no decrementa `reserved` otra vez en ninguna noche

#### Scenario: Carrera entre pago y expiración
- GIVEN una reserva sin pago cuyo `expires_at` vence mientras se reporta un pago
- WHEN ambas transacciones compiten
- THEN una gana: si gana el pago, la reserva queda `PENDING_PAYMENT` con el pago en revisión; si gana la expiración, el pago responde 410 `HOLD_EXPIRED`

### Requirement: Idempotencia
`POST /bookings` y `POST /bookings/:id/payments` SHALL exigir el encabezado `Idempotency-Key`. La
clave SHALL tener entre 8 y 128 caracteres y SHALL ser única por usuario y endpoint. El servidor SHALL
guardar un hash del cuerpo, el estado HTTP y una respuesta mínima con el `id` y el `code` del recurso
creado, nunca el cuerpo completo ni datos personales. La misma clave con el mismo cuerpo SHALL devolver
la misma respuesta sin crear una segunda reserva ni un segundo pago. La misma clave con otro cuerpo
SHALL responder 409 con código `IDEMPOTENCY_KEY_REUSED`. Una clave en vuelo SHALL responder 409 con
código `IDEMPOTENCY_KEY_IN_PROGRESS`. La fila SHALL tener `expires_at` a las 24 horas y RLS por
`user_id`; una clave expirada podrá reutilizarse y sus filas se purgan por el trabajo de mantenimiento.
Un reintento idempotente SHALL NOT generar una segunda fila de auditoría.

#### Scenario: Reintento del mismo POST
- GIVEN una solicitud ya procesada con una Idempotency-Key
- WHEN llega otra con la misma clave y cuerpo
- THEN se devuelve la misma respuesta y no se crea una segunda reserva

#### Scenario: Falta la clave
- WHEN llega un `POST /bookings` o `POST /bookings/:id/payments` sin Idempotency-Key
- THEN la API responde 400 con código `IDEMPOTENCY_KEY_REQUIRED`

#### Scenario: Misma clave con otro cuerpo
- GIVEN una clave usada con un cuerpo
- WHEN llega la misma clave con un cuerpo distinto
- THEN 409 con código `IDEMPOTENCY_KEY_REUSED`

#### Scenario: Clave en vuelo
- GIVEN una solicitud con una clave que aún se está procesando
- WHEN llega un segundo intento con la misma clave
- THEN 409 con código `IDEMPOTENCY_KEY_IN_PROGRESS`

#### Scenario: Clave expirada
- GIVEN una clave usada hace más de 24 horas
- WHEN se vuelve a enviar
- THEN se procesa como una solicitud nueva

#### Scenario: Respuesta guardada mínima
- GIVEN una reserva creada con una clave
- WHEN se guarda la respuesta idempotente
- THEN solo contiene el `id` y el `code`, sin viajeros ni datos de pago

#### Scenario: Reintento sin auditoría duplicada
- GIVEN una reserva creada con una clave
- WHEN se repite la solicitud con la misma clave y cuerpo
- THEN no aparece una segunda fila de auditoría de creación

### Requirement: Cancelación
Cancelar SHALL liberar el cupo una sola vez en cada noche de la reserva y aplicar la política de
cancelación guardada en `policy_snapshot` de cada línea, no la política actual del producto. Podrá
cancelar el dueño de la reserva o el personal de la agencia de la reserva. Una reserva `CONFIRMED` con
pago `APPROVED` SHALL generar un reembolso según la spec de pagos. Una reserva `PENDING_PAYMENT` sin
pago SHALL poder cancelarse; si tiene un pago `IN_REVIEW`, la cancelación SHALL rechazarse con 409
`PAYMENT_IN_REVIEW` hasta que el pago se apruebe o rechace. Cancelar una reserva `EXPIRED` o ya
`CANCELLED` SHALL ser idempotente: 200 sin efecto.

#### Scenario: Cliente cancela reserva confirmada
- GIVEN una reserva `CONFIRMED` con política "flexible"
- WHEN el cliente la cancela
- THEN pasa a `CANCELLED`, se libera el cupo en cada noche y se inicia el reembolso según la política

#### Scenario: Cancelar reserva ajena
- GIVEN una reserva de otro cliente
- WHEN un cliente intenta cancelarla
- THEN la API responde 404

#### Scenario: Cancelar una reserva pendiente sin pago
- GIVEN una reserva `PENDING_PAYMENT` sin pagos
- WHEN el cliente la cancela
- THEN pasa a `CANCELLED`, se libera el cupo y no se genera reembolso

#### Scenario: Cancelar con un pago en revisión
- GIVEN una reserva `PENDING_PAYMENT` con un pago `IN_REVIEW`
- WHEN el cliente intenta cancelarla
- THEN 409 con código `PAYMENT_IN_REVIEW` y la reserva no cambia

#### Scenario: Política congelada
- GIVEN una reserva creada con una política que reembolsaba 50 %
- WHEN la agencia cambia la política y luego el cliente cancela
- THEN se aplica la regla guardada en `policy_snapshot`, no la nueva

#### Scenario: Cancelación repetida
- GIVEN una reserva ya `CANCELLED`
- WHEN se vuelve a cancelar
- THEN 200 sin liberar cupo ni reembolsar otra vez

## ADDED Requirements

### Requirement: Código de reserva
Toda reserva SHALL tener un `code` único global, generado por el servidor con el formato `CRB-`
seguido de 8 caracteres en mayúsculas del alfabeto Crockford Base32 (sin `I`, `L`, `O` ni `U`). El
código SHALL resolver la reserva sin conocer la agencia. Un cliente SHALL NOT poder fijar el código.

#### Scenario: Formato y unicidad
- WHEN se crea una reserva
- THEN su código cumple `^CRB-[0-9A-HJKMNP-TV-Z]{8}$` y no existe otro igual

#### Scenario: Colisión de código
- GIVEN un código ya usado
- WHEN el generador produce ese código
- THEN se reintenta y la reserva se crea con otro código

#### Scenario: Código enviado por el cliente
- WHEN el cuerpo incluye un `code`
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

### Requirement: Datos del viajero
La reserva SHALL guardar los datos del viajero en `travelers` (JSONB) con al menos un viajero y como
máximo 9. Cada viajero SHALL tener nombre completo y documento (tipo y número); el teléfono y el correo
SHALL ser opcionales. Los datos SHALL capturarse al crear la reserva y SHALL NOT modificarse después.
Los datos personales SHALL NOT aparecer en logs ni en la auditoría.

#### Scenario: Reserva sin viajeros
- WHEN el cuerpo no incluye `travelers` o la lista está vacía
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Demasiados viajeros
- WHEN se envían 10 viajeros
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Viajero sin documento
- WHEN un viajero no incluye tipo o número de documento
- THEN 422 con el campo en falta

#### Scenario: Datos del viajero en el voucher
- GIVEN una reserva con dos viajeros
- WHEN se genera el voucher
- THEN aparecen los nombres y documentos de ambos

#### Scenario: Sin datos personales en logs ni auditoría
- GIVEN una reserva creada
- WHEN se revisan los logs y la fila de auditoría
- THEN no aparecen nombres, documentos, teléfonos ni correos de los viajeros

### Requirement: Consulta y propiedad
`GET /bookings/:id` SHALL devolver la reserva al dueño o al personal de su agencia. `GET /bookings`
SHALL listar las reservas del usuario autenticado —de todas las agencias donde tenga reservas— o, para
el personal, las de su agencia activa. La lista SHALL aceptar filtro por estado y paginación por cursor.
Una reserva ajena o de otra agencia SHALL responder 404, nunca 403. El detalle SHALL usar el título del
producto guardado en la línea al reservar, no el estado ni el título actual del producto.

#### Scenario: Dueño consulta su reserva
- GIVEN una reserva del cliente
- WHEN la consulta por id
- THEN 200 con sus líneas, estado y `expires_at`

#### Scenario: Producto despublicado después de reservar
- GIVEN una reserva confirmada cuyo producto se despublica
- WHEN el cliente consulta su reserva o descarga el voucher
- THEN ve el título guardado al crear la reserva

#### Scenario: Personal consulta una reserva de su agencia
- GIVEN una reserva de la agencia A
- WHEN un admin de A la consulta
- THEN 200

#### Scenario: Personal de otra agencia
- GIVEN una reserva de la agencia A
- WHEN un admin de B la consulta
- THEN 404

#### Scenario: Mis reservas entre agencias
- GIVEN un cliente con reservas en A y B
- WHEN lista sus reservas
- THEN aparecen las de ambas agencias, sin las de otras personas

#### Scenario: Filtro por estado
- GIVEN reservas `PENDING_PAYMENT` y `CONFIRMED` del mismo cliente
- WHEN lista con estado `CONFIRMED`
- THEN solo aparecen las confirmadas

### Requirement: Transiciones de estado de la reserva
Las transiciones SHALL ser solo: `PENDING_PAYMENT → CONFIRMED`, `PENDING_PAYMENT → CANCELLED`,
`PENDING_PAYMENT → EXPIRED` y `CONFIRMED → CANCELLED`. `CANCELLED` y `EXPIRED` SHALL ser terminales.
Ninguna otra transición SHALL ser posible.

#### Scenario: Confirmar una reserva pendiente
- GIVEN una reserva `PENDING_PAYMENT`
- WHEN se aprueba su pago
- THEN pasa a `CONFIRMED`

#### Scenario: Confirmar una reserva cancelada
- GIVEN una reserva `CANCELLED`
- WHEN se intenta confirmar
- THEN 409 con código `INVALID_STATE_TRANSITION` y el estado no cambia

#### Scenario: Cancelar una reserva vencida
- GIVEN una reserva `EXPIRED`
- WHEN se intenta cancelar
- THEN 200 idempotente sin cambio de estado

### Requirement: Auditoría de reservas
Crear, expirar, cancelar y reembolsar una reserva SHALL escribir una fila en `audit_logs` dentro de la
misma transacción que la acción. La creación SHALL registrar `before` NULL y un `after` con código,
estado, total y agencia; la expiración SHALL registrar actor NULL (sistema), `before` con el estado
anterior y `after` con `EXPIRED`. Si la escritura de auditoría falla, la acción SHALL NOT confirmarse.

#### Scenario: Crear una reserva deja auditoría
- GIVEN un cliente autenticado
- WHEN crea una reserva
- THEN existe una fila de auditoría con la agencia, el actor y el código de la reserva

#### Scenario: Expirar una reserva deja auditoría
- GIVEN una reserva vencida
- WHEN el trabajo de expiración la marca `EXPIRED`
- THEN existe una fila de auditoría con actor NULL y el cambio de estado

#### Scenario: Fallo de auditoría
- GIVEN una base que rechaza la inserción en `audit_logs`
- WHEN se intenta crear una reserva
- THEN la reserva no se confirma

## Casos límite
- quantity 0 o negativa → 422. Fechas pasadas o `checkIn >= checkOut` → 422. Producto inactivo → 409
  `PRODUCT_INACTIVE`.
- Cancelar una reserva `EXPIRED` o ya `CANCELLED` es idempotente: 200 sin efecto.
- Una reserva sin pago aprobado nunca pasa a `CONFIRMED`.
- El trabajo de expiración nunca libera cupo de una reserva con pago `IN_REVIEW` o `APPROVED`.
- Reutilizar una clave de idempotencia con el mismo cuerpo pero otro usuario es una solicitud nueva.
- La reserva ocupa `[checkIn, checkOut)`: la noche de salida no se bloquea ni se cobra.

## Acceptance
- Prueba automatizada de concurrencia sobre el mismo cupo en CI, con varias noches.
- Prueba de que un fallo de cupo en una noche no deja reservado el resto del rango.
- Prueba de carrera entre aprobación de pago y expiración, sin doble decremento.
- Prueba de idempotencia con misma clave y cuerpo, cuerpo distinto y clave en vuelo.
- p95 de creación de reserva < 600 ms en el escenario k6 de 20 usuarios virtuales.

## Out of scope
Reservas con múltiples productos en un solo carrito (el MVP crea una reserva por producto o paquete).
Cambio de fechas de una reserva (solo cancelar y reservar de nuevo). Reserva como invitado sin cuenta.
Retención configurable por producto (solo por agencia en F1).
