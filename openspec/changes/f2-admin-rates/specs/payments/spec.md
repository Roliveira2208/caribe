# Delta: payments — f2-admin-rates

## ADDED Requirements

### Requirement: Panel de aprobación de pagos
El panel de aprobación de `apps/admin` SHALL listar los pagos de la agencia activa con filtros y
paginación resueltos en el servidor, y SHALL permitir aprobar o rechazar solo a un owner o admin de
agencia con TOTP activo que sea distinto de quien reportó el pago. El Super Admin SHALL tener acceso de
solo lectura a los pagos de negocio, sin acciones de revisión; un rol sin permiso de lectura SHALL
recibir 403 `FORBIDDEN` sin filas ni resumen. La UI SHALL mostrar `amount_usd`, `amount_ves`, `rate` y
`exchange_rate_id` como cadenas calculadas en el servidor y SHALL NOT calcular ni enviar montos,
`amount_ves`, `exchange_rate_id` ni tasas; un cuerpo con campos calculados SHALL responder 422
`VALIDATION_ERROR`. Todo texto visible SHALL salir de mensajes es/en y los controles SHALL tener
etiquetas accesibles y foco visible.

#### Scenario: Listado filtrable
- GIVEN pagos `IN_REVIEW`, `APPROVED` y `REJECTED` de la agencia A
- WHEN un admin de A con TOTP activo lista con un filtro de estado y paginación
- THEN se devuelven solo los pagos de A que coinciden, paginados por el servidor
- AND los montos y la tasa llegan como cadenas calculadas en el servidor, sin cálculo en la UI

#### Scenario: Aprobar con TOTP
- GIVEN un pago `IN_REVIEW` de la agencia A y un admin de A con TOTP activo distinto de quien lo reportó
- WHEN confirma la aprobación desde el panel
- THEN el pago pasa a `APPROVED`, la reserva a `CONFIRMED` y quedan `reviewed_by`, `reviewed_at` y la auditoría
- AND un admin sin TOTP recibe 403 `TWO_FACTOR_REQUIRED` y la UI lo lleva a activar el segundo factor sin escribir nada

#### Scenario: Rechazo con motivo en el panel
- GIVEN un pago `IN_REVIEW` y un revisor distinto de quien lo reportó con TOTP activo
- WHEN rechaza desde el panel escribiendo `reason` "Comprobante ilegible"
- THEN el pago pasa a `REJECTED`, la reserva sigue `PENDING_PAYMENT` y el motivo queda en `rejection_reason`
- AND sin motivo responde 422 `VALIDATION_ERROR` y el pago sigue `IN_REVIEW`

#### Scenario: Revisor distinto del pagador en la UI
- GIVEN un pago `IN_REVIEW` reportado por un owner o admin con permiso de revisión
- WHEN ese mismo usuario abre el detalle en el panel
- THEN ve el pago pero las acciones de aprobar y rechazar están deshabilitadas con el mensaje es/en correspondiente
- AND si fuerza la petición recibe 403 `FORBIDDEN` y el pago permanece `IN_REVIEW`

#### Scenario: Par congelado solo lectura
- GIVEN un pago con `amount_usd`, `amount_ves`, `rate` y `exchange_rate_id` congelados
- WHEN el revisor abre el detalle en el panel
- THEN esos campos se muestran como texto de solo lectura serializado por el servidor, sin inputs ni recálculo
- AND una petición que incluya `amountUsd`, `amountVes`, `amount_ves`, `exchange_rate_id` o una tasa responde 422 `VALIDATION_ERROR`

#### Scenario: Revisión concurrente en la UI
- GIVEN dos revisores con el detalle del mismo pago `IN_REVIEW` abierto
- WHEN uno aprueba y el otro intenta rechazar justo después
- THEN la segunda petición responde 409 `PAYMENT_ALREADY_REVIEWED`
- AND la UI del segundo recarga el estado `APPROVED` y deshabilita las acciones, sin mostrar un segundo resultado

#### Scenario: Sin permiso de lectura de pagos
- GIVEN un `member` o proveedor con agencia activa y sin `payment:read`
- WHEN abre el panel de aprobación de pagos
- THEN responde 403 `FORBIDDEN`, sin filas ni resumen
- AND el Super Admin puede consultar el listado en solo lectura, sin controles de aprobación ni rechazo

#### Scenario: Pago de otra agencia
- GIVEN un pago de la agencia B
- WHEN un admin de la agencia A intenta verlo, aprobarlo o rechazarlo desde el panel
- THEN responde 404 y el listado de A no incluye la fila

#### Scenario: Exportación CSV de pagos
- GIVEN un admin de A con TOTP activo y un filtro aplicado en el panel
- WHEN exporta los pagos a CSV
- THEN el archivo contiene solo los pagos de A que coinciden con el filtro, con montos y tasa como cadenas del servidor
- AND no incluye `tenantId`, `tenant_id`, número de tarjeta ni CVV

#### Scenario: Columnas configurables
- GIVEN un revisor con el panel de aprobación abierto
- WHEN elige qué columnas mostrar y vuelve a abrir el panel
- THEN solo se muestran columnas de campos devueltos por la API, con etiquetas de es/en y foco visible
- AND la configuración no cambia los datos, los filtros ni el ámbito de la agencia

#### Scenario: Estado vacío
- GIVEN una agencia sin pagos o un filtro sin coincidencias
- WHEN se abre el listado
- THEN se muestra un mensaje vacío de es/en con etiqueta accesible y foco visible
- AND no se muestran resúmenes, filas de otras agencias ni datos de ejemplo

#### Scenario: Estado de error
- GIVEN una petición fallida del panel
- WHEN la API responde 403 `TWO_FACTOR_REQUIRED`, 403 `FORBIDDEN`, 403 `ACTIVE_ORGANIZATION_REQUIRED`, 404, 409 `PAYMENT_ALREADY_REVIEWED` o 422 `VALIDATION_ERROR`
- THEN la UI muestra el mensaje de error de es/en correspondiente con una etiqueta accesible y mueve el foco al aviso
- AND `TWO_FACTOR_REQUIRED` lleva a activar TOTP y `ACTIVE_ORGANIZATION_REQUIRED` pide elegir una agencia válida, sin reintentar la revisión automáticamente
