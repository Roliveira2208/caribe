# Verificación de la change `f0-foundations` — T-F0-12

**Fecha:** 2026-11-10 · **Modo:** conversación limpia (`/verify f0-foundations`), sin corregir nada ni marcar tareas.
**Método:** lectura de proposal/design/tasks y de las specs base y deltas; revisión con subagentes `spec-reviewer`
(comparación escenario por escenario) y `security-reviewer` (SDD §10 + reglas de `AGENTS.md`); ejecución real del
pipeline completo replicando la CI (runs frescos, sin caché de turbo). Los hallazgos críticos del subagente de
seguridad fueron **re-verificados de primera mano** antes de entrar en este informe (evidencia citada abajo).

## Semáforo global: 🔴 — no archivar todavía

La base es sólida (pipeline entero en verde, RLS fail-closed, auditoría inmutable, matriz de permisos exhaustiva),
pero hay **2 bloqueantes** que contradicen specs vigentes y están demostrados por tests propios del repo:

| # | Hallazgo | Criticidad | Spec incumplida |
|---|---|---|---|
| V1 | **Rutas administrativas de Better Auth sin TOTP y sin auditoría** (ver detalle) | 🔴 crítico | delta `auth-access` (toda ruta administrativa SHALL exigir 2FA) + `audit` (cambiar roles y revocar sesiones SHALL auditar) |
| V2 | **Escenario "Revocar sesión" sin test y sin aplazamiento declarado** | 🔴 | `auth-access` base (sesiones revocables) |

---

## 1. Pipeline real (runs frescos, `--force` donde aplica)

| Paso | Resultado | Notas |
|---|---|---|
| `pnpm lint` | ✅ | eslint raíz + 4 paquetes |
| `pnpm typecheck` | ✅ | 5 tareas tsc |
| `pnpm test --force` | ✅ | **160 tests**: api 90 (48 e2e contra PostgreSQL real), shared 44, web 13, admin 13 — 32 s |
| `node scripts/check-specs.mjs` | ✅ | 8 specs válidas |
| `prisma migrate diff --from-migrations --to-schema --exit-code` | ✅ | «No difference detected» (schema ↔ migraciones) |
| `pnpm db:migrate:deploy` | ✅ | 4 migraciones, ninguna pendiente (requiere `DATABASE_URL` en el entorno, como en CI) |
| `pnpm build` | ✅ | dist de shared y api; Next 16.4.6 ×2 con SSG de `/es` y `/en` |

Árbol de git limpio antes y después de toda la ejecución. Docker Compose (PostgreSQL 17, Redis 7) healthy.

Verificaciones adicionales hechas en esta sesión:

- **Wireframes T-F0-11:** los 6 SVG existen y validan como XML bien formado; contienen todas las reglas
  obligatorias (USD + equivalente VES con tasa BCV y fecha valor, temporizador 30 min, IN_REVIEW/APPROVED/REJECTED,
  AUTO/MANUAL, «Documento no fiscal», versiones móviles) y `docs/wireframes/README.md` indexa pantallas y reglas.
- **`.env.example`** cubre todas las variables que el código lee (`DATABASE_URL`, `BETTER_AUTH_URL`,
  `BETTER_AUTH_SECRET`, `TRUSTED_ORIGINS`, URLs, y placeholders F1/F4). No existe `.env` en este checkout (paso
  manual documentado; los tests se auto-configuran contra la BD local vía `test/setup-env.ts`).
- Sin `TODO(F2)` literal en el repo; los `TODO(F1)` exigidos están (ver hallazgo amarillo A5).

---

## 2. V1 (🔴 crítico, verificado de primera mano): rutas admin-grade de Better Auth evaden TOTP y auditoría

