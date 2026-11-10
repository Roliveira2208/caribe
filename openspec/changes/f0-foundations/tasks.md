# Tareas: f0-foundations
Una tarea a la vez, un commit por tarea. Marca `[x]` al terminar.

- [x] T-F0-0a Delta de spec `auth-access`: el TOTP se exige también en la API (403 `TWO_FACTOR_REQUIRED`).  Prueba: revisión del dueño (delta de spec, sin código).
- [x] T-F0-0b Delta de spec `audit`: acciones de plataforma con `tenant_id` NULL, legibles solo desde el rol de plataforma.  Prueba: revisión del dueño (delta de spec, sin código).
- [x] T-F0-1 Crear monorepo pnpm + Turborepo con las 4 carpetas, TypeScript estricto, ESLint y Prettier compartidos.
- [x] T-F0-2 Docker Compose local con PostgreSQL y Redis; `.env.example` con todas las variables (sin valores reales).
- [x] T-F0-3 CI (GitHub Actions): install, lint, typecheck, test y `node scripts/check-specs.mjs`.
- [x] T-F0-4 Prisma en `apps/api`: tablas de Better Auth (user, session, account, verification, organization, member, invitation, twoFactor) vía su CLI de migración.
- [x] T-F0-5 Montar Better Auth en NestJS con los plugins Organization, Admin y Two-Factor; guard global y decorador de rutas públicas. Incluye stubs `GET /api/v1/products` (público) y `GET /api/v1/bookings/:id` (protegido) marcados `TODO(F1)`; F1 los elimina.
  - Prueba: auth-access › "Ruta protegida sin sesión", "Catálogo público".
- [x] T-F0-6 Definir roles y permisos (agent, provider, owner/admin, super_admin) y guards por permiso; documentar la matriz en `design.md`.
  - Prueba: auth-access › escenarios de Proveedor y Cliente.
- [x] T-F0-6b Script de seed de demostración (una agencia, un usuario por rol, inventario básico); los tests automáticos crean sus propios datos.
  - Prueba: seed idempotente y pipeline en verde.
- [ ] T-F0-7 `TenantModule`: resolver tenant, `SET LOCAL app.tenant_id`, políticas RLS en las tablas base.
  - Prueba: auth-access › "Admin de otra agencia" con dos tenants.
- [ ] T-F0-8 TOTP obligatorio para owner/admin/super_admin y pantalla de activación, en UI y API (delta de `auth-access`).
  - Prueba: auth-access › "Admin sin TOTP" (incluye 403 `TWO_FACTOR_REQUIRED`).
  - Prueba: auth-access › "Admin sin TOTP".
- [ ] T-F0-9 `audit_logs` inmutable (permisos de BD) e interceptor `AuditModule` con un endpoint de ejemplo.
  - Prueba: audit › "Intento de borrado", "Admin aprueba un pago" (con acción de ejemplo).
- [ ] T-F0-10 `next-intl` en web y admin con es/en y rutas `/es` `/en`; shell de cada app con login.
- [ ] T-F0-11 Wireframes SVG de baja fidelidad de búsqueda, detalle, checkout y panel de pagos en `docs/wireframes/`.
- [ ] T-F0-12 Verificación de la change: `/verify f0-foundations` en conversación limpia; archivar con `/opsx:archive`.
