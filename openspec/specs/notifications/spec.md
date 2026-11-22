# notifications Specification

## Purpose
Avisos transaccionales del MVP. En F1 el único correo es el de confirmación de reserva, en español o
inglés según la persona, y un fallo de envío no bloquea ni deshace una reserva confirmada. Esta spec
también fija el cierre terminal de un aviso cuya reserva desapareció antes del envío.

## Requirements

### Requirement: Aviso con reserva desaparecida
Cuando la reserva asociada a un aviso pendiente ya no exista, el sistema SHALL marcar el aviso como
`FAILED` de forma terminal en el primer intento, sin llamar al proveedor, sin aplicar los reintentos de
envío y sin volver a encolarlo. El sistema SHALL conservar la fila del aviso y SHALL registrar en su
`lastError` que la reserva no existe. Este caso SHALL NOT modificar reservas, pagos ni documentos, y
SHALL NOT generar textos visibles al usuario.

#### Scenario: Reserva borrada antes del envío
- GIVEN un aviso `PENDING` cuya clave de deduplicación apunta a una reserva eliminada
- WHEN se procesa su trabajo de envío
- THEN el aviso queda `FAILED` con `attempts` 1 y un `lastError` que indica que la reserva no existe,
  sin llamar al proveedor ni esperar entre reintentos

#### Scenario: Sin reencolado por el barrido
- GIVEN un aviso `FAILED` porque su reserva desapareció
- WHEN corre el barrido de pendientes con antigüedad suficiente
- THEN no se encola otro trabajo de envío para ese aviso

#### Scenario: Reserva viva envía con normalidad
- GIVEN un aviso `PENDING` cuya reserva sigue existiendo
- WHEN se procesa su trabajo de envío
- THEN el proveedor recibe el correo y el aviso queda `SENT`, como antes de este cambio

### Requirement: Proveedor y transporte
El envío SHALL pasar por `NotificationProvider.send(template, recipient)`. La implementación del MVP
SHALL usar SMTP configurado por variables de entorno y SHALL funcionar con un servidor local tipo
Mailpit en desarrollo. La llamada SHALL tener un tiempo máximo de 5 segundos y hasta 3 intentos con
espera creciente. Un fallo de envío SHALL registrarse en el log y en el registro de notificaciones, y
SHALL NOT deshacer la reserva ni el pago. Las pruebas SHALL usar un doble del proveedor y SHALL NOT
llamar a una red externa.

#### Scenario: Correo encolado
- GIVEN una reserva que pasa a `CONFIRMED`
- WHEN se encola su aviso
- THEN el trabajo lo envía por el proveedor configurado

#### Scenario: SMTP caído
- GIVEN el proveedor SMTP no responde
- WHEN se intenta enviar el aviso
- THEN se reintenta hasta 3 veces, la reserva sigue `CONFIRMED` y el fallo queda registrado

#### Scenario: Pruebas sin red
- WHEN corre la suite de notificaciones
- THEN usa un doble del proveedor y no abre conexiones SMTP reales

### Requirement: Confirmación de reserva
El sistema SHALL enviar un solo aviso transaccional al confirmarse una reserva, con código, producto,
fechas, total en USD y VES y enlace al voucher. En F1 SHALL NOT enviarse ningún otro aviso: ni de pago
aprobado, ni de pago rechazado, ni de cancelación, ni de expiración, ni de marketing. Un evento SHALL
NOT enviarse dos veces.

#### Scenario: Reserva confirmada
- WHEN una reserva pasa a `CONFIRMED`
- THEN el dueño recibe un correo con el código y el enlace al voucher

#### Scenario: Sin otros avisos
- WHEN un pago se aprueba, se rechaza o una reserva se cancela o expira
- THEN no se envía ningún correo en F1

