# Tareas: f0-foundations
Una tarea a la vez, un commit por tarea. Marca `[x]` al terminar.

- [ ] T-F0-1 Crear monorepo pnpm + Turborepo con las 4 carpetas, TypeScript estricto, ESLint y Prettier compartidos.
- [ ] T-F0-2 Docker Compose local con PostgreSQL y Redis; `.env.example` con todas las variables (sin valores reales).
- [ ] T-F0-3 CI (GitHub Actions): install, lint, typecheck, test y `node scripts/check-specs.mjs`.
- [ ] T-F0-4 Prisma en `apps/api`: tablas de Better Auth (user, session, account, verification, organization, member, invitation, twoFactor) vía su CLI de migración.
- [ ] T-F0-5 Montar Better Auth en NestJS con los plugins Organization, Admin y Two-Factor; guard global y decorador de rutas públicas.
  - Prueba: auth-access › "Ruta protegida sin sesión", "Catálogo público".
- [ ] T-F0-6 Definir roles y permisos (agent, provider, owner/admin, super_admin) y guards por permiso; documentar la matriz en `design.md`.
  - Prueba: auth-access › escenarios de Proveedor y Cliente.
- [ ] T-F0-7 `TenantModule`: resolver tenant, `SET LOCAL app.tenant_id`, políticas RLS en las tablas base.
  - Prueba: auth-access › "Admin de otra agencia" con dos tenants.
- [ ] T-F0-8 TOTP obligatorio para owner/admin/super_admin y pantalla de activación.
  - Prueba: auth-access › "Admin sin TOTP".
- [ ] T-F0-9 `audit_logs` inmutable (permisos de BD) e interceptor `AuditModule` con un endpoint de ejemplo.
  - Prueba: audit › "Intento de borrado", "Admin aprueba un pago" (con acción de ejemplo).
- [ ] T-F0-10 `next-intl` en web y admin con es/en y rutas `/es` `/en`; shell de cada app con login.
- [ ] T-F0-11 Wireframes de las pantallas clave de SDD §9 en `docs/wireframes/` (imágenes o enlaces).
- [ ] T-F0-12 Verificación de la change: `/verify f0-foundations` en conversación limpia; archivar con `/opsx:archive`.
