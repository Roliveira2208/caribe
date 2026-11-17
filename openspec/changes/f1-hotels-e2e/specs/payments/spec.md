# Delta: payments — f1-hotels-e2e

## MODIFIED Requirements

### Requirement: Creación de pago
Al reportar un pago el servidor SHALL calcular `amount_usd`, `amount_ves` y la tasa; el cliente solo
envía método y referencia. `amount_usd` SHALL ser el total de la reserva y `amount_ves` SHALL
calcularse con la tasa congelada de la agencia. El pago SHALL guardar `reported_by` con el usuario de la
sesión y `created_at`. Solo el dueño de la reserva SHALL reportar su pago. La reserva SHALL estar
`PENDING_PAYMENT` y no vencida. El pago SHALL crearse internamente como `PENDING` y salir de la
transacción ya en `IN_REVIEW` (modo MANUAL) o `APPROVED` (modo AUTO); `PENDING` SHALL NOT ser observable
por la API. La tasa y los montos congelados SHALL cumplir la spec de tasas. Un monto, una tasa, un
`tenant_id`, un `user_id` o cualquier campo calculado enviados por el cliente SHALL rechazarse con 422
`VALIDATION_ERROR`; el servidor SHALL NOT ignorarlos.

#### Scenario: Pago en VES por Pago Móvil
- GIVEN una reserva `PENDING_PAYMENT` de 100 USD y tasa 900,0000
- WHEN el cliente reporta Pago Móvil con banco, teléfono y referencia
- THEN se crea el pago con `amount_ves` 90000,00 y la tasa congelada

#### Scenario: Cliente envía un monto o una tasa
- WHEN la solicitud incluye un monto o una tasa distintos a los calculados
- THEN 422 con código `VALIDATION_ERROR` y el pago no se crea

#### Scenario: Reserva vencida
- GIVEN una reserva `EXPIRED`
- WHEN el cliente reporta un pago
- THEN 410 con código `HOLD_EXPIRED`

#### Scenario: Reserva cancelada
- GIVEN una reserva `CANCELLED`
- WHEN el cliente reporta un pago
- THEN 409 con código `BOOKING_CANCELLED`

#### Scenario: Reserva ya confirmada
- GIVEN una reserva `CONFIRMED`
- WHEN el cliente reporta otro pago
- THEN 409 con código `BOOKING_ALREADY_PAID`

#### Scenario: Pago de una reserva ajena
- GIVEN una reserva de otro cliente
- WHEN un cliente reporta su pago
- THEN 404

#### Scenario: Sin sesión
- WHEN un visitante anónimo reporta un pago
- THEN 401

### Requirement: Modo de aprobación
`payment_mode` del tenant SHALL definir el flujo: AUTO aprueba al instante; MANUAL deja el pago en
`IN_REVIEW`. La revisión de un pago (aprobarlo o rechazarlo) SHALL ser exclusiva del Admin de agencia
(`owner` o `admin`) de la agencia del pago, y el revisor SHALL ser una persona distinta de quien reportó
el pago: nadie aprueba ni rechaza su propio pago. La aprobación automática del modo AUTO no es una
revisión y no la ejecuta ninguna persona. Ningún otro rol —agente, proveedor, cliente o Super Admin, que
en negocio es de solo lectura— SHALL revisar pagos. El revisor SHALL guardarse en `reviewed_by` con
`reviewed_at`; un rechazo SHALL exigir un motivo y guardarlo en `rejection_reason`. Aprobar o rechazar
solo SHALL ser posible desde `IN_REVIEW`; dos revisiones concurrentes SHALL resolverse con una sola
ganadora y la otra con 409 `PAYMENT_ALREADY_REVIEWED`.

#### Scenario: Modo AUTO
- GIVEN `payment_mode = AUTO`
- WHEN se reporta un pago
- THEN pasa a `APPROVED` y la reserva a `CONFIRMED`

#### Scenario: Modo MANUAL aprobado
- GIVEN `payment_mode = MANUAL` y un pago `IN_REVIEW`
- WHEN un admin lo aprueba
- THEN el pago es `APPROVED`, la reserva `CONFIRMED` y queda auditado

#### Scenario: Modo MANUAL rechazado
- WHEN un admin lo rechaza con un motivo
- THEN el pago es `REJECTED`, la reserva sigue `PENDING_PAYMENT` hasta que venza o se pague de nuevo
- AND el motivo queda en `rejection_reason`

#### Scenario: Rechazo sin motivo
- WHEN un admin rechaza un pago sin motivo
- THEN 422 con código `VALIDATION_ERROR` y el pago sigue `IN_REVIEW`

