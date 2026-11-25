# Delta: security — f2-admin-rates

## MODIFIED Requirements

### Requirement: Idempotencia de reembolsos
Todo reembolso SHALL identificarse con un `refundId` generado por el servidor (UUID) y guardado como
identificador de la fila, sin aceptar un `refundId` elegido por el cliente. El servidor SHALL registrar
la intención de forma atómica con la cancelación antes de invocar a `PaymentProvider`; repetir la
cancelación SHALL devolver el resultado original sin provocar un segundo reembolso externo. Un
`refundId` nuevo sobre un pago ya reembolsado SHALL responder 409 con `REFUND_ALREADY_ISSUED`, según
`payments`. La respuesta SHALL revelar el estado del reembolso, nunca secretos del proveedor.

#### Scenario: Reembolso idempotente
- GIVEN una reserva cancelada con un reembolso registrado y su `refundId` generado por el servidor
- WHEN se repite la cancelación
- THEN se devuelve el resultado original sin crear otra fila ni invocar dos veces al proveedor
- WHEN se intenta un `refundId` distinto sobre el mismo pago
- THEN responde 409 con `REFUND_ALREADY_ISSUED` y no se emite otro reembolso
- THEN la respuesta revela el estado del reembolso, nunca secretos del proveedor
