# Delta: notifications — orphan-notification-jobs

## ADDED Requirements

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
