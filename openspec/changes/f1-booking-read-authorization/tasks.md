# Tareas: f1-booking-read-authorization

Una tarea a la vez, tests primero y un commit por tarea.

- [ ] T-AUTH-1 (F-FINAL-001) Escribir los e2e del proveedor y verlos fallar: el proveedor A no ve reservas ni documentos de productos del proveedor B en la misma agencia; el dueño y el admin sí. Después añadir `providerScope` y aplicarlo en `BookingsService` y en los dos servicios de documentos.
  Prueba: escenarios «Proveedor ve solo su inventario» de `booking` y `documents`; `pnpm --filter @caribe/api test` en verde, sin 403 nuevos en cancelación.
- [ ] T-AUTH-2 (NUEVO-01) Escribir el e2e del `member` sin `booking:read` y verlo fallar: 403 en `GET /bookings` y `GET /bookings/:id`, sin resumen; el `agent` sigue viendo las de su agencia. Después ampliar `BookingsGuard` con `read` y cablearlo en el controller.
  Prueba: escenarios «Lectura requiere booking:read» de `booking` y `auth-access`; `pnpm test`, lint, typecheck e inventarios de rutas sin sesión en verde.
