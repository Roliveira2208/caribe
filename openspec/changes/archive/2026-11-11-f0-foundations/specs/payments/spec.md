# Delta: payments — f0-foundations

## MODIFIED Requirements

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
