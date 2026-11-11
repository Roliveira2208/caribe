# Revisión de seguridad — change `f0-foundations`

> **Obsoleta desde 2026-11-11 en lo que toca al segundo factor.** Es una revisión estática anterior
> al bloqueante B3 del segundo informe de verificación (`docs/plans/verify-f0-foundations-2.md`):
> no probó el estado de sesión sin organización activa, así que su veredicto «F0 puede archivarse»
> y su §2 («2FA en rutas administrativas — fix V1 vigente») ya no describen el estado del código.
> El fix de B3 está en el commit `6ab9432` y la corrección documentada en
> `openspec/changes/f0-foundations/design.md`. Se conserva como registro de la revisión; no se
> archiva.

**Fecha:** 2026-11-10 · **Modo:** solo lectura (sin modificar código, configuración ni BD). Única salida: este informe.
**Guía:** `.claude/agents/security-reviewer.md` (7 áreas). **Alcance:** todo lo implementado en F0 — `apps/api`,
`apps/web`, `apps/admin`, `packages/shared`, migraciones Prisma, `compose.yaml`, `.env.example`, CI.
**Método:** lectura de primera mano de cada archivo fuente y test relevante (no solo reportes previos);
verificación de código de `better-auth` y del adaptador Nest en `node_modules`; `pnpm audit --recursive`;
chequeo de git para secretos versionados.

## Semáforo global: 🟡 — sin hallazgos críticos ni altos

| # | Hallazgo | Criticidad | Estado |
|---|---|---|---|
| S1 | `trustedProxies` sin configurar: tras proxy en producción, el rate limit degenera en bucket global y la auditoría registra la IP del proxy | 🟠 medio | Deuda registrada (M1, `tasks.md:49-50`); corregir al decidir hosting |
| S2 | Sin Helmet, CSP ni CORS acotado en API y frontends | 🟠 medio | Deuda registrada (M2, `tasks.md:51`); faseada en F5 (SDD §13) |
| S3 | `minimatch` < 11.0.1 vulnerable a DoS (GHSA-g3hv-75wg-m249), solo devDependencies | 🟡 bajo | Actualizar cuando toque toolchain |
| I1–I5 | Informativos (stub de bookings, validación manual L2, TRUNCATE no bloqueado, password de seed) | ⚪ informativo | Ver §5 |

**Veredicto:** F0 **puede archivarse**. No hay vulnerabilidades explotables en el alcance de la fase; S1/S2 son
deuda de despliegue ya registrada con ventana concreta (hosting / F5). Detalle y justificación en §6.

---

## 1. Autenticación y sesión ✅

- **Cookies de sesión:** Better Auth emite cookies `httpOnly: true` y `sameSite: "lax"` por defecto, y
  `secure` en producción vía `advanced: { useSecureCookies: isProduction }` (`apps/api/src/auth.ts:96`),
  con `isProduction` derivado del `NODE_ENV` validado por Zod (`apps/api/src/env.ts`). Sin atributos
  debilitados manualmente.
- **Secreto:** `secret: requiredEnv("BETTER_AUTH_SECRET")` (`auth.ts:89`) — obligatorio, sin fallback, solo
  variable de entorno. `requiredEnv` lanza si falta (`apps/api/src/env.ts`). `.env` no está versionado
  (verificado en git: solo existe `.env.example`); `test/setup-env.ts` genera secretos aleatorios y solo
  corre en tests.
- **Rate limit:** activo siempre (`enabled: true`, `auth.ts:100`), no solo en producción, con reglas custom
  para `/sign-in/email` (60 s / 10), `/sign-up/email` y `/forget-password` (60 s / 5) (`auth.ts:101-105`).
  Verificado en el código de la lib que `customRules` prevalecen sobre las default special rules. A esto se
  suma el lockout por cuenta del 2FA (§2). **Reserva:** la granularidad por IP depende de S1.
- **`redirectTo`:** la API de Better Auth valida el origen del redirect contra `baseURL`/`trustedOrigins`
  (verificado en la lib). En el front, `safeLocalizedRedirectPath` (`packages/shared/src/auth-api.ts`)
  fuerza paths relativos locales (`es`/`en`) y se aplica en las 4 páginas de login/2FA de ambos frontends;
  hay tests que cubren open-redirect. No se encontró forma de derivar a otro dominio.