**Mecanismo.** `@thallesp/nestjs-better-auth` monta el handler de Better Auth como middleware crudo del adaptador
HTTP (`apps/api/node_modules/@thallesp/nestjs-better-auth/dist/index.mjs:902-904`,
`httpAdapter.use((req, res, next) => authHandler(req, res, next))`), que corre **antes** del pipeline de Nest:
ni `AdminTwoFactorGuard` ni el `AuditInterceptor` (que solo actúan en controladores Nest con
`@MemberHasPermission`/`@UserHasPermission`/`@Auditable`) alcanzan esas rutas.

**Rutas afectadas** (admin-grade según la propia definición de la delta: exigen permiso exclusivo de
owner/admin/super_admin en la matriz aprobada de `design.md`):
`POST /api/auth/organization/invite-member`, `update-member-role`, `remove-member`, `organization/update|delete`,
y las del plugin admin: `set-user-role`, `ban-user`, `unban-user`, `revoke-user-session`, `create-user`, etc.
`impersonate-user` está de facto denegado (el universo de `access.ts` no lo incluye y Better Auth exige
`user:["impersonate"]`), así que esa concreta no es explotable.

**Demostración con tests propios del repo.**

- `apps/api/test/auth.e2e.ts:140-152`: un owner **sin TOTP** llama `invite-member` → **200**. Si la delta se
  cumpliera, sería 403 `TWO_FACTOR_REQUIRED` (la invitación exige `invitation:create`, exclusivo de owner/admin).
- `apps/api/test/two-factor.e2e.ts:56-73`: el inventario de rutas administrativas usa `DiscoveryService` de Nest;
  las rutas middleware de Better Auth **son invisibles al inventario**, así que el escenario delta «inventario»
  pasa en verde mientras existen rutas admin-grade sin segundo factor. Por eso ese escenario se reclasifica 🔴
  (el subagente spec lo dio 🟢; la evidencia de arriba obliga a bajarlo).
- Auditoría: ninguna de esas acciones escribe en `audit_logs` (el interceptor solo cubre handlers Nest con
  `@Auditable`), y la spec base exige auditar «cambiar roles» y «revocar sesiones».

**Escenario de explotación.** Un atacante con una sesión robada de owner/admin (cookie filtrada, XSS futuro,
equipo desatendido — exactamente el caso que el TOTP administrativo cubre) hace `invite-member` con su propio
correo y rol `owner` → persiste como owner aunque cambien la contraseña y revoquen la sesión robada, sin dejar
rastro en auditoría. Variantes: `set-user-role` para escalar cómplices, `revoke-user-session`/`ban-user` para
bloquear al dueño real.

**Arreglos posibles** (decisión del dueño; no se corrigió nada en esta verificación):

1. `hooks.before` en la instancia de Better Auth (`src/auth.ts`) que replique el check de `AdminTwoFactorGuard`
   para los paths admin-grade de `organization/admin` y escriba la fila de auditoría vía `AuditService`.
   Mantener accesibles `two-factor/enable` y `two-factor/verify-totp` (la delta lo exige).
2. Mínimo: bloquear esos paths con 403 en `hooks.before` hasta su change del panel (F2).
3. O ampliar el inventario e2e para barrer también las rutas de Better Auth y que el escenario delta vuelva a
   significar lo que dice.

**Alternativa formal:** si el dueño decide que esas rutas se cubren en F2 con el panel, hace falta declararlo
explícitamente en `proposal.md`/`design.md` (y ajustar la delta si procede); hoy no está declarado en ninguna
parte, y el código contradice la spec (`AGENTS.md`: el código está mal).

## 3. V2 (🔴): escenario «Revocar sesión» sin test ni aplazamiento

`openspec/specs/auth-access/spec.md` (Límite de intentos y sesiones): «las sesiones SHALL ser revocables desde el
panel». El permiso `session:revoke` está concedido a super_admin y probado a nivel de matriz
(`apps/api/src/access.ts:59`, `test/access.test.ts:40`), y el endpoint existe montado por el plugin admin, pero
**ningún test ejercita revocar una sesión y verificar el 401 posterior** (grep de `revoke`/`revocar` en tests:
solo celdas de matriz), y el aplazamiento no está declarado en proposal/design/tasks. Se relaciona con V1:
`revoke-user-session` es una de las rutas sin TOTP y sin auditoría. Conviene un e2e mínimo
(`POST /api/auth/admin/revoke-user-session` → siguiente solicitud 401) o una línea explícita de aplazamiento.

