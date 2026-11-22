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