- **Guard global deniega por defecto:** `AdminTwoFactorGuard` (subclase de la guard de permisos) está
  registrado como `APP_GUARD` (`apps/api/src/app.module.ts`) y usa `@Public`/`disableGlobalAuthGuard`
  solo en las rutas explícitamente abiertas (`apps/api/src/auth-bootstrap.ts` + controladores). Cualquier
  ruta nueva sin decorador queda 403 por defecto. El inventario completo de rutas (Nest + Better Auth) está
  particionado y testeado en `apps/api/test/two-factor.e2e.ts`.

## 2. Autorización ✅

- **Matriz rol×permiso:** `apps/api/src/access.ts` define el universo completo de permisos por rol
  (platform/owner/admin/staff/customer) y las guards `@MemberHasPermission`/`@UserHasPermission` la aplican.
  `organizations.controller.ts:50-52` exige rol de plataforma además del permiso.
- **2FA en rutas administrativas — fix V1 vigente:** el bloqueante V1 del informe de verificación (rutas
  admin de Better Auth sin TOTP ni auditoría) está corregido y verificado de primera mano:
  - Guard Nest: `AdminTwoFactorGuard` exige TOTP verificado para roles administrativos en rutas
    administrativas (`apps/api/src/admin/admin-two-factor.guard.ts`), usando `admin-route.ts`
    (`BETTER_AUTH_ADMIN_ROUTES` + allowlist) como clasificación de rutas.
  - Rutas Better Auth: hooks `before`/`after` en `auth.ts:107+` devuelven `403 TWO_FACTOR_REQUIRED` para
    roles administrativos sin TOTP y escriben la fila de auditoría tras confirmarse. Cubre
    invite/update-member-role/remove-member, organization update/delete y todo el plugin admin
    (set-user-role, ban/unban, revoke-user-session…).
  - `impersonate-user` sigue de facto denegado (no está en el universo de `access.ts`).
  - Tests: `two-factor.e2e.ts` cubre el inventario Nest + Better Auth completo; "Owner invita a un miembro",
    "Super Admin revoca una sesión" (fix V2, commit `c0cb9a8`) y el resto de escenarios de las deltas.
- **Endpoints sin decorador de permiso:** solo `GET /api/v1/bookings/:id` (`bookings.controller.ts:9`), un
  stub declarado en la change que exige sesión (guard global) y devuelve placeholder. No expone datos de
  negocio ni de otros tenants; F1 lo reemplaza (ver I1 en §5).
- **IDOR entre tenants:** el contexto de tenant se toma de la sesión/membresía del servidor
  (`tenant-context.ts`), nunca del cliente. RLS es la segunda capa (§3). Los tests de `tenant` y `audit`
  cubren aislamiento entre agencias.

## 3. Aislamiento de datos (RLS) ✅

- **Políticas fail-closed:** `audit_logs_tenant_rls` y las políticas de Better Auth usan
  `current_setting(..., true)` — devuelven NULL (y la política rechaza) si el GUC no está fijado, sin
  depender de una GUC por defecto relajada. `FORCE ROW LEVEL SECURITY` aplica también al dueño de la tabla.
  Las políticas `WITH CHECK` bloquean inserts fuera del tenant.
- **Rol de aplicación restringido:** la migración `restricted_app_role` crea el rol `caribe_app` con
  `NOBYPASSRLS`, sin `SUPERUSER`, con GRANTs acotados a las tablas necesarias. El script
  `scripts/set-caribe-app-password.mjs` fija la contraseña solo desde `CARIBE_APP_DB_PASSWORD` (`.env`).
  `compose.yaml` no expone credenciales de superusuario a la app.
- **Filas `tenant_id` NULL:** solo las filas de plataforma (`audit_logs` de plataforma y operaciones
  system-level, p. ej. seed vía `auth.api` sin sesión HTTP). Están cubiertas por la política de plataforma
  (`bindContext({ kind: "platform" })` fija el GUC de plataforma en la misma transacción).