---

## 4. Escenarios GIVEN/WHEN/THEN por spec

### `auth-access` base

| Escenario | Estado | Implementación | Test |
|---|---|---|---|
| Ruta protegida sin sesión → 401 | 🟢 | `apps/api/src/bookings/bookings.controller.ts:9-13` (guard global) | `test/auth.e2e.ts:42-45` |
| Catálogo público → 200 | 🟢 | `apps/api/src/catalog/products.controller.ts:13-18` (`@AllowAnonymous`) | `test/auth.e2e.ts:57-62` |
| Proveedor edita su producto → 200 | 🟡 | `products.controller.ts:20-25` | `test/auth.e2e.ts:97-112`. El THEN y el permiso quedan probados; el GIVEN «dueño del producto» no puede verificarse sin tabla producto (propiedad declarada para F1: `design.md:127,165`) |
| Proveedor edita producto ajeno → 403 | 🔵 aplazado F1 | stub actual lo declara (`products.controller.ts:8-9`) | — (declarado en `design.md:165`, `proposal.md:44-45`) |
| Cliente ve solo sus reservas → 404 ajena | 🔵 aplazado F1 | — | mecanismo análogo probado a nivel BD: `test/tenant.e2e.ts:148-156` (fila ajena invisible por id) |
| Admin de otra agencia → 404 | 🔵 aplazado F1 | RLS implementada y probada sobre `audit_logs` | migración `20261110061923.../migration.sql:34-50`; `tenant.e2e.ts:125-166` como `caribe_app`; `database.test.ts:176-188`. El HTTP literal llega con el catálogo (`design.md:231-233`) |
| Admin sin TOTP | 🟡 | ver delta | ver delta |
| **Revocar sesión → 401 en la siguiente** | 🔴 | permiso en matriz (`access.ts:59`); endpoint de Better Auth montado | **sin test y sin aplazamiento declarado** (V2) |

### `auth-access` delta (f0-foundations)

| Escenario | Estado | Implementación | Test |
|---|---|---|---|
| Admin sin TOTP (UI mantiene en activación AND API 403 `TWO_FACTOR_REQUIRED`) | 🟡 | API: `apps/api/src/admin/admin-two-factor.guard.ts:84-88` (check antes que permisos, deliberado). UI: `apps/admin/src/components/audit-log-panel.tsx:55-57` + `two-factor-form.tsx:62-79` + login forms de ambas apps | API: `test/two-factor.e2e.ts:75-80,111-125,127-130,132-166`. UI: solo contrato en `packages/shared/test/auth-api.test.ts` (52-76, 155-168); la redirección tiene **verificación e2e manual documentada** (`tasks.md` T-F0-10, 2026-11-10) pero no test automatizado |
| Admin sin TOTP en endpoint no administrativo → 2xx | 🟢 | — | `test/two-factor.e2e.ts:82-91` (owner sin TOTP → PUT producto 200) |
| Inventario: toda ruta administrativa exige segundo factor | 🔴 | clasificación pura desde la matriz (`src/admin/admin-route.ts`) | el test existe y pasa (`two-factor.e2e.ts:56-73`; clasificación fijada en `admin-route.test.ts:40-89`), pero el inventario (DiscoveryService) **no ve las rutas middleware de Better Auth**, y hay admin-grade sin TOTP demostrado (V1). El escenario solo se cumple para rutas Nest |

### `audit` base

