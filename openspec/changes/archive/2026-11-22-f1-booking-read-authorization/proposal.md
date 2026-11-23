# Propuesta: f1-booking-read-authorization

## Por qué

Dos hallazgos de la revisión final de F1:

- **F-FINAL-001.** El rol `provider` tiene `booking:read` y el guard de documentos le pasa el
  `tenantId`, por lo que hoy lista y descarga documentos de **cualquier** reserva de su agencia. Lo
  mismo ocurre en `GET /bookings` y `GET /bookings/:id`. La matriz ya dice «solo de los suyos en F1»,
  pero la capa de servicio no lo aplica.
- **NUEVO-01.** Un `member` sin `booking:read` recibe el `activeOrganizationId` y ve el listado y el
  detalle de las reservas de su agencia. El permiso no se comprueba en las rutas de lectura.

## Qué se propone

1. Resolver el `provider_id` del usuario dentro del tenant y filtrar reservas y documentos por
   `booking.items.some.product.providerId`. Lo ajeno responde 404, igual que una reserva de otra
   agencia; el dueño de la reserva sigue viendo siempre la suya.
2. Exigir `booking:read` en las rutas de lectura de reservas mediante el guard de reservas. Sin ese
   permiso la petición responde 403 `FORBIDDEN` (fallo cerrado): no se degrada al alcance de cliente
   ni se devuelve un resumen vacío.
3. Cubrir ambos comportamientos con e2e: proveedor A no ve reservas ni documentos de productos del
   proveedor B en la misma agencia; `member` sin permiso recibe 403 en listado y detalle, mientras
   `agent` con `booking:read` conserva el acceso.

## Decisiones tomadas con el dueño

- Una reserva con líneas de varios proveedores es visible para cualquiera de ellos (`some`): cada uno
  ve la parte de su propio inventario que aparece en esa reserva.
- Un usuario con rol `provider` sin fila en `providers` no ve reservas ni documentos de la agencia; se
  responde 404 para no revelar existencia (coherente con la spec de booking).
- `member` sin `booking:read` se cierra con 403 en lugar de degradar a «mis reservas»: el dueño pidió
  fallo cerrado por defecto y que no vea reservas ni resumen.
- No se modifica la matriz de permisos (`access.ts`): los roles ya tienen lo que deben tener; el fallo
  está en la aplicación del permiso.

## Fuera de alcance

- Cambiar la matriz `access.ts`, las rutas de cancelación, pagos, notificaciones ni la web.
- Añadir un endpoint de resumen: el «resumen» a proteger es la respuesta de `GET /bookings`.
- Reembolsos con pasarela real (F-FINAL-003 sigue siendo bloqueante, documentado aparte).
