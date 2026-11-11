# Payments Specification

## Purpose
Registrar pagos simulados (Pago Móvil, Zelle, Binance Pay, tarjeta de prueba) con aprobación automática o
manual, y reembolsar con la tasa congelada.

## Requirements

### Requirement: Creación de pago
Al reportar un pago el servidor SHALL calcular `amount_usd`, `amount_ves` y la tasa; el cliente solo envía
método y referencia.

#### Scenario: Pago en VES por Pago Móvil
- GIVEN una reserva `PENDING_PAYMENT` de 100 USD y tasa 900,0000
- WHEN el cliente reporta Pago Móvil con banco, teléfono y referencia
- THEN se crea el pago con `amount_ves` 90000,00 y la tasa congelada

#### Scenario: Cliente envía un monto
- WHEN la solicitud incluye un monto distinto al calculado
- THEN el monto enviado se ignora y se usa el del servidor

### Requirement: Modo de aprobación
`payment_mode` del tenant SHALL definir el flujo: AUTO aprueba al instante; MANUAL deja el pago en
`IN_REVIEW`. La revisión de un pago (aprobarlo o rechazarlo) SHALL ser exclusiva del Admin de agencia
(`owner` o `admin`) de la agencia del pago, y el revisor SHALL ser una persona distinta de quien reportó
el pago: nadie aprueba ni rechaza su propio pago. La aprobación automática del modo AUTO no es una
revisión y no la ejecuta ninguna persona. Ningún otro rol —agente, proveedor, cliente o Super Admin, que
en negocio es de solo lectura— SHALL revisar pagos.

#### Scenario: Modo AUTO
- GIVEN `payment_mode = AUTO`
- WHEN se reporta un pago
- THEN pasa a `APPROVED` y la reserva a `CONFIRMED`

#### Scenario: Modo MANUAL aprobado
- GIVEN `payment_mode = MANUAL` y un pago `IN_REVIEW`
- WHEN un admin lo aprueba
- THEN el pago es `APPROVED`, la reserva `CONFIRMED` y queda auditado

#### Scenario: Modo MANUAL rechazado
- WHEN un admin lo rechaza
- THEN el pago es `REJECTED`, la reserva sigue `PENDING_PAYMENT` hasta que venza o se pague de nuevo

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

### Requirement: Reembolso
Cancelar una reserva pagada SHALL crear un reembolso sobre los montos USD y VES del pago original (tasa
congelada del día del pago). El porcentaje y las condiciones salen de la política de cancelación de la agencia.

#### Scenario: Política flexible con 100 %
- GIVEN una reserva pagada con 100 USD y 90000,00 VES y política que reembolsa 100 %
- WHEN se cancela
- THEN el pago pasa a `REFUNDED` por 100 USD y 90000,00 VES

#### Scenario: Reembolso parcial
- GIVEN una política que reembolsa 50 %
- WHEN se cancela
- THEN el reembolso es 50 USD y 45000,00 VES

### Requirement: Datos de tarjeta
El sistema SHALL NOT almacenar número completo ni CVV.

#### Scenario: Pago con tarjeta de prueba
- WHEN se paga con tarjeta de prueba
- THEN solo se guardan últimos 4 dígitos y marca

## Casos límite
- Doble reporte del mismo método y referencia → 409 `DUPLICATE_PAYMENT_REFERENCE`.
- Pago sobre reserva `EXPIRED`, `CANCELLED` o ya `CONFIRMED` → 409.
- Pago en USD (Zelle, Binance) guarda `amount_ves` informativo con la tasa del día.

## Acceptance
- Matriz de transiciones de estado cubierta por tests; ninguna transición no listada es posible.

## Out of scope
Cobro real, conciliación bancaria, validación del comprobante, pasarelas externas.