- **SQL crudo:** solo 2 `$executeRaw` en el código de producción (`tenant.service.ts:70,72`), ambos
  `set_config` con bind parameters (identificadores inyectables: ninguno; los GUC son constantes del
  módulo). Comprobado que no hay `${...}` con input de usuario.

## 4. Auditoría ✅

- **Inmutabilidad:** `audit_logs_immutable` hace `REVOKE UPDATE, DELETE` a todos los roles y añade trigger
  que bloquea la modificación. Sin ruta de escritura secundaria.
- **Origen del registro:** `actorId` sale de `session.user.id`, `ip` de `request.ip`, y la fecha es
  `@default(now())` del servidor (`audit-interceptor.ts:79-88`; schema Prisma). Las claves del body se
  ignoran deliberadamente (documentado en `organizations.controller.ts:54-56`). Un atacante no puede
  forjar actor/IP/fecha.
- **Fallo cerrado:** una ruta `@Auditable` que no aporta el registro lanza 500 en vez de confirmar la
  operación (`audit-interceptor.ts:75-77`).
- **Misma transacción:** `bindContext` + `auditService.record(tx)` corren dentro de la MISMA transacción
  de la operación (`tenant.service.ts:60-78`, interceptor), así que la fila de auditoría pasa RLS con el
  contexto de la operación y no hay ventana de inconsistencia.
- **Sanitización:** `audit-sanitize.ts` aplica denylist recursiva (contraseñas, tokens, códigos TOTP…)
  sobre `before`/`after` antes de persistir.
- **TRUNCATE:** `TRUNCATE` en `audit_logs` no está revocado explícitamente a `caribe_app` (I3 en §5);
  en la práctica no es ejecutable por la app porque Prisma no genera esa operación y el rol no tiene
  `CREATE` en el schema (un `TRUNCATE` que borra filas requiere permiso de truncate sobre la tabla —
  el GRANT actual es solo SELECT/INSERT para `caribe_app`), y un `DELETE` masivo ya está bloqueado
  por REVOKE + trigger. Residual: bajo, informativo.

## 5. Entradas/salidas, secretos y dependencias

**Entradas/salidas ✅**
- **Zod:** `env.ts` valida todo el entorno; `packages/shared` valida los payloads compartidos
  (`auth-api.ts`). Única validación manual: `organizations.controller.ts:54-63` (dos campos de cadena),
  un desvío del patrón L2 documentado y aceptado en `design.md` (I2).
- **Inyección SQL:** sin concatenación de strings en SQL; los únicos raw usan bind parameters (§3).
- **XSS:** React escapa por defecto; cero `dangerouslySetInnerHTML` en los tres paquetes (grep). Los textos
  visibles vienen de JSONB es/en, no de cadenas interpoladas con input.
- **Mensajes de error:** `BadRequestException`/`ForbiddenException` con mensajes descriptivos pero sin
  información interna (stacks solo en logs de servidor); `requiredEnv` no imprime el valor de secretos.

**Secretos ✅**
- Solo por variables de entorno (`requiredEnv`); `.env` no versionado; `.env.example` al día (cubre todo
  lo que el código lee, con placeholders F1/F4); `setup-env.ts` restringido a tests; no hay secretos
  hardcodeados en código de producción. `DEMO_PASSWORD = "CaribeDemo123!"` (`seed.ts:28`) es dato de
  demostración pública, solo con fines de desarrollo local (I4).

**Dependencias 🟡**
- `pnpm audit --recursive`: **1 moderate** — `minimatch` ≥ 7.0.0 < 11.0.1, DoS vía "globparts
  amplification" (GHSA-g3hv-75wg-m249). Los 43 caminos afectados son **todos devDependencies** de la
  toolchain de lint (eslint / eslint-config-prettier): no alcanza el runtime de la API ni de los
  frontends. Corrección: subir la toolchain a `minimatch ≥ 11.0.1` cuando toque renovar dependencias
  de dev (S3).

## 6. Helmet / CSP / CORS / trustedProxies (SDD §10) — S1 y S2

