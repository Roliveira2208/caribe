# Documents Specification

## Purpose
Voucher de reserva y comprobante de pago en PDF, no fiscales, con numeración correlativa.

## Requirements

### Requirement: Voucher
Al confirmarse una reserva el sistema SHALL generar un voucher PDF con código de reserva, QR, datos del
viajero, producto, fechas, política de cancelación (`policy_snapshot`) y contacto de la agencia.

#### Scenario: Reserva confirmada
- WHEN una reserva pasa a `CONFIRMED`
- THEN se encola la generación del voucher y el cliente puede descargarlo

#### Scenario: Descargar voucher ajeno
- WHEN otro cliente pide el voucher
- THEN 404

### Requirement: Comprobante de pago
El comprobante SHALL llevar número correlativo único por tenant y tipo, emisor (razón social y RIF del
tenant), líneas en USD, tasa BCV con su fecha valor, total en VES, método y referencia, y la leyenda
visible "Documento no fiscal".

#### Scenario: Numeración correlativa
- GIVEN el último comprobante del tenant es el 41
- WHEN se emite uno nuevo
- THEN recibe el 42, también si dos se emiten a la vez

#### Scenario: Impuestos
- GIVEN las líneas de impuesto desactivadas (valor por defecto)
- WHEN se emite el comprobante
- THEN no aparecen líneas de impuesto

### Requirement: InvoiceProvider
La emisión SHALL pasar por `InvoiceProvider.issue(booking, payment)`; el MVP implementa `FreeFormReceiptProvider`.

#### Scenario: Cambiar de proveedor
- GIVEN una implementación futura de `InvoiceProvider`
- WHEN se configura
- THEN `BookingModule` y `PaymentModule` no cambian

## Casos límite
- Falla la generación del PDF → se reintenta con BullMQ (3 intentos) y la reserva sigue `CONFIRMED`.
- Reembolso → se emite una nota de reembolso no fiscal con el mismo formato.

## Acceptance
- Prueba de numeración con emisión concurrente. PDF abre y contiene la leyenda "Documento no fiscal".

## Out of scope
Factura fiscal, envío al SENIAT, imprenta digital (normativa en transición según SDD §12).
