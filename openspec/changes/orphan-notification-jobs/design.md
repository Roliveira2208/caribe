# Design: orphan-notification-jobs

## Context
Ver `proposal.md`. `NotificationService.sendWithRetries()` congelaba la instantánea del aviso con
`tx.booking.findFirstOrThrow()`. Cuando la reserva desaparece (por ejemplo, la limpieza de una suite
e2e), Prisma lanza `P2025`; el job falla, BullMQ lo reintenta y `PendingRecoveryService` lo vuelve a
encolar mientras la fila siga `PENDING`. La capacitación de errores de SMTP (3 intentos) es correcta
para fallos transitorios del proveedor, pero aquí nunca se llega a llamar al proveedor: el error es
definitivo y debe cerrarse en el primer intento.

## Goals / Non-Goals

**Goals:**
- Diferenciar «no se pudo enviar» (transitorio, 3 intentos) de «no hay nada que enviar» (definitivo).
- Marcar la fila `FAILED` en el primer intento y dejar constancia en `lastError`.
- Evitar que el barrido de pendientes reencole avisos ya cerrados.

**Non-Goals:**
- Borrar filas de `notification_logs`, jobs de Redis ni datos de la agencia demo.
- Cambiar los reintentos SMTP, las plantillas, el idioma ni el proveedor.
- Añadir reenvío manual, alertas a administradores ni nuevos estados de notificación.
- Tocar reservas, pagos ni `audit_logs` (el registro de notificaciones no es auditoría).

## Decisions

1. **Lectura opcional en lugar de excepción.** `freeze()` pasa a devolver un resultado discriminado:
   `{ alreadySent: true }`, `{ alreadySent: false, ... }` o `{ bookingMissing: true }`. Se usa
   `tx.booking.findFirst()` bajo el mismo contexto RLS y con el mismo `tenantId`; no se cambia la
   consulta de `booking_items`, `payments` ni la construcción del correo.
   - Alternativa descartada: atrapar `P2025` de Prisma por código. Acopla el servicio a un código de
     error del ORM y también podría ocultar un `findUniqueOrThrow` del propio log.
   - Alternativa descartada: dejar que el job falle y no reencolarlo. Requiere tocar el scheduler y
     deja la fila `PENDING` para siempre, así que el barrido seguiría intentándolo.

2. **`FAILED` terminal con un solo intento.** En cuanto `freeze()` indica que falta la reserva, se
   llama a `recordFailure(notificationId, tenantId, mensaje, true)`, que ya marca `FAILED` y guarda
   `lastError` (limitado a 500 caracteres). Se devuelve `{ status: "FAILED", attempts: 1, sent: false,
   error }`, el mismo contrato que un correo inválido. No se incrementa `attempts` dos veces: se usa
   exactamente una llamada a `recordFailure`.

3. **Sin proveedor y sin espera.** La comprobación va antes del bucle de envío, junto a la validación
   del destinatario. Por tanto `provider.send` no se llama y el `sleep` inyectado no se usa, con lo que
   el test puede pasar `sleep: noSleep` y ser determinista.

4. **El barrido no necesita cambios.** `PendingRecoveryService` ya selecciona solo `status: PENDING`.
   Al quedar `FAILED`, el aviso sale del conjunto reencolable; el escenario correspondiente lo comprueba
   con el servicio real en lugar de modificar la consulta.

5. **Mensaje interno, no texto de UI.** `lastError` llevará una frase fija en español del tipo
   «La reserva del aviso ya no existe». No se añade clave es/en porque nadie lo ve fuera del registro;
   el correo no se envía y no se muestra en pantalla.

## Risks / Trade-offs
- [Un job duplicado puede estar en vuelo cuando se borra la reserva] → ambos llegarán a `FAILED` por
  el `updateMany` condicional; `attempts` puede sumar 2, pero no se envía ningún correo. No se considera
  un problema de sobreventa ni de dinero.
- [Se pierde un aviso legítimo si la reserva se borra por error] → es un dato ya inconsistente: no hay
  código de reserva, producto ni total que congelar. La fila `FAILED` queda como diagnóstico.
- [Cambio de la forma de `freeze()`] → es `private`; solo cambia `sendWithRetries()`, cubierto por los
  tests e2e existentes de envío correcto, idioma, dedupe y SMTP caído.

## Migration Plan
Sin cambios de esquema ni datos que convertir. Despliegue: solo la API; la web no consume este
comportamiento. Rollback: revertir el commit del servicio; los avisos ya marcados `FAILED` seguirán
así, pero no se envían correos nuevos por el rollback.

## Open Questions
Ninguna que pueda diferirse sin cambiar la spec o las tareas.