**S1 — `trustedProxies` sin configurar (🟠 medio, M1).**
`auth.ts:86-106` no define `advanced.ipAddress.trustedProxies` ni `ipAddressHeaders`. Tras un proxy
inversor en producción, `getIP` no resuelve una IP de cliente y la propia lib degrada el rate limit a
"single shared per-path bucket" con warning (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:244-248`).
Consecuencias concretas:
- **Rate limit:** las reglas de `auth.ts:101-105` siguen aplicando, pero contando por ruta (no por
  cliente): un ataque de fuerza bruta consume el bucket global y provoca denegación de servicio a
  usuarios legítimos (fail-closed, no bypass). Sin proxy (desarrollo y CI) la IP se resuelve
  normalmente, por eso no se vio en tests.
- **Auditoría:** `audit-interceptor.ts:87` registra `request.ip`, que tras proxy sin configuración es la
  IP del proxy o `undefined` — no la IP real del actor (calidad de evidencia, no explotable).

**Corrección sugerida:** al fijar el hosting, añadir en `auth.ts`:
`advanced: { useSecureCookies: isProduction, ipAddress: { trustedProxies: ["<IP del proxy/LAN>"] } }`
(y/o `ipAddressHeaders: ["x-forwarded-for"]` si el proxy lo garantiza) más `app.set('trust proxy', …)` /
`trustedProxies` de Nest para que `request.ip` refleje el cliente en la auditoría. Debe hacerse junto con
la decisión de infraestructura, no antes: confiar en un header que el proxy no controla introduciría
spoofing de IP (hoy es fail-closed, y por eso medio y no alto).

**S2 — sin Helmet/CSP/CORS (🟠 medio, M2).**
`bootstrap.ts` no registra Helmet ni CORS (la API no emite HTML ni acepta CORS abierto: las cookies son
`lax` y `trustedOrigins` ya filtra cross-origin en Better Auth), y `next.config.ts` de web/admin no
define cabeceras de seguridad. Riesgo actual: sin CSP no hay segunda capa contra XSS (la primera capa,
el escape de React, está en verde), y la API sirve sin `X-Content-Type-Options`, `HSTS`, etc. El SDD §10
lo exige y el SDD §13 lo fasea en F5, con nota explícita en `tasks.md:51` antes de cualquier demo
pública. **Corrección sugerida:** en F5 (o antes de una demo pública): `helmet` + CSP sin `unsafe-inline`
(para las páginas de admin/web que lo toleren), CORS con allowlist de orígenes si el front se sirve desde
otro dominio, y `Strict-Transport-Security` tras TLS.

## 7. Verificación de los fixes del informe previo

| Fix | Verificado |
|---|---|
| V1 — TOTP + auditoría en rutas administrativas de Better Auth | ✅ hooks `before`/`after` en `auth.ts` + tests del inventario completo en `two-factor.e2e.ts` |
| V2 — test de revocación de sesión por plugin admin | ✅ "Super Admin revoca una sesión" presente; flujo 200 + fila de plataforma + 401 de la víctima (commit `c0cb9a8`) |

Ambos permanecen corregidos; no se re-abren.

## 8. Veredicto

**F0 puede archivarse.** Las 7 áreas de la guía están en verde en el alcance de la fase: autenticación con
cookies endurecidas y rate limit activo, autorización con matriz exhaustiva y 2FA en ambas familias de
rutas, RLS fail-closed con rol `NOBYPASSRLS`, auditoría inmutable en la misma transacción con actor/IP/fecha
del servidor, entradas validadas y sin SQL/XSS explotables, secretos solo por entorno, y sin dependencias
vulnerables en runtime. Los dos medios (S1 trustedProxies, S2 Helmet/CSP) son deuda de despliegue con
ventana y owner ya definidos — condición documentada en `tasks.md:49-51` y en este informe, y ninguna es
explotable en el estado actual (sin proxy en producción; sin demo pública). Se recomienda:

1. **Antes del primer despliegue tras proxy:** resolver S1 (trustedProxies) — es prerrequisito para que el
   rate limit per-IP y la IP de auditoría signifiquen algo.
2. **Antes de cualquier demo pública:** resolver S2 (Helmet/CSP/CORS), como ya exige el SDD.
3. En la próxima renovación de toolchain: subir `minimatch` (S3).
4. Al reemplazar el stub de bookings (F1) y al migrar `organizations.controller` a Zod (L2): cerrar I1/I2.
