# Wireframes de baja fidelidad

Bocetos en escala de grises de las pantallas clave del MVP (SDD §9). No son diseño visual:
definen estructura, contenido y reglas de negocio visibles para el usuario. La tipografía y
los colores son placeholders; los datos (Tour Cayo de Agua, María Pérez, PAG-0142…) son
ejemplos coherentes entre sí: tasa BCV 36,00 del 10/11/2026 ($120 → 4.320,00 Bs;
$240 → 8.640,00 Bs).

## Archivos

| Archivo | Pantalla | App |
| --- | --- | --- |
| `busqueda.svg` | Inicio y buscador: filtros y resultados con precio en USD y equivalente en VES | Web · escritorio |
| `busqueda-movil.svg` | Misma búsqueda en columna única, filtros como chips y navegación inferior | Web · móvil |
| `detalle.svg` | Detalle de producto: galería, descripción, incluye, política, tarjeta de reserva y disponibilidad por fecha | Web · escritorio |
| `checkout.svg` | Checkout en 3 pasos: viajero y resumen · pago con temporizador · confirmación con voucher | Web · escritorio |
| `checkout-movil.svg` | Pasos 2 y 3 del checkout en columna única | Web · móvil |
| `panel-pagos.svg` | Reservas y pagos: modo de aprobación, filtros, tabla de estados y acciones Aprobar/Rechazar | Admin · escritorio |

## Convención de marcadores

Cada SVG lleva una caja punteada «Reglas visibles en esta pantalla» al final. Los marcadores
circulares `[1]`, `[2]`… señalan en pantalla dónde se aplica cada regla y **se numeran de
forma local a cada archivo** (el mismo número puede significar reglas distintas en otro
archivo; la caja de notas de cada SVG es la fuente).

## Reglas de negocio que deben verse (SDD §6, §12)

1. **Precio USD con equivalente VES** y la tasa BCV con su fecha valor. En catálogo,
   detalle y resumen el equivalente es informativo (SDD §6, reglas 1-4).
2. **Tasa congelada al iniciar el pago:** al reportar el pago se registran la tasa del día
   y `amount_ves`; ese par no se recalcula (SDD §6, regla 3). El panel de pagos muestra el
   par original, nunca un recálculo.
3. **Retención del cupo (30 min por defecto, `hold_minutes`):** el checkout muestra una
   cuenta regresiva; al vencer, la reserva pasa a EXPIRED y el cupo se libera (SDD §6).
4. **Estados del pago:** IN_REVIEW (en revisión), APPROVED (aprobado), REJECTED (rechazado)
   (SDD §5). El panel de pagos filtra por estado y ofrece Aprobar/Rechazar.
5. **Modo de aprobación por agencia (`payment_mode`):** AUTO aprueba al instante; MANUAL
   requiere revisión de un administrador. El panel muestra el modo activo en un badge.
6. **Voucher y comprobante no fiscales:** ambos PDF llevan siempre la leyenda
   «Documento no fiscal» (SDD §12).
7. **Selector de moneda USD/VES** en el checkout; el monto se calcula siempre en el
   servidor, nunca con un valor enviado por el cliente.

## Relación con el SDD

- §6 (Multimoneda y pagos): reglas de conversión, métodos simulados, modos y retención.
- §9 (Diseño de la interfaz de usuario): pantallas clave de web y admin.
- §12 (Voucher y comprobante de reserva): PDFs no fiscales y su leyenda.
