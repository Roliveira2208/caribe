# Delta: documents — f1-hotels-e2e

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Almacenamiento y descarga
El PDF SHALL guardarse en un directorio local configurable por variable de entorno, fuera del
repositorio. El nombre del archivo SHALL ser un identificador no adivinable (UUID) generado por el
servidor; SHALL NOT derivarse del código de reserva, del número de documento ni de datos personales.
`file_url` SHALL guardar una ruta relativa; el sistema SHALL NOT exponer una URL pública ni servir el
archivo directamente desde el disco. La descarga SHALL hacerse por una ruta autenticada que compruebe
propiedad del dueño o pertenencia a la agencia y SHALL responder `application/pdf` con
`Content-Disposition: attachment`. Una ruta manipulada (`..`, ruta absoluta o fuera del directorio)
SHALL rechazarse con 400 `INVALID_PATH` sin leer ningún archivo. Al elegir hosting se migrará a
almacenamiento externo (S3/Blob) manteniendo la ruta autenticada; se anota en `design.md`.

#### Scenario: Descarga autenticada
- GIVEN un voucher del cliente
- WHEN el cliente lo descarga
- THEN recibe un PDF con `Content-Disposition: attachment`

#### Scenario: Personal de la agencia descarga
- GIVEN un documento de la agencia A
- WHEN un admin de A lo descarga
- THEN recibe el PDF

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
- Un documento `FAILED` no bloquea una nueva reserva ni un nuevo pago; solo afecta a su descarga.
- El directorio de documentos se crea al arrancar; si no existe o no es escribible, la API falla al
  iniciar en vez de emitir documentos sin archivo.
- Los PDF no se guardan en el repositorio ni se incluyen en la imagen de la API.
- La nota de reembolso, el PDF en inglés y el reintento manual desde la web quedan para F2.

## Acceptance
- Prueba de numeración con emisión concurrente. PDF abre y contiene la leyenda "Documento no fiscal".
- Prueba de descarga autenticada, de documento ajeno, de nombre no adivinable y de ruta manipulada.
- Prueba de idempotencia: reintentar la emisión no duplica documento ni número.

## Out of scope
Factura fiscal, envío al SENIAT, imprenta digital (normativa en transición según SDD §12). Firma
electrónica, almacenamiento S3/Blob y enlaces públicos firmados en F1; la migración a almacenamiento
externo se hace al elegir hosting. Nota de reembolso, PDF en inglés y reintento manual: F2.
