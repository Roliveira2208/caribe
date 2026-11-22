# Change: f1-hotels-e2e

## Por qué
Primer flujo completo y demostrable: buscar un hotel, reservar con retención, pagar (simulado) y descargar
el voucher. Implementa SDD §5, §6, §8 y la fase F1 de §13. Depende de `f0-foundations`.

## Qué cambia
Catálogo y disponibilidad de hoteles con inventario propio, reserva con retención de cupo, tasa BCV con
respaldo y congelada al pagar, pago simulado en modo AUTO y MANUAL, voucher y comprobante no fiscal en PDF.

## Impacto en specs
Deltas de catalog, booking, exchange-rates, payments, documents, audit y auth-access; specs nuevas de
api-errors, notifications y tenant-isolation. Implementación parcial: solo tipo `hotel`.
La aprobación manual desde el panel completo llega en F2; en F1 se aprueba con un endpoint y una pantalla mínima.
Notificaciones F1: solo el correo de confirmación de reserva; el resto de avisos es F2. Se añade un
barrido de filas `PENDING` huérfanas (documentos y avisos) para recuperar trabajos perdidos entre el
commit y el encolado. El alcance por escenario está en `scope.md`.

## Preguntas abiertas
- Disponibilidad de DolarAPI antes de implementar (SDD §6.5); si falla, empezar con el override manual.
- Servicio de correo para desarrollo (SMTP local tipo Mailpit).

## Fuera de alcance
Tours, paquetes, vuelos, adaptadores externos, PWA offline, reportes.