| Escenario | Estado | Implementación | Test |
|---|---|---|---|
| Admin aprueba un pago → fila con antes/después | 🔵 aplazado F2 | mecanismo completo con acción de ejemplo | interceptor `audit-interceptor.ts:67-92` + `test/audit.e2e.ts:140-161`; pagos → F2 (`proposal.md:44-45`) |
| Intento de borrado → BD rechaza | 🟢 | migración `20261110150000.../migration.sql:12` (REVOKE) + `:14-22` (trigger) | `audit.e2e.ts:437-470` (como `caribe_app`), `:472-509` (trigger con GRANT transitorio), `:511-537` (trigger incluso como dueño); SQL validado en `database.test.ts:161-188` |
| Agente consulta auditoría → 403 | 🟢 | `apps/api/src/audit/audit.controller.ts:30,52-59` | `audit.e2e.ts:175-180`; correspondencia matriz↔lectores en `:165-173` |

### `audit` delta (f0-foundations)

| Escenario | Estado | Implementación | Test |
|---|---|---|---|
| Super Admin crea una agencia → fila `tenant_id` NULL + actor/acción/antes/después | 🟢 | `organizations.controller.ts:44-89` (`@Auditable({platform:true})`); interceptor escribe NULL (`audit-interceptor.ts:80`) | `audit.e2e.ts:216-254` (spoof de actor/ip/at ignorado); negativos `:256-270,272-293` |
| Agencia no lee auditoría de plataforma → cero filas NULL | 🟢 | política RLS `audit_logs_platform` (`20261110061923.../migration.sql:48-50`), fallo cerrado | `tenant.e2e.ts:125-133,163-166`; `audit.e2e.ts:193` |
| Super Admin consulta auditoría → plataforma + todas las agencias | 🟢 | `audit.controller.ts:42-45` (`withPlatform`) | `audit.e2e.ts:197-212` (NULL + agencias A y B) |
| Admin de agencia solo lee su agencia | 🟢 | `audit.controller.ts:46-69` (rol miembro + `withTenant` + `where tenantId` en profundidad) | `audit.e2e.ts:182-195` (todo = orgA, sin NULL, sin B) |

### `payments` base (9 escenarios) y delta (6 escenarios)

**Todos 🔵 aplazados a F2 / spec-only.** Citas: `proposal.md:44-45` («Fuera de alcance: Catálogo, reservas, pagos
y tasas (F1 y F2)»), `design.md:134-139` (el invariante «revisor ≠ pagador» quedó **como delta de payments en esta
change**: la spec se escribe ahora, la implementación llega en F2), SDD §13 (F2 = panel y tasas). Verificado en
código: `schema.prisma` no tiene modelo de pago (solo 8 tablas Better Auth + `AuditLog`) y no existen endpoints
de pago. Dato relevante: la matriz RBAC ya refleja el delta — `payment:review` solo en owner/admin
(`access.ts:76,89`), super_admin de solo lectura, agente/proveedor sin review — probado en
`access.test.ts:43,55,70,82,87`.

### Conteos (32 escenarios distintos; el «Admin sin TOTP» base y delta cuentan una vez)

| Estado | Total |
|---|---|
| 🔴 | 2 (Revocar sesión; Inventario de rutas administrativas — por V1) |
| 🟡 | 2 (Admin sin TOTP — mitad UI manual; Proveedor edita su producto — GIVEN de propiedad en F1) |
| 🟢 | 9 |
| 🔵 aplazados declarados (F1/F2, spec-only) | 19 (3 auth base, 1 audit base, 9 payments base, 6 payments delta) |

---

## 5. Revisión de seguridad (subagente `security-reviewer`, hallazgos clave re-verificados)