#### Scenario: Aprobar sin permiso
- WHEN un agente, proveedor, cliente o Super Admin llama a aprobar o rechazar
- THEN 403

#### Scenario: Revisor distinto del pagador
- GIVEN un pago `IN_REVIEW` reportado por una persona con permiso de revisión
- WHEN esa misma persona intenta aprobarlo o rechazarlo
- THEN 403 y el pago permanece `IN_REVIEW`

#### Scenario: Agencia de una sola persona
- GIVEN `payment_mode = MANUAL` en una agencia cuyo único revisor reportó el pago
- WHEN no existe otro Admin de agencia que pueda revisarlo
- THEN el pago permanece `IN_REVIEW` hasta que actúe otro revisor

#### Scenario: Dos revisiones concurrentes
- GIVEN un pago `IN_REVIEW`
- WHEN dos admins lo revisan a la vez
- THEN solo una revisión se aplica y la otra recibe 409 `PAYMENT_ALREADY_REVIEWED`

#### Scenario: Aprobar sobre una reserva vencida
- GIVEN un pago `IN_REVIEW` cuya reserva quedó `EXPIRED`
- WHEN un admin intenta aprobarlo
- THEN 410 con código `HOLD_EXPIRED` y el pago sigue `IN_REVIEW`

### Requirement: Reembolso
Cancelar una reserva pagada SHALL crear un reembolso sobre los montos USD y VES del pago original (tasa
congelada del día del pago). El porcentaje y las condiciones salen de la política de cancelación de la
agencia. `refund_usd` SHALL ser `round(amount_usd × percentage / 100, 2)` y `refund_ves` SHALL ser
`round(refund_usd × rate_congelada, 2)`, no el porcentaje aplicado al `amount_ves` original. El reembolso
SHALL guardarse como fila append-only en `refunds` con pago, reserva, agencia, montos, tasa, fecha valor,
motivo, actor y fecha. La suma de reembolsos de un pago SHALL NOT superar su `amount_usd`. Un segundo
reembolso sobre el mismo pago SHALL responder 409 `REFUND_ALREADY_ISSUED`. Un porcentaje de 0 % SHALL
NOT crear reembolso y el pago SHALL permanecer `APPROVED`.

#### Scenario: Política flexible con 100 %
- GIVEN una reserva pagada con 100 USD y 90000,00 VES y política que reembolsa 100 %
- WHEN se cancela
- THEN el pago pasa a `REFUNDED` por 100 USD y 90000,00 VES

#### Scenario: Reembolso parcial
- GIVEN una política que reembolsa 50 %
- WHEN se cancela
- THEN el reembolso es 50 USD y 45000,00 VES y el pago queda `PARTIALLY_REFUNDED`

#### Scenario: La tasa cambia después del pago
- GIVEN un pago con tasa congelada 900,0000 y una tasa vigente distinta al cancelar
- WHEN se reembolsa el 50 %
- THEN el reembolso usa 900,0000

#### Scenario: Reembolso del 0 %
- GIVEN una política que reembolsa 0 %
- WHEN se cancela la reserva
- THEN no se crea fila en `refunds` y el pago sigue `APPROVED`

#### Scenario: Reembolso duplicado
- GIVEN un pago ya reembolsado
- WHEN se intenta reembolsar otra vez
- THEN 409 con código `REFUND_ALREADY_ISSUED`

#### Scenario: Reembolso por encima del pago
- WHEN la suma de reembolsos supera `amount_usd`
- THEN la base rechaza la escritura y la API responde 409

## ADDED Requirements

### Requirement: Máquina de estados del pago
Las transiciones SHALL ser solo: `PENDING → IN_REVIEW`, `PENDING → APPROVED`,
`IN_REVIEW → APPROVED`, `IN_REVIEW → REJECTED`, `APPROVED → REFUNDED` y
`APPROVED → PARTIALLY_REFUNDED`. `REJECTED`, `REFUNDED` y `PARTIALLY_REFUNDED` SHALL ser terminales en
F1. Ninguna otra transición SHALL ser posible.

#### Scenario: Aprobar desde `IN_REVIEW`
- GIVEN un pago `IN_REVIEW`
- WHEN se aprueba
- THEN queda `APPROVED`

#### Scenario: Reembolsar un pago en revisión
- GIVEN un pago `IN_REVIEW`
- WHEN se intenta reembolsar
- THEN 409 con código `INVALID_STATE_TRANSITION` y el pago no cambia

#### Scenario: Transición no listada
- GIVEN un pago `REJECTED`
- WHEN se intenta aprobar o reembolsar
- THEN 409 con código `INVALID_STATE_TRANSITION` y el estado no cambia