### Requirement: Idioma del aviso
El aviso SHALL usar el `locale` del usuario destinatario: `es` por defecto y `en` soportado. Si falta la
plantilla en el idioma del usuario SHALL usarse `es`. El `locale` SHALL persistirse por usuario y SHALL
poder cambiarse desde la cuenta; el cambio SHALL aplicar a los avisos posteriores. Las plantillas SHALL
tener sus textos en `es` y `en`, no cadenas fijas en el código.

#### Scenario: Usuario en inglés
- GIVEN un usuario con `locale = en`
- WHEN se envía el aviso
- THEN el asunto y el cuerpo están en inglés

#### Scenario: Falta la plantilla inglesa
- GIVEN un usuario con `locale = en` y una plantilla sin versión inglesa
- WHEN se envía el aviso
- THEN se usa la versión en español

#### Scenario: Sin locale
- GIVEN un usuario sin `locale`
- WHEN se envía el aviso
- THEN se usa español

### Requirement: Idempotencia de los avisos
Cada evento SHALL tener una clave de deduplicación por tipo y entidad (reserva). El sistema SHALL
registrar el intento en un registro de notificaciones con estado `PENDING`, `SENT` o `FAILED` y SHALL
imponer unicidad por esa clave. Un reintento del mismo evento SHALL NOT enviar un segundo correo. Un
evento repetido por una operación idempotente SHALL NOT generar un aviso nuevo.

#### Scenario: Reintento del mismo evento
- GIVEN un aviso ya enviado para una reserva
- WHEN el trabajo se reintenta
- THEN no se envía un segundo correo

#### Scenario: Evento repetido
- GIVEN una reserva confirmada y su aviso enviado
- WHEN se repite la operación idempotente que la confirmó
- THEN no se genera un aviso nuevo

#### Scenario: Fallo definitivo
- GIVEN un aviso que agota sus reintentos
- WHEN se consulta su registro
- THEN queda `FAILED` y la reserva no cambia

#### Scenario: Fila huérfana tras una caída
- GIVEN un aviso `PENDING` creado hace más de 5 minutos cuyo trabajo nunca se encoló
- WHEN corre el barrido de pendientes
- THEN se re-encola su envío en la agencia correcta y el aviso sigue `PENDING` hasta enviarse

### Requirement: Destinatario y privacidad
El aviso SHALL enviarse solo al correo del usuario dueño de la reserva. No SHALL incluir copias ni copias
ocultas a otras personas ni a la agencia en F1. El cuerpo SHALL NOT incluir datos de tarjeta, tokens,
contraseñas ni datos de otras reservas. Los logs SHALL NOT registrar el cuerpo completo ni datos
personales de los viajeros.

#### Scenario: Destinatario único
- GIVEN una reserva del usuario A
- WHEN se envía el aviso
- THEN el único destinatario es el correo de A

#### Scenario: Sin datos sensibles
- GIVEN una reserva con datos de viajeros y un pago con tarjeta de prueba
- WHEN se envía el aviso
- THEN el correo no incluye número de tarjeta, CVV ni documentos de los viajeros

## Casos límite

- Reserva eliminada antes del envío: `FAILED` terminal en el primer intento, sin llamar al proveedor y
  sin reencolar.
- Un aviso `FAILED` por este motivo no vuelve a encolarse en el barrido de pendientes.
- Un fallo de SMTP no revierte la reserva ni el documento.
- El registro de notificaciones no es auditoría y no sustituye a `audit_logs`.

## Acceptance

- Prueba e2e de un aviso huérfano que queda `FAILED` sin llamadas al proveedor.
- Prueba de que el barrido no reencola avisos `FAILED`.
- Prueba de que un aviso con reserva viva envía con normalidad.

## Out of scope

- Avisos de pago aprobado, pago rechazado y cancelación con reembolso (F2).
- WhatsApp, notificaciones push, marketing y plantillas editables por la agencia.
- Reintento manual desde el panel y textos visibles al usuario por una reserva desaparecida.
