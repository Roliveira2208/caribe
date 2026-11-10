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
