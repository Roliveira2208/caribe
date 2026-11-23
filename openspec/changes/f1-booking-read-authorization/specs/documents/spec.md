# Delta: documents — f1-booking-read-authorization

## MODIFIED Requirements

### Requirement: Listado autenticado de documentos de una reserva
La API SHALL exponer `GET /api/v1/bookings/:id/documents` para que el dueño de la reserva o el
personal de la agencia con permiso `booking:read` descubra los documentos que puede descargar. Cada
fila SHALL incluir solo `id`, `type`, `number`, `status`, `issuedAt` y `downloadPath`. `downloadPath`
SHALL ser la ruta autenticada `/api/v1/documents/:id/download` y SHALL estar presente solo cuando
`status = READY`. La respuesta SHALL NOT exponer `file_url`, rutas de disco, `tenantId`, importes ni
datos personales. Una reserva ajena SHALL responder 404; una petición sin sesión SHALL responder 401.

Cuando el personal es un Proveedor, SHALL ver solo los documentos de reservas que tengan al menos una
línea con un producto de su `provider_id`. Los documentos de reservas de otros proveedores de su
misma agencia SHALL responder 404. El dueño de la reserva SHALL ver siempre los documentos de su
propia reserva.

#### Scenario: Dueño consulta los documentos de su reserva
- GIVEN una reserva con un voucher `READY` y un comprobante `PENDING`
- WHEN el dueño consulta `GET /bookings/:id/documents`
- THEN recibe ambas filas y solo el voucher tiene `downloadPath`

#### Scenario: Sin rutas de disco ni datos internos
- WHEN el dueño consulta los documentos de su reserva
- THEN ninguna fila incluye `file_url`, `tenantId`, importes ni datos del viajero

#### Scenario: Reserva ajena
- GIVEN una reserva de otro cliente o de otra agencia
- WHEN se consulta su listado de documentos
- THEN 404 sin revelar la existencia de la reserva

#### Scenario: Proveedor lista solo los documentos de su inventario
- GIVEN dos proveedores de la misma agencia con una reserva y un documento cada uno
- WHEN el proveedor A consulta el listado de la reserva del proveedor B
- THEN 404 sin revelar la existencia de la reserva ni del documento

#### Scenario: Sin sesión
- WHEN un visitante anónimo consulta el listado
- THEN 401

### Requirement: Almacenamiento y descarga
El PDF SHALL guardarse en un directorio local configurable por variable de entorno, fuera del
repositorio. El nombre del archivo SHALL ser un identificador no adivinable (UUID) generado por el
servidor; SHALL NOT derivarse del código de reserva, del número de documento ni de datos personales.
`file_url` SHALL guardar una ruta relativa; el sistema SHALL NOT exponer una URL pública ni servir el
archivo directamente desde el disco. La descarga SHALL hacerse por una ruta autenticada que compruebe
propiedad del dueño o pertenencia a la agencia y SHALL responder `application/pdf` con
`Content-Disposition: attachment`. Un Proveedor SHALL descargar solo documentos de reservas con
líneas de productos de su `provider_id`; los demás documentos de su agencia SHALL responder 404. Una
ruta manipulada (`..`, ruta absoluta o fuera del directorio) SHALL rechazarse con 400 `INVALID_PATH`
sin leer ningún archivo. Al elegir hosting se migrará a almacenamiento externo (S3/Blob) manteniendo
la ruta autenticada; se anota en `design.md`.

#### Scenario: Descarga autenticada
- GIVEN un voucher del cliente
- WHEN el cliente lo descarga
- THEN recibe un PDF con `Content-Disposition: attachment`

#### Scenario: Personal de la agencia descarga
- GIVEN un documento de la agencia A
- WHEN un admin de A lo descarga
- THEN recibe el PDF

#### Scenario: Proveedor descarga un documento de su inventario
- GIVEN un voucher `READY` de una reserva con un producto del proveedor A
- WHEN el proveedor A lo descarga
- THEN recibe el PDF

#### Scenario: Proveedor no descarga el documento de otro proveedor
- GIVEN un voucher `READY` de una reserva con un producto del proveedor B de la misma agencia
- WHEN el proveedor A intenta descargarlo
- THEN 404 sin leer el archivo

#### Scenario: Sin sesión
- WHEN un visitante anónimo pide un documento
- THEN 401

#### Scenario: Documento de otra agencia
- GIVEN un documento de la agencia B
- WHEN un admin de A lo pide
- THEN 404

#### Scenario: Nombre no adivinable
- WHEN se inspecciona `file_url`
- THEN contiene un UUID generado por el servidor y no el código de reserva ni el número del documento

#### Scenario: Ruta manipulada
- WHEN se intenta descargar una ruta con `..` o fuera del directorio configurado
- THEN 400 con código `INVALID_PATH` y no se lee ningún archivo

#### Scenario: URL pública
- WHEN se inspecciona `file_url`
- THEN es una ruta relativa, no una URL accesible sin sesión
