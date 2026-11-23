# Delta: booking — f1-booking-read-authorization

## MODIFIED Requirements

### Requirement: Consulta y propiedad
`GET /bookings/:id` SHALL devolver la reserva al dueño o al personal de su agencia. `GET /bookings`
SHALL listar las reservas del usuario autenticado —de todas las agencias donde tenga reservas— o, para
el personal, las de su agencia activa. La lista SHALL aceptar filtro por estado y paginación por cursor.
Una reserva ajena o de otra agencia SHALL responder 404, nunca 403. El detalle SHALL usar el título del
producto guardado en la línea al reservar, no el estado ni el título actual del producto. El detalle
SHALL exponer también la política guardada en `policy_snapshot` y, cuando exista un pago, un
`refund_estimate` calculado en el servidor con esa política y la tasa congelada del pago. La web SHALL
mostrar ese texto decimal sin recalcular montos ni tasas.

El Proveedor SHALL ver solo las reservas que tengan al menos una línea con un producto de su
`provider_id`; las reservas de otros proveedores de su agencia SHALL responder 404. Un usuario con rol
`provider` sin registro de proveedor en la agencia SHALL ver cero reservas al listar y SHALL recibir
404 al consultar el detalle. Un rol
sin `booking:read`, como `member`, SHALL recibir 403 `FORBIDDEN` al listar o consultar reservas con
agencia activa; el sistema SHALL NOT degradar a «mis reservas» ni devolver un resumen vacío.

#### Scenario: Dueño consulta su reserva
- GIVEN una reserva del cliente
- WHEN la consulta por id
- THEN 200 con sus líneas, estado y `expires_at`

#### Scenario: Producto despublicado después de reservar
- GIVEN una reserva confirmada cuyo producto se despublica
- WHEN el cliente consulta su reserva o descarga el voucher
- THEN ve el título guardado al crear la reserva

#### Scenario: Detalle congelado y reembolso estimado
- GIVEN una reserva confirmada con un pago aprobado y una política guardada
- WHEN el cliente consulta su reserva
- THEN el detalle devuelve la política guardada y un `refund_estimate` calculado con esa política y la
  tasa congelada del pago, sin consultar la política actual del producto ni recalcular en la web

#### Scenario: Personal consulta una reserva de su agencia
- GIVEN una reserva de la agencia A
- WHEN un admin de A la consulta
- THEN 200

#### Scenario: Personal de otra agencia
- GIVEN una reserva de la agencia A
- WHEN un admin de B la consulta
- THEN 404

#### Scenario: Proveedor ve solo su inventario
- GIVEN dos proveedores A y B de la misma agencia con un producto cada uno y una reserva por producto
- WHEN el proveedor A lista reservas y consulta la reserva del producto de B
- THEN el listado contiene solo la reserva de A y la reserva de B responde 404

#### Scenario: Reserva con líneas de varios proveedores
- GIVEN una reserva con un producto del proveedor A y otro del proveedor B
- WHEN el proveedor A la consulta
- THEN 200, porque una de sus líneas pertenece a su inventario

#### Scenario: Agencia activa sin membresía
- GIVEN una sesión con `activeOrganizationId` de una agencia a la que el usuario ya no pertenece
- WHEN consulta o lista reservas
- THEN 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

#### Scenario: Mis reservas entre agencias
- GIVEN un cliente con reservas en A y B
- WHEN lista sus reservas
- THEN aparecen las de ambas agencias, sin las de otras personas

#### Scenario: Filtro por estado
- GIVEN reservas `PENDING_PAYMENT` y `CONFIRMED` del mismo cliente
- WHEN lista con estado `CONFIRMED`
- THEN solo aparecen las confirmadas

#### Scenario: Lectura requiere booking:read
- GIVEN un `member` con agencia activa y sin `booking:read`
- WHEN lista reservas o consulta una reserva de esa agencia
- THEN 403 con código `FORBIDDEN`, sin filas ni resumen

#### Scenario: Agente conserva la lectura
- GIVEN un `agent` con `booking:read` en la agencia A
- WHEN lista las reservas de A
- THEN 200 con las reservas de la agencia
