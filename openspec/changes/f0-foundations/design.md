# Diseño: f0-foundations

- **Integración NestJS ↔ Better Auth:** `@thallesp/nestjs-better-auth` (comunitaria) con `bodyParser: false` y guard global.
  Respaldo: montar el handler oficial de Better Auth directamente. Decisión D15.
- **Cookie de primera parte:** `apps/web` y `apps/admin` reenvían `/api/*` a la API (rewrites de Next.js).
- **Tenant:** cada agencia = organización de Better Auth. `TenantModule` fija `app.tenant_id` por transacción
  (`SET LOCAL`) y las políticas RLS filtran por ese valor.
- **Roles → permisos:** definir en un archivo único recursos y acciones (`product`, `booking`, `payment`,
  `exchange-rate`, `report`, `audit`) y la matriz rol × recurso. Documentar la matriz aquí al terminar T-F0-6.
- **Auditoría inmutable:** el rol de BD de la aplicación solo tiene INSERT y SELECT sobre `audit_logs`.
- **Dependencias nuevas:** solo las del stack del SDD; cualquier otra se justifica en esta sección.

## Decisiones con el dueño (2026-11-09)
- **TOTP en dos capas:** la UI redirige a la pantalla de activación y la API rechaza endpoints
  administrativos con 403 `TWO_FACTOR_REQUIRED` (delta de `auth-access`).
- **Auditoría de plataforma:** acciones fuera de una agencia se registran con `tenant_id` NULL; RLS las
  reserva al rol de plataforma (delta de `audit`).
- **Stubs de F0:** `GET /api/v1/products` y `GET /api/v1/bookings/:id` marcados `TODO(F1)`; F1 los
  elimina (T-F1-7b).
- **Seed:** script de demostración (una agencia, un usuario por rol, inventario básico) solo para dev;
  los tests crean sus propios datos (T-F0-6b).
- **Matriz rol × permiso:** se muestra al dueño antes del commit de T-F0-6.
- **Wireframes:** SVG de baja fidelidad de búsqueda, detalle, checkout y panel de pagos (T-F0-11).
- **TypeScript:** se fija `~5.9` (línea JS) y no `7.x` nativo, por compatibilidad con typescript-eslint
  (peer `<6.1`), NestJS y Next; se revisa cuando el ecosistema lo soporte.
