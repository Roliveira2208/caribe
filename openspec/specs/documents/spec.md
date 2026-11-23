# Documents Specification

## Purpose
Voucher de reserva y comprobante de pago en PDF, no fiscales, con numeración correlativa.

## Requirements

### Requirement: Voucher
Al confirmarse una reserva el sistema SHALL generar un voucher PDF con código de reserva, QR, datos del
viajero, producto, fechas, política de cancelación (`policy_snapshot`), contacto de la agencia y la
leyenda visible "Documento no fiscal". El QR SHALL codificar una URL absoluta de la web con el código
global de la reserva (`/reservas/<code>`), sin datos personales ni tokens. En F1 el PDF SHALL emitirse
en español; el idioma inglés queda para F2. La reserva SHALL permanecer `CONFIRMED` aunque la generación
falle.

#### Scenario: Reserva confirmada
- WHEN una reserva pasa a `CONFIRMED`
- THEN se encola la generación del voucher y el cliente puede descargarlo

#### Scenario: Descargar voucher ajeno
- WHEN otro cliente pide el voucher
- THEN 404

#### Scenario: QR sin datos personales
- GIVEN un voucher emitido
- WHEN se lee el QR
- THEN contiene solo la URL con el código de la reserva

#### Scenario: Generación fallida
- GIVEN una reserva `CONFIRMED` cuya generación de PDF falla
- WHEN el trabajo agota los reintentos
- THEN la reserva sigue `CONFIRMED` y el documento queda `FAILED`

### Requirement: Comprobante de pago
El comprobante SHALL llevar número correlativo único por tenant y tipo, emisor (razón social y RIF del
tenant), líneas en USD, tasa BCV con su fecha valor, total en VES, método y referencia, y la leyenda
visible "Documento no fiscal". El comprobante SHALL emitirse al aprobarse el pago. La numeración SHALL
asignarse con un contador por agencia y tipo bloqueado en la misma transacción; dos emisiones
concurrentes SHALL obtener números distintos y sin huecos. Un reintento del mismo pago SHALL devolver el
mismo documento y el mismo número.

#### Scenario: Numeración correlativa
- GIVEN el último comprobante del tenant es el 41
- WHEN se emite uno nuevo
- THEN recibe el 42, también si dos se emiten a la vez

#### Scenario: Impuestos
- GIVEN las líneas de impuesto desactivadas (valor por defecto)
- WHEN se emite el comprobante
- THEN no aparecen líneas de impuesto

#### Scenario: Reintento del mismo pago
- GIVEN un pago con comprobante emitido
- WHEN se reintenta la emisión
- THEN se devuelve el mismo documento y no se consume otro número

#### Scenario: Pago rechazado
- GIVEN un pago `REJECTED`
- WHEN se consulta su comprobante
- THEN 404: no se emite comprobante de un pago no aprobado

### Requirement: InvoiceProvider
La emisión SHALL pasar por `InvoiceProvider.issue(booking, payment?)`; el MVP implementa
`FreeFormReceiptProvider`. La interfaz SHALL devolver el documento emitido (tipo, número, ruta y fecha)
y SHALL permitir emitir el voucher sin pago y el comprobante con pago.

#### Scenario: Cambiar de proveedor
- GIVEN una implementación futura de `InvoiceProvider`
- WHEN se configura
- THEN `BookingModule` y `PaymentModule` no cambian

#### Scenario: Voucher sin pago
- WHEN se emite el voucher de una reserva confirmada
- THEN la llamada no exige un pago

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

### Requirement: Ciclo de vida del documento
Cada documento SHALL tener estado `PENDING`, `READY` o `FAILED`. La fila SHALL crearse en `PENDING` en
la misma transacción que confirma la reserva o aprueba el pago. El trabajo SHALL renderizar el PDF y
marcarlo `READY`; tras 3 intentos fallidos SHALL quedar `FAILED`. Mientras esté `PENDING`, la descarga
SHALL responder 409 `DOCUMENT_PENDING`; si está `FAILED`, SHALL responder 503 `DOCUMENT_UNAVAILABLE`.

#### Scenario: Documento en preparación
- GIVEN un documento `PENDING`
- WHEN el cliente lo descarga
- THEN 409 con código `DOCUMENT_PENDING`

#### Scenario: Documento agotado
- GIVEN un documento `FAILED`
- WHEN el cliente lo descarga
- THEN 503 con código `DOCUMENT_UNAVAILABLE`

#### Scenario: Reintentos automáticos
- GIVEN un fallo temporal de renderizado
- WHEN el trabajo reintenta
- THEN lo hace hasta 3 veces con espera creciente

#### Scenario: Fila huérfana tras una caída
- GIVEN un documento `PENDING` creado hace más de 5 minutos cuyo trabajo nunca se encoló
- WHEN corre el barrido de pendientes
- THEN se re-encola su render en la agencia correcta y el documento sigue `PENDING` hasta emitirse

### Requirement: Idempotencia y unicidad del documento
Un voucher SHALL ser único por reserva y tipo; un comprobante SHALL ser único por pago y tipo. La base
SHALL imponer esa unicidad y el número SHALL ser único por agencia y tipo. Un reintento SHALL NOT emitir
un segundo documento ni consumir otro número.

#### Scenario: Un voucher por reserva
- GIVEN una reserva confirmada
- WHEN se reintenta la emisión del voucher
- THEN existe un solo voucher para esa reserva

#### Scenario: Un comprobante por pago
- GIVEN un pago aprobado
- WHEN se reintenta la emisión
- THEN existe un solo comprobante para ese pago

#### Scenario: Número único por agencia y tipo
- WHEN dos documentos del mismo tipo se emiten en la misma agencia
- THEN sus números son distintos y correlativos

## Casos límite
- Falla la generación del PDF → se reintenta con BullMQ (3 intentos) y la reserva sigue `CONFIRMED`.
- Reembolso → se emite una nota de reembolso no fiscal con el mismo formato.

## Acceptance
- Prueba de numeración con emisión concurrente. PDF abre y contiene la leyenda "Documento no fiscal".

## Out of scope
Factura fiscal, envío al SENIAT, imprenta digital (normativa en transición según SDD §12).