### Requirement: Datos por método de pago
Los datos de cada método SHALL validarse con un esquema Zod estricto compartido; una clave desconocida
SHALL responder 422. Pago Móvil SHALL exigir banco, teléfono venezolano y referencia de 4 a 20
caracteres alfanuméricos. Zelle SHALL exigir nombre o correo del emisor y número de confirmación.
Binance Pay SHALL exigir identificador de orden. Tarjeta SHALL exigir solo últimos 4 dígitos y marca.
El sistema SHALL NOT aceptar ni almacenar número completo de tarjeta ni CVV. La referencia SHALL ser
única por agencia y método cuando exista; un duplicado SHALL responder 409
`DUPLICATE_PAYMENT_REFERENCE`.

#### Scenario: Pago Móvil sin banco
- WHEN falta el banco, el teléfono o la referencia
- THEN 422 con el campo en falta

#### Scenario: Teléfono inválido
- WHEN el teléfono no cumple el formato venezolano
- THEN 422 con el campo en falta

#### Scenario: Zelle sin confirmación
- WHEN falta el número de confirmación o el nombre del emisor
- THEN 422 con el campo en falta

#### Scenario: Binance sin orden
- WHEN falta el identificador de orden
- THEN 422 con el campo en falta

#### Scenario: Tarjeta de prueba
- WHEN se paga con tarjeta de prueba
- THEN solo se guardan últimos 4 dígitos y marca

#### Scenario: Número completo o CVV
- WHEN el cuerpo incluye `cardNumber`, `pan` o `cvv`
- THEN 422 y el valor no se guarda ni se registra en logs

#### Scenario: Referencia duplicada
- GIVEN un pago de Pago Móvil con referencia 1234 en la agencia A
- WHEN se reporta otro pago con la misma referencia y método en A
- THEN 409 con código `DUPLICATE_PAYMENT_REFERENCE`

#### Scenario: Misma referencia en otra agencia
- GIVEN una referencia usada en la agencia A
- WHEN se usa en la agencia B
- THEN se acepta

### Requirement: Serialización de montos
En las respuestas JSON `amount_usd`, `amount_ves`, `refund_usd`, `refund_ves` y el total de la reserva
SHALL serializarse como cadenas con 2 decimales; `rate` SHALL serializarse como cadena con 4 decimales.
El servidor SHALL NOT usar números de punto flotante para dinero ni aceptar montos del cliente.

#### Scenario: Montos como cadenas
- WHEN se consulta un pago
- THEN `amount_usd` es `"100.00"`, `amount_ves` es `"90000.00"` y `rate` es `"900.0000"`

#### Scenario: Monto enviado por el cliente
- WHEN el cuerpo incluye `amount_usd`, `amount_ves` o una tasa
- THEN 422 con código `VALIDATION_ERROR` y no se usa el valor

### Requirement: Respuesta sin datos internos de la agencia
La representación de un pago SHALL NOT incluir `tenantId` ni `tenant_id`; la agencia se deriva de la
sesión o de la reserva.

#### Scenario: Cliente consulta sus pagos
- WHEN el cliente consulta el pago recién creado o los pagos de su reserva
- THEN la respuesta no incluye `tenantId` ni `tenant_id`

## Casos límite
- Doble reporte del mismo método y referencia → 409 `DUPLICATE_PAYMENT_REFERENCE`.
- Pago sobre reserva `EXPIRED`, `CANCELLED` o ya `CONFIRMED` → 410 `HOLD_EXPIRED` o 409
  `BOOKING_CANCELLED` / `BOOKING_ALREADY_PAID`.
- Pago en USD (Zelle, Binance) guarda `amount_ves` informativo con la tasa congelada.
- Un pago rechazado no libera cupo: la reserva sigue `PENDING_PAYMENT` hasta vencer o recibir otro pago.
- Un pago `IN_REVIEW` impide la expiración de su reserva.
- La aprobación y el cambio de estado de la reserva ocurren en la misma transacción; si falla la
  auditoría, ninguno se confirma.

## Acceptance
- Matriz de transiciones de estado cubierta por tests; ninguna transición no listada es posible.
- Prueba de revisor distinto del pagador y de aprobación concurrente.
- Prueba de que un `cardNumber` o `cvv` en el cuerpo se rechaza y no aparece en logs.
- Prueba de reembolso con tasa congelada y de la suma máxima.

## Out of scope
Cobro real, conciliación bancaria, validación del comprobante, pasarelas externas. Múltiples reembolsos
parciales sobre el mismo pago (F1 emite uno por cancelación). Reembolso iniciado por el cliente sin
cancelar la reserva.
