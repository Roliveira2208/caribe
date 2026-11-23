# Delta: auth-access — f1-booking-read-authorization

## MODIFIED Requirements

### Requirement: Permisos sobre reservas y pagos
Un Cliente o Agente SHALL crear reservas y reportar pagos solo para sí mismo; el `user_id` SHALL salir
de la sesión y un Agente SHALL NOT reservar en nombre de otra persona en F1. El owner y el admin de la
agencia SHALL ver y cancelar las reservas de su agencia; el Agente SHALL ver y cancelar solo las
propias; el Proveedor SHALL NOT cancelar reservas. El Proveedor SHALL ver solo reservas y documentos
de las líneas con productos de su `provider_id`, aunque estén en su misma agencia. Un `member` sin
`booking:read` SHALL NOT ver reservas ni resumen de la agencia: las rutas de lectura SHALL responder
403 `FORBIDDEN` por defecto. La aprobación o rechazo de un pago SHALL ser exclusiva del Admin de
agencia de la agencia del pago y de una persona distinta de quien lo reportó. El Super Admin SHALL ser
de solo lectura en reservas y pagos y SHALL NOT cancelar. Ningún otro rol SHALL revisar pagos.

#### Scenario: Agente crea su propia reserva
- GIVEN un agente autenticado
- WHEN crea una reserva
- THEN la reserva queda con su `user_id`

#### Scenario: Agente intenta reservar para otra persona
- WHEN el cuerpo incluye el `user_id` de otra persona
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

#### Scenario: Admin ve las reservas de su agencia
- GIVEN reservas de la agencia A
- WHEN el admin de A las lista
- THEN recibe las de A y ninguna de B

#### Scenario: Admin cancela una reserva de su agencia
- GIVEN una reserva `CONFIRMED` de la agencia A
- WHEN el admin de A la cancela
- THEN 200 y se aplica la política guardada

#### Scenario: Agente intenta cancelar una reserva ajena
- GIVEN una reserva de otro usuario de la agencia A
- WHEN el agente de A intenta cancelarla
- THEN 404 y la reserva no cambia

#### Scenario: Proveedor ve solo su inventario
- GIVEN reservas de los proveedores A y B en la misma agencia
- WHEN el proveedor A lista reservas
- THEN solo recibe las que contienen productos suyos

#### Scenario: Proveedor intenta cancelar
- GIVEN una reserva de la agencia A
- WHEN el proveedor de A intenta cancelarla
- THEN 403 y la reserva no cambia

#### Scenario: Member sin permiso de lectura
- GIVEN un `member` con agencia activa y sin `booking:read`
- WHEN lista o consulta reservas
- THEN 403 `FORBIDDEN`, sin reservas ni resumen

#### Scenario: Super Admin intenta cancelar
- GIVEN una reserva de una agencia
- WHEN el Super Admin intenta cancelarla
- THEN 403

#### Scenario: Revisor distinto del pagador
- GIVEN un pago reportado por el admin de A
- WHEN el mismo admin intenta aprobarlo
- THEN 403 y el pago sigue `IN_REVIEW`
