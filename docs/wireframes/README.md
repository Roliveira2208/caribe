# Wireframes de baja fidelidad — Caribe

Bocetos SVG de estructura, contenido y reglas visibles del MVP. Se conservan los flujos originales de búsqueda, detalle, checkout y panel de pagos, y se incorpora una nueva portada turística.

## Archivos

| Archivo | Pantalla | App |
| --- | --- | --- |
| `inicio.svg` | Nueva portada: Hero fotográfico a pantalla completa (100vh); buscador después del primer scroll; destinos y experiencias | Web · escritorio |
| `inicio-movil.svg` | Portada móvil: Hero de 100vh, buscador en columna y menú compacto | Web · móvil |
| `busqueda.svg` | Resultados, filtros y menú superior con Tours, Hoteles, Paquetes, Destinos, Vuelos y Contacto | Web · escritorio |
| `busqueda-movil.svg` | Resultados en columna, categorías como chips y navegación inferior | Web · móvil |
| `detalle.svg` | Detalle del producto, galería, incluye, política, reserva y disponibilidad | Web · escritorio |
| `detalle-movil.svg` | Detalle en columna única: contenido del producto y reserva con disponibilidad | Web · móvil |
| `checkout.svg` | Checkout en tres pasos: viajero y resumen, pago con temporizador, confirmación | Web · escritorio |
| `checkout-movil.svg` | Pasos de pago y confirmación en columna única | Web · móvil |
| `mis-reservas.svg` | Mis reservas: listado entre agencias, detalle con política congelada y estados vacío/error | Web · escritorio |
| `cancelacion-descarga.svg` | Confirmación de cancelación, reembolso, bloqueo por pago en revisión y descargas solo de documentos `READY` | Web · escritorio |
| `panel-pagos.svg` | Panel de administración de reservas y pagos | Admin · escritorio |
| `panel-tasas.svg` | Panel de tasas: tasa vigente, override con confirmación antes/después e historial | Admin · escritorio |
| `panel-auditoria.svg` | Panel de auditoría: filtros y cursor, pestaña de eventos de autenticación y alcance por agencia | Admin · escritorio |
| `panel-catalogo.svg` | Panel de catálogo: alta, edición y estados de productos, y disponibilidad por noche | Admin · escritorio |
| `panel-usuarios-roles.svg` | Panel de usuarios y roles: invitación, cambio de rol y revocación de sesiones con Better Auth y TOTP | Admin · escritorio |

## Decisiones del nuevo inicio

- El Hero ocupa exactamente una altura de viewport: 900 px en el wireframe de escritorio y 844 px en el de móvil. La intención es implementarlo como `min-height: 100vh` (o equivalente), con imagen de fondo a sangre.
- El buscador no se superpone al Hero. Aparece en la siguiente sección al hacer scroll.
- Categorías superiores: Inicio, Tours, Hoteles, Paquetes, Destinos, Vuelos y Contacto. En móvil se accede desde menú compacto y se ofrecen chips de categoría en el buscador.
- Campos de búsqueda: destino, fecha de ida, fecha de regreso, cantidad de adultos y cantidad de niños. Al seleccionar niños se solicitan sus edades.
- Las secciones de destinos y experiencias destacadas sirven como accesos rápidos a las búsquedas y detalles existentes.

## Reglas de negocio preservadas (SDD §6, §9, §12)

1. Precio en USD con equivalente informativo en VES y tasa BCV con fecha valor. La tasa del día se muestra en el header de las pantallas web para que el usuario entienda ese equivalente.
2. Tasa congelada al iniciar el pago: el par tasa/`amount_ves` no se recalcula al revisar el pago.
3. Retención de cupo (30 min por defecto, `hold_minutes`) y expiración de reserva al vencer.
4. Estados de pago: `IN_REVIEW`, `APPROVED` y `REJECTED`.
5. Modo de aprobación por agencia: `AUTO` o `MANUAL`.
6. Voucher y comprobante PDF con la leyenda «Documento no fiscal».
7. El monto del pago se calcula en el servidor; selector de moneda USD/VES en checkout.
8. Textos visibles en `es`/`en` desde claves de mensajes (nunca cadenas fijas), con versión móvil en las pantallas web y accesibilidad básica: foco visible, etiquetas asociadas y contraste AA.

Los importes, nombres, fechas y tasa que aparecen en los wireframes son datos de ejemplo coherentes con el SDD original, no ofertas comerciales actuales.