**Bien implementado y verificado (evidencia):** RLS fail-closed por GUC (`tenant.e2e.ts:163-166`,
`database.test.ts:176-188`) · inmutabilidad doble (REVOKE + trigger) · matriz de permisos exhaustiva con `member`
neutralizado (`access.ts` + `access.test.ts`) · sanitizador de auditoría denylist recursivo y cycle-safe
(`audit-sanitize.ts:17-29`) · redirect validado server-side (`packages/shared/src/auth-api.ts:164-172`,
`safeLocalizedRedirectPath`, usado en las 4 páginas de login/2FA) · flujo 2FA endurecido (borrado de cookies de
sesión al quedar pendiente, cookie `two_factor` firmada Max-Age=600, `useSecureCookies` solo en producción,
lockout per-cuenta tras 10 fallos) · sin `console.*` en `src`, sin secretos en código, sin
`dangerouslySetInnerHTML`, `trustedOrigins` acotado · schema sin `float` para dinero (invariante testeado en
`database.test.ts:78-81`).

| ID | Severidad | Hallazgo | Referencia | Comentario |
|---|---|---|---|---|
| C1 = V1 | 🔴 | Bypass de TOTP + evasión de auditoría en rutas admin-grade de Better Auth | `dist/index.mjs:902-904`; demostrado por `auth.e2e.ts:140-152` | detallado arriba |
| M1 | 🟡 | `trustedProxies` sin configurar (pregunta abierta de `design.md`): tras proxy en producción la IP resuelve a null → rate limit de login degenera en bucket global (~10/min para todos) y la fuerza bruta pierde el freno por IP. Hoy es fail-closed ante spoofing y el lockout 2FA sí es per-cuenta | `apps/api/src/auth.ts` | fijar al decidir hosting + test e2e con XFF; considerar contador per-cuenta de intentos de contraseña |
| M2 | 🟡 | Helmet/CSP/CORS ausentes (la API no monta Helmet ni acota CORS; frontends sin CSP) | `apps/api/src/main.ts`, `next.config.ts` de ambas apps | SDD §10 los lista y §13 los fase en F5; entrar antes de cualquier demo pública |
| L1 | 🟢 | `GET /api/v1/bookings/:id` exige sesión pero ningún permiso (stub) | `apps/api/src/catalog/` | F1 lo sustituye; conviene que el inventario e2e exija permiso o `@AllowAnonymous` explícito en toda ruta no pública |
| L2 | 🟢 | `POST /admin/organizations` valida a mano sin Zod | `organizations.controller.ts` | documentado en `design.md`; migrar a Zod cuando el payload crezca |
| L3 | 🟢 | La migración de inmutabilidad no bloquea `TRUNCATE` | `migrations/...150000/` | `caribe_app` nunca recibió GRANT TRUNCATE (decisión documentada); opcional trigger BEFORE TRUNCATE |
| L4 | 🟢 | `DEMO_PASSWORD` fija en el seed | `prisma/seed-main.ts:13` | dato público de dev declarado en `design.md:188-191`; sugerido guard que aborte si `NODE_ENV=production` |

## 6. Otros hallazgos (no son escenarios de spec)

- **A1 (🟡, infra de proceso):** `openspec/ROADMAP.md:8` sigue en «Listo para empezar» y no menciona el delta de
  `payments` que la change arrastra desde T-F0-6. Actualizar al archivar (la propia definición de terminado lo pide).
- **A2 (🟢, evidencia manual ahora documentada):** la «prueba» de T-F0-11 (SVG validan como XML y contienen las
  reglas) no existe como test automatizado; en esta verificación se ejecutó manualmente y pasó (sección 1).
  Si se quiere permanente, un script node de ~20 líneas en CI la haría repetible.
- **A3 (🟡 menor):** falta la marca literal `TODO(F2)` en el stub de tasas que `design.md:262` cita; el comentario
  en prosa sí documenta el reemplazo por F2 (`apps/api/src/admin/admin.controller.ts:23-24`).
- **A4 (🟢):** mensajes de error de la API en español fijo (p. ej. `admin-two-factor.guard.ts:87`). No viola la
  regla 9: las UI traducen códigos y jamás muestran el `message` crudo (verificado en componentes y tests de
  mensajes de ambas apps). Punto gris a vigilar en F1/F2.
- **A5 (🟢):** sin `.env` en el checkout, `db:migrate:deploy`/`db:seed` requieren variables en el entorno (como
  en CI, que las define). Paso de setup documentado, no un defecto.
