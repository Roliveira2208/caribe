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
- [x] T-F0-7 `TenantModule`: resolver tenant, `SET LOCAL app.tenant_id`, políticas RLS en las tablas base.
  - Prueba: auth-access › "Admin de otra agencia" con dos tenants.
- [x] T-F0-8 TOTP obligatorio para owner/admin/super_admin y pantalla de activación, en UI y API (delta de `auth-access`).
  - Prueba: auth-access › "Admin sin TOTP" (incluye 403 `TWO_FACTOR_REQUIRED`).
  - Prueba: auth-access › "Admin sin TOTP en un endpoint no administrativo".
  - Prueba: auth-access › "Ruta administrativa sin exigencia de segundo factor" (inventario de rutas).
  - La pantalla de activación pasa a T-F0-10 junto al shell (decisión del dueño, 2026-11-10).
- [x] T-F0-9 `audit_logs` inmutable (permisos de BD) e interceptor `AuditModule` con un endpoint de ejemplo.
  - Prueba: audit › "Intento de borrado", "Admin aprueba un pago" (con acción de ejemplo).
- [x] T-F0-10 `next-intl` en web y admin con es/en y rutas `/es` `/en`; shell de cada app con login.
  - Incluye la pantalla de activación de TOTP de T-F0-8 (redirige ante 403 `TWO_FACTOR_REQUIRED`).
  - Prueba: web y admin `routing`, `alternate-links`, `messages` (paridad es/en y claves usadas); shared `auth-api`
    y `auth-client` (44 tests). Verificación e2e local (2026-11-10): `/` redirige a `/es` y hreflang en ambas
    apps; login por el proxy del admin; `GET /admin/audit-logs` con org activa responde 403
    `TWO_FACTOR_REQUIRED`; `two-factor/enable` → `verify-totp` → audit-logs 200; login posterior devuelve
    `twoFactorRedirect` con cookie pendiente de 10 min y `verify-totp` crea la sesión.
- [x] T-F0-11 Wireframes SVG de baja fidelidad de búsqueda, detalle, checkout y panel de pagos en `docs/wireframes/`.
  - Prueba: los 6 SVG (busqueda, busqueda-movil, detalle, checkout, checkout-movil, panel-pagos) validan como XML
    bien formado y contienen las reglas obligatorias (precio USD + equivalente VES con tasa BCV y fecha valor,
    temporizador de retención de 30 min, estados IN_REVIEW/APPROVED/REJECTED y modos AUTO/MANUAL, leyenda
    «Documento no fiscal», versiones móviles); `docs/wireframes/README.md` indexa pantallas y reglas.
- [ ] T-F0-12 Verificación de la change: `/verify f0-foundations` en conversación limpia; archivar con `/opsx:archive`.
- [x] T-F0-13 Fix del bloqueante V1 del informe de verificación: TOTP y auditoría en las rutas administrativas del
  middleware de Better Auth (`/api/auth/admin/*` y escrituras admin-grade de `/api/auth/organization/*`) vía
  `hooks.before/after`, con deltas de `auth-access` y `audit` aprobadas primero.
  - Prueba: auth-access › "Admin sin TOTP en una ruta administrativa de Better Auth", "Usuario sin rol
    administrativo en una ruta administrativa de Better Auth" y "Ruta administrativa sin exigencia de segundo
    factor" (inventario Nest + Better Auth); audit › "Owner invita a un miembro" y "Escritura de Better Auth
    deja fila tras confirmarse"; el caso "owner invita a un proveedor" pasa a owner con TOTP.
- [x] T-F0-14 Fix del bloqueante V2 del informe de verificación: e2e de revocación de sesión por el endpoint del
  plugin admin (super admin con TOTP → 200, fila de plataforma en `audit_logs`, víctima 401 con la cookie
  revocada). Detectó y corrigió el desalineo del preestado de `revoke-user-session` (commit `c0cb9a8`).
  - Prueba: audit › "Super Admin revoca una sesión".
- [x] T-F0-15 Fix del bloqueante B3 del segundo informe: clasificar la exigencia de TOTP de las escrituras de
  `/api/auth/organization/*` por la organización objetivo (cuerpo, query o activa) y no por la activa; si no puede
  determinarse, falla cerrado (403 `TWO_FACTOR_REQUIRED` para un rol administrativo en cualquier agencia). La
  auditoría se imputa a la agencia objetivo o a la de la entidad devuelta (`cancel-invitation`).
  - Prueba: auth-access › "clasificación por la organización objetivo (fix B3 del segundo informe)": owner sin TOTP
    ni organización activa con `organizationId` en el cuerpo, flujo con TOTP, escritura sin objetivo determinable
    (owner y agente), owner escribiendo en otra agencia y ruta de organización no administrativa; el inventario de
    Better Auth recorre también la pasada por `organizationId` y la de cuerpo vacío.
- Nota (M1 del informe): configurar `trustedProxies` al decidir el hosting; hoy la IP tras un proxy resuelve a
  null y el rate limit de login degenera en bucket global.
- Nota (M2 del informe): Helmet, CSP y CORS antes de cualquier demo pública (faseados en F5 por el SDD §13).
