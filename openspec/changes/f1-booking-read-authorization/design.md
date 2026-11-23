# Diseño: f1-booking-read-authorization

## Alcance del proveedor

Nuevo helper `providerScope(tx, actor)` en `apps/api/src/tenant/`: devuelve `{ kind: "all" }` para
owner/admin/agent, `{ kind: "provider", providerId }` para `membershipRole === "provider"` y
`{ kind: "none" }` si el proveedor no tiene fila. El listado con `none` devuelve cero filas y el
detalle responde 404: no se degrada al alcance de agencia ni se filtra información. Se resuelve dentro
del contexto RLS del tenant, igual que `products-admin.service.ts`, y se reutiliza en los cuatro
puntos:

- `DocumentListService.list`, rama de agencia: `booking.findFirst({ where: { id, tenantId, items:
  { some: { product: { providerId } } } } })`.
- `DocumentDownloadService.download`, rama de agencia: mismo filtro añadido a la rama `{ tenantId }`
  del `OR`; la rama `{ booking: { userId } }` sigue protegiendo los documentos propios.
- `BookingsService.list`: mismo filtro en el `where` del listado de agencia.
- `BookingsService.readDetailInTx`: mismo filtro en el `findFirst` del detalle.

La rama de dueño (`userId`) no se toca: un proveedor que reservó como cliente ve siempre su reserva.
Owner y admin (`providerScope === null`) conservan el acceso completo a su agencia.

## Fallo cerrado de `member`

`BookingsGuard` pasa a declarar `BookingAccess = "read" | "cancel"`:

- `read`: con membresía activa, solo pasan los roles cuyo objeto de acceso autoriza `booking:read`
  (owner, admin, agent, provider); un rol sin ese permiso recibe 403 `FORBIDDEN`. Se fija un
  `BookingActor` con `tenantId` y `membershipRole` para que el servicio aplique el scope de proveedor.
  Sin membresía, el comportamiento es el de cliente («mis reservas»); el Super Admin conserva su
  lectura de plataforma.
- `cancel`: lógica actual intacta (owner/admin sobre la agencia, agente y miembro solo lo propio,
  proveedor y Super Admin 403).

`BookingsController.list/detail` llevan `@BookingPermission("read")` y pasan el `membershipRole` del
actor al servicio. `ActiveMembershipGuard` sigue corriendo primero, para no cambiar el 403
`ACTIVE_ORGANIZATION_REQUIRED` de las sesiones con membresía revocada.

## Pruebas

- `apps/api/test/provider-booking-scope.e2e.ts`: agencia con dos proveedores, dos productos y dos
  reservas; el proveedor A ve solo su reserva en listado, detalle, listado de documentos y descarga;
  el proveedor B no ve la del A; el dueño de las reservas y el admin de la agencia sí ven ambas.
- `apps/api/test/booking-read-guard.e2e.ts`: `member` con agencia activa recibe 403 en listado y
  detalle, sin filas ni resumen; `agent` con `booking:read` recibe 200; una sesión sin agencia sigue
  viendo solo sus reservas.

Tests primero (rojo) y un commit por hallazgo. Sin migraciones: no hay columnas nuevas.