- **Trabajo inventado:** nada silencioso. Los extras (`POST /admin/organizations`, sanitizador, pantalla TOTP con
  QR, `GET /admin/audit-logs`) están declarados y justificados en `design.md`; el seed sin «inventario básico» es
  una desviación declarada en `proposal.md:40-42` (pregunta abierta, decisión del dueño 2026-11-10).

## 7. Conclusión y qué falta para archivar

La change cumple de forma sólida y bien probada lo que declara para F0 (auth por rol, TOTP en la API para rutas
Nest, RLS/tenant fail-closed, auditoría inmutable y de plataforma con alcance de lectura, i18n es/en, wireframes,
CI completa) y la puerta de salida del SDD §13 («inicio de sesión por rol funcionando y pipeline en verde») está
cubierta. Los aplazamientos están documentados con precisión.

**Antes de archivar hace falta resolver (decisión del dueño):**

1. **V1**: cerrar el bypass de Better Auth (hooks.before con TOTP+auditoría, bloqueo 403 temporal, o inventario
   ampliado) — o declarar el aplazamiento explícito en proposal/design con delta si procede.
2. **V2**: test e2e de revocación de sesión (o aplazamiento explícito).

Opcionalmente: marca `TODO(F2)` literal (A3), ROADMAP al archivar (A1), y las mejoras M1/M2 con su ventana
(hosting / pre-demo pública). Nada de esto fue corregido en esta verificación, y ninguna tarea fue marcada.

---

## 8. Corrección de los bloqueantes (2026-11-10, tras el informe)

Los dos bloqueantes se corrigieron siguiendo el flujo spec → código: delta aprobada primero, implementación
después, pipeline en verde en cada commit. La change **no se archiva todavía**: queda pendiente la segunda
verificación en conversación limpia (decisión del dueño) antes del `/opsx:archive` (T-F0-12 sigue abierto).

| # | Corrección | Commit |
|---|---|---|
| V1 | Deltas de spec `auth-access` + `audit`: las rutas administrativas del middleware (`/api/auth/admin/*` y escrituras admin-grade de `/api/auth/organization/*`) exigen TOTP y sus escrituras confirmadas dejan fila en `audit_logs` | `d8e33c7` |
| V1 | Implementación: `hooks.before/after` en la instancia de Better Auth, tabla `BETTER_AUTH_ADMIN_ROUTES`, `isAdminLevelSession` compartida con el guard de Nest; inventario e2e de las dos familias de rutas, negativos por rol y fila de `invite-member` | `7767397` |
| V1 | Fix de un defecto que dejó la implementación anterior: el stash del preestado de `revoke-user-session` no alineaba con la forma de la regla (`id` de Prisma vs `sessionId`), y las props opcionales lo escondieron de typecheck; no se escribía la fila. Detectado al correr el test de V2 | `c0cb9a8` |
| V2 | E2E de revocación: super admin revoca por HTTP → 200, fila de plataforma en `audit_logs` (tenant NULL, actor el super admin, después solo el dueño de la sesión) y la víctima recibe 401 con la cookie revocada en una ruta protegida | `b51717e` |

**Pipeline tras el fix:** `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ **165 tests** (api 95, de los
cuales 53 son e2e contra PostgreSQL real; shared 44, web 13, admin 13) · `node scripts/check-specs.mjs` ✅
(8 specs válidas). Sin dependencias nuevas.

**Amarillos y menores atendidos junto a este informe:** literal `TODO(F2)` en el stub de tasas (A3) y fila F0 de
`openspec/ROADMAP.md` (A1). M1 (`trustedProxies` al decidir hosting) y M2 (Helmet/CSP/CORS antes de cualquier
demo pública) quedan anotados como notas en `tasks.md`, con su ventana. Las decisiones de diseño del fix están
en `design.md` («Fix de la verificación f0-foundations»).
