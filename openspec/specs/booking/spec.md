# Booking Specification

## Purpose
Crear reservas que retienen cupo durante un tiempo limitado, sin sobreventa, y gestionar su
vencimiento y cancelación. Cliente final y Agente reservan; el cupo es la fuente de conflicto.

## Requirements

### Requirement: Retención de cupo sin sobreventa
Al crear una reserva el sistema SHALL bloquear la fila de `availability` en una transacción
(`SELECT ... FOR UPDATE`), verificar `reserved + quantity <= capacity`, incrementar `reserved` y crear la
reserva en `PENDING_PAYMENT` con `expires_at`.

#### Scenario: Hay cupo
- GIVEN una disponibilidad con capacity 5 y reserved 3
- WHEN un cliente reserva quantity 2
- THEN la reserva queda en `PENDING_PAYMENT` y reserved pasa a 5

#### Scenario: No hay cupo suficiente
- GIVEN una disponibilidad con capacity 5 y reserved 4
- WHEN un cliente reserva quantity 2
- THEN la API responde 409 con código `AVAILABILITY_EXHAUSTED` y reserved no cambia

#### Scenario: Reservas concurrentes sobre el último cupo
- GIVEN una disponibilidad con un solo cupo libre
- WHEN dos clientes reservan a la vez
- THEN exactamente una reserva se crea y la otra recibe `AVAILABILITY_EXHAUSTED`

### Requirement: Vencimiento de la retención
El sistema SHALL liberar el cupo y marcar la reserva `EXPIRED` cuando `expires_at` pase sin pago aprobado.
La retención por defecto es de 30 minutos, configurable por tenant (`hold_minutes`) o producto.
Para inventario externo se usa el vencimiento que devuelva el proveedor.

#### Scenario: Vence sin pago
- GIVEN una reserva `PENDING_PAYMENT` cuyo `expires_at` ya pasó
- WHEN corre el trabajo de expiración
- THEN la reserva pasa a `EXPIRED` y reserved se decrementa por su quantity

#### Scenario: Pago aprobado justo antes de vencer
- GIVEN una reserva `PENDING_PAYMENT` con un pago `IN_REVIEW`
- WHEN `expires_at` pasa mientras el pago sigue en revisión
- THEN la reserva NO expira hasta que el pago se apruebe o rechace

#### Scenario: Pago tardío sobre reserva vencida
- GIVEN una reserva `EXPIRED`
- WHEN el cliente intenta pagarla
- THEN la API responde 410 con código `HOLD_EXPIRED`

### Requirement: Idempotencia
`POST /bookings` y `POST /bookings/:id/payments` SHALL exigir el encabezado `Idempotency-Key`.

#### Scenario: Reintento del mismo POST
- GIVEN una solicitud ya procesada con una Idempotency-Key
- WHEN llega otra con la misma clave y cuerpo
- THEN se devuelve la misma respuesta y no se crea una segunda reserva

#### Scenario: Falta la clave
- WHEN llega un `POST /bookings` sin Idempotency-Key
- THEN la API responde 400

### Requirement: Cancelación
Cancelar SHALL liberar el cupo y aplicar la política de cancelación guardada en `policy_snapshot`
de cada línea (no la política actual del producto).

#### Scenario: Cliente cancela reserva confirmada
- GIVEN una reserva `CONFIRMED` con política "flexible"
- WHEN el cliente la cancela
- THEN pasa a `CANCELLED`, se libera el cupo y se inicia el reembolso según la política

#### Scenario: Cancelar reserva ajena
- GIVEN una reserva de otro cliente
- WHEN un cliente intenta cancelarla
- THEN la API responde 404

## Casos límite
- quantity 0 o negativa → 422. Fechas pasadas → 422. Producto inactivo → 409 `PRODUCT_INACTIVE`.
- Cancelar una reserva `EXPIRED` o ya `CANCELLED` es idempotente: 200 sin efecto.

## Acceptance
- Prueba automatizada de concurrencia sobre el mismo cupo en CI.
- p95 de creación de reserva < 600 ms en el escenario k6 de 20 usuarios virtuales.

## Out of scope
Reservas con múltiples productos en un solo carrito (el MVP crea una reserva por producto o paquete).
Cambio de fechas de una reserva (solo cancelar y reservar de nuevo).
