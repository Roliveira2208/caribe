# Verificación 2 de `f0-foundations` — informe independiente

**Fecha:** 2026-11-11 · **Modo:** solo lectura (código, specs y tareas sin modificar; sin commits; sin archivar).
**Verificador:** conversación limpia, comprobación propia por HTTP y SQL — no se confía en informes previos.
**Alcance:** deltas y specs base afectadas (`auth-access`, `audit`, `payments`), tareas `[x]` de `tasks.md`,
reglas fijas del SDD y pipeline de CI. Salida: este informe. HEAD al empezar y al terminar: `c520ca7` (limpio
salvo este archivo y `docs/plans/security-f0.md`, que no es de esta verificación — ver §7).

---

## Semáforo global: 🔴 — no archivar todavía

| # | Hallazgo | Criticidad |
|---|---|---|
| **B3** | **Bypass del gate TOTP en las escrituras administrativas de `/api/auth/organization/*` cuando la sesión no tiene organización activa** (estado por defecto tras el login). Incumple el delta `auth-access` («Admin sin TOTP en una ruta administrativa de Better Auth»). Nuevo, no detectado por la 1ª verificación ni por los e2e. | 🔴 bloqueante |
| V1 | TOTP + auditoría en rutas admin de Better Auth | 🟡 corregido **a medias**: `/api/auth/admin/*` ✅ y `/organization/*` con org activa ✅; sin org activa → B3 |
| V2 | Revocación de sesión por el plugin admin | 🟢 corregido y verificado por HTTP propio |
| M1–M4 | Menores (§7) | 🟡 |

---

## 1. Pipeline (corridas frescas, `--force`, sin caché de turbo)

| Comprobación | Resultado |
|---|---|
| `pnpm lint --force` | ✅ |
| `pnpm typecheck --force` | ✅ |
| `pnpm test --force` | ✅ **165 tests** (api 95 [53 e2e] · shared 44 · web 13 · admin 13) |
| `node scripts/check-specs.mjs` | ✅ 8 specs |
| `prisma migrate diff --from-migrations --to-schema --exit-code` | ✅ «No difference detected», exit 0 |
| `pnpm db:migrate:deploy` | ✅ 4 migraciones aplicadas, ninguna pendiente |
| `pnpm build --force` | ✅ (SSG `/es` `/en` en web y admin) |
| `.env` versionado | ✅ no existe en el checkout; `git ls-files` solo lista `.env.example` (`.gitignore:2`) |
| Docker | ✅ `caribe-postgres-1` (PostgreSQL 17, puerto 5433) y `caribe-redis-1` (Redis 7) healthy |

---

## 2. B3 — Bypass del TOTP en escrituras `/organization/*` de Better Auth sin organización activa

### Evidencia empírica (API levantada localmente, `node dist/main.js` en 3002)

Owner de agencia de test autenticado por HTTP **sin TOTP** y con sesión recién creada
(`get-session` → `activeOrganizationId: null`, el estado por defecto: la auto-selección de
organización se decidió para F1, `proposal.md:30-34`):

| Prueba | Resultado esperado | Resultado real |
|---|---|---|
| `POST /api/auth/organization/invite-member` con `organizationId` en el body | 403 `TWO_FACTOR_REQUIRED` | **200** — invitación `bypass-v3-…@example.com` creada (pending) |
| `POST /api/auth/organization/update-member-role` con `organizationId` en el body | 403 `TWO_FACTOR_REQUIRED` | **200** — rol del miembro cambiado |

Ambas acciones **dejaron fila en `audit_logs`** (tenant = agencia, actor = owner sin TOTP, entidad
invitation/member), confirmando que la escritura se completó de verdad. El mismo owner con
organización activa recibe correctamente 403 `TWO_FACTOR_REQUIRED` (lo cubre el e2e).

Control negativo: las rutas `/api/auth/admin/*` (`set-role`, `ban-user`, `revoke-user-session`,
`create-user`, con cuerpo válido y vacío) responden **403 `TWO_FACTOR_REQUIRED**` sin TOTP ✅ —
el bypass no alcanza al plugin admin.

### Causa raíz

- `isAdminLevelSession` (`apps/api/src/admin/admin-session.ts:33-42`) clasifica como administrativo
  solo con **rol de plataforma** o **organización activa en la sesión** (`activeOrganizationId`).
- Las escrituras de `/organization/*` de Better Auth 1.7.18 autorizan por **membresía en la
  organización afectada**, que toman del body (`ctx.body.organizationId || session.activeOrganizationId`,
  `crud-invites.mjs:85`; ídem `crud-members.mjs:271` y `crud-org.mjs:199,261`) o de la propia entidad
  (`cancel-invitation` resuelve la org desde la invitación, `crud-invites.mjs:433-445`).
- Sesión sin org activa + `organizationId` en el body → el hook `before` de `auth.ts:118-132` no ve
  rol administrativo → no exige TOTP → la lib autoriza por membresía → **200**.

### Por qué no lo detectan los tests

`ownerCookieWithoutTotp()` (`two-factor.e2e.ts:279-285`) y todos los casos de admin sin TOTP
fijan la organización activa con `set-active` antes de probar, y el inventario
(`two-factor.e2e.ts:82-138`) llama las rutas con **cuerpo vacío** (sin `organizationId`). El estado
por defecto del login (sin org activa) queda sin cubrir.

### Alcance

Rutas afectadas (2 confirmadas por HTTP, 4 por lectura del código de la lib): `invite-member`,
`update-member-role`, `remove-member`, `organization/update`, `organization/delete`,
`cancel-invitation`. Los endpoints Nest (`/api/v1/admin/*`) **no** son explotables: exigen org activa
(`@MemberHasPermission` + red de seguridad en `admin.controller.ts:33-36`) y fallan cerrados.

Mitigantes: la escritura sigue autorizada por membresía (no hay salto de tenant) y queda auditada;
pero la exigencia de segundo factor —el objeto del fix V1— no se cumple.

### Remediación sugerida

Clasificar la sesión como administrativa también por la **organización afectada por la escritura**:
en el hook `before`, para las rutas de `/organization/*`, resolver la org objetivo
(`body.organizationId ?? activeOrganizationId`) y exigir TOTP si el llamador tiene rol
owner/admin en ella (es exactamente el criterio con el que la lib autoriza). Añadir al e2e el caso
que falta: admin sin TOTP, **sin** `set-active`, con `organizationId` en el body → 403
`TWO_FACTOR_REQUIRED` (y el flujo con TOTP → 2xx). La spec ya lo prohíbe («un admin de agencia
autenticado y sin segundo factor activado … THEN 403», delta `auth-access:37-40`): es fix de código
y de test, sin tocar la spec.

---

## 3. V1 y V2 por HTTP propio

### V1 — TOTP y auditoría en rutas admin de Better Auth: 🟡 (a medias, ver B3)

| Caso | Resultado |
|---|---|
| Super admin sin TOTP → `admin/set-role`, `ban-user`, `revoke-user-session`, `create-user` (cuerpo válido y vacío) | ✅ 403 `TWO_FACTOR_REQUIRED` en los 5 |
| Owner sin TOTP **con org activa** → escrituras `/organization/*` | ✅ 403 (cubierto por e2e) |
| Owner sin TOTP **sin org activa** + `organizationId` en body | ❌ 200 (B3) |
| Owner con TOTP → `invite-member` | ✅ 200 + fila en `audit_logs` con tenant de la agencia, actor owner, entidad invitation |
| Super admin con TOTP → `set-role` (y reversión), `ban-user`, `unban-user` | ✅ 200 + filas de plataforma (`tenant_id` NULL, actor super admin) |

Nota de ruta: el plugin admin expone `/admin/set-role` (no existe `set-user-role`); la tabla
`BETTER_AUTH_ADMIN_ROUTES` del código coincide.

### V2 — Revocación de sesión: 🟢

Primera pasada mía con error de método (que dejó un falso FAIL y conviene documentar como
aprendizaje): la cookie de sesión de Better Auth lleva el valor **firmado** (`token.firma`,
`setSignedCookie`, `cookies/index.mjs:174`), no el token crudo de la BD. Al pasar el valor firmado,
`revoke-user-session` responde **200 sin hacer nada** (better-auth no encuentra la fila y
`deleteWithHooks` salta el delete en silencio, `with-hooks.mjs:137`), sin fila de auditoría (el
before-hook tampoco encuentra la sesión). Repetido con el **token crudo** de la BD (como hace el
e2e):

| Prueba | Resultado |
|---|---|
| `revoke-user-session` con token crudo, super admin con TOTP | ✅ 200 |
| Sesión de la víctima en la BD | ✅ borrada |
| Siguiente solicitud de la víctima (cookie firmada) a ruta protegida | ✅ 401 |
| Fila en `audit_logs` | ✅ `tenant_id` NULL, actor super admin, entidad `session`, `after = {userId}`, entidad = id de la sesión revocada |

El e2e `auth.e2e.ts:203-246` cubre exactamente este flujo y pasa. El test de inventario
`two-factor.e2e.ts:82` sí recorre también las rutas de Better Auth (`listBetterAuthRoutes`) además
de las de Nest — verificado en el código.

---

## 4. Cobertura de escenarios GIVEN/WHEN/THEN

### Base `auth-access` (8 escenarios)

| Escenario | Test | Estado |
|---|---|---|
| Ruta protegida sin sesión | `auth.e2e.ts` «GET /api/v1/bookings/:id sin cookie responde 401», «PUT /api/v1/products/:id sin cookie responde 401» | 🟢 |
| Catálogo público | `auth.e2e.ts` «GET /api/v1/products sin sesión responde 200» | 🟢 |
| Proveedor edita su producto | `auth.e2e.ts` «proveedor edita su producto: 200 (permiso product:update; propiedad en F1)» | 🟢 |
| Proveedor edita producto de otro proveedor | — | 🟡 aplazado justificado: la propiedad de producto llega con specs/catalog (F1); el propio test lo documenta |
| Cliente ve solo sus reservas | — | 🟡 aplazado justificado: reservas llegan en F1 (stub `TODO(F1)` en `bookings.controller.ts:11`) |
| Admin de otra agencia | `tenant.e2e.ts` «una fila de B por id es invisible para la agencia A (404…)» + `auth.e2e.ts` «una sesión no accede a la organización de otra agencia» | 🟢 |
| Admin sin TOTP | `two-factor.e2e.ts` «admin sin TOTP recibe 403 TWO_FACTOR_REQUIRED…» + pantallas de activación (T-F0-10) | 🔴 afectado por B3: sin org activa el admin sin TOTP sí puede escribir en `/organization/*` |
| Revocar sesión | `auth.e2e.ts` «super admin revoca la sesión de un usuario: 200, fila de plataforma y 401 a la víctima» + verificación HTTP propia (§3) | 🟢 |

### Base `audit` (3 escenarios)

| Escenario | Test | Estado |
|---|---|---|
| Admin aprueba un pago | Patrón probado con el endpoint de ejemplo (T-F0-9): `audit.e2e.ts` «deja fila con actor, accion, antes, despues, IP y fecha de la sesion» y «si la escritura de auditoria falla, la operacion no se confirma» | 🟡 aplazado justificado: el pago real llega en F2; el patrón (transacción compartida, antes/después) está en verde |
| Intento de borrado | `audit.e2e.ts` «caribe_app: INSERT y SELECT permitidos; UPDATE y DELETE rechazados» + trigger con GRANT transitorio + como dueño | 🟢 |
| Agente consulta auditoría | `audit.e2e.ts` «agente consulta auditoria -> 403» | 🟢 |

### Delta `auth-access` (6 escenarios)

| Escenario | Test | Estado |
|---|---|---|
| Admin sin TOTP | `two-factor.e2e.ts` «admin sin TOTP recibe 403 TWO_FACTOR_REQUIRED en un endpoint administrativo»; pantalla en web/admin | 🟢 |
| Admin sin TOTP en un endpoint no administrativo | `two-factor.e2e.ts` «admin sin TOTP en un endpoint no administrativo responde 2xx» | 🟢 |
| **Admin sin TOTP en una ruta administrativa de Better Auth** | `two-factor.e2e.ts` inventarios Nest y Better Auth + «super_admin sin TOTP… rutas admin de Better Auth» | 🔴 incumplido en el estado por defecto de sesión (B3); el test existe pero solo cubre el caso con organización activa |
| Usuario sin rol administrativo en una ruta administrativa de Better Auth | `two-factor.e2e.ts` «rol no administrativo… recibe el 403 normal» | 🟢 |
| Activación de TOTP accesible | `two-factor.e2e.ts` «la activacion queda accesible y tras verificar el TOTP el endpoint responde 2xx» + HTTP propio (enable/verify 2xx) | 🟢 |
| Ruta administrativa sin exigencia de segundo factor (inventario) | `two-factor.e2e.ts` «inventario Nest…» y «inventario Better Auth…» (partición completa de `/admin`, `/organization`, `/two-factor`) | 🟢 (el inventario llama con org activa y cuerpo vacío: no cubre el vector de B3) |

### Delta `audit` (8 escenarios)

| Escenario | Test | Estado |
|---|---|---|
| Super Admin crea una agencia | `audit.e2e.ts` «crea la agencia y audita con tenant_id NULL; actor/IP/fecha de la sesion, no del body» (+ 403 sin rol, 400 body inválido) | 🟢 |
| Agencia no lee auditoría de plataforma | `audit.e2e.ts` «admin de agencia solo recibe las filas de su agencia (nunca las de plataforma)» + RLS como `caribe_app` | 🟢 |
| Super Admin consulta la auditoría | `audit.e2e.ts` «super admin recibe las filas de plataforma y las de todas las agencias» (×2) | 🟢 |
| Admin de agencia solo lee su agencia | `audit.e2e.ts` «admin de agencia solo recibe las filas de su agencia…» | 🟢 |
| Owner invita a un miembro | `audit.e2e.ts` «owner invita a un miembro y la escritura deja fila con su agencia como tenant» + fila verificada por SQL en mi corrida | 🟢 |
| Super Admin revoca una sesión | `auth.e2e.ts` + fila verificada por SQL en mi corrida | 🟢 |
| Admin aprueba un pago (MODIFIED) | Igual que el escenario base: patrón con endpoint de ejemplo | 🟡 aplazado justificado (F2) |
| Escritura de Better Auth deja fila tras confirmarse | `audit.e2e.ts` «owner invita…», «POST /admin/organizations deja las mismas filas que auth.api.createOrganization» + filas propias | 🟢 |

### Delta `payments` (6 escenarios: Modo AUTO, MANUAL aprobado, MANUAL rechazado, Aprobar sin permiso, Revisor distinto, Agencia de una sola persona)

🟡 **Aplazado justificado**: la change declara pagos fuera de alcance («Catálogo, reservas, pagos y
tasas (F1 y F2)», `proposal.md:44-45`); el delta es spec-only (documenta la matriz T-F0-6 para F2)
y no hay implementación que probar. La 1ª verificación ya lo clasificó así.

**Resumen: 31 escenarios → 19 🟢 · 10 🟡 aplazados justificados · 2 🔴 (el mismo defecto B3 visto
en la spec base y en la delta).**

---

## 5. Tareas de `tasks.md` contra el código

| Tarea | Evidencia | Estado |
|---|---|---|
| T-F0-0a/0b | Deltas de spec (commits `d8e33c7`…) | ✅ |
| T-F0-1 | Monorepo pnpm + Turborepo, 4 paquetes `@caribe/*` | ✅ |
| T-F0-2 | `compose.yaml` (postgres 17 + redis 7), `.env.example` completo | ✅ |
| T-F0-3 | `.github/workflows/ci.yml`: install, lint, typecheck, test, check-specs (replicado en verde, §1) | ✅ |
| T-F0-4 | 8 tablas de Better Auth, 4 migraciones versionadas, `migrate diff` limpio | ✅ |
| T-F0-5 | Better Auth + guard global + stubs products/bookings (`TODO(F1)`) | ✅ |
| T-F0-6 / T-F0-6b | Matriz en `access.ts` + tests; seed idempotente (`seed.e2e.ts`) | ✅ |
| T-F0-7 | TenantModule, `SET LOCAL app.tenant_id`, RLS (políticas fail-closed, probadas como `caribe_app`) | ✅ |
| T-F0-8 | Guard TOTP + inventario de rutas | ✅ con la salvedad B3 |
| T-F0-9 | `audit_logs` inmutable (REVOKE + trigger) + interceptor con endpoint de ejemplo | ✅ |
| T-F0-10 | `next-intl` es/en, shells con login y pantalla de activación; tests web/admin/shared | ✅ |
| T-F0-11 | 6 SVG + `README.md` en `docs/wireframes/` | ✅ |
| T-F0-12 | Abierto a propósito — esta verificación es esa tarea | ⬜ |
| T-F0-13 | Hooks before/after en `auth.ts` + deltas aprobadas antes; **incompleto frente al estado por defecto** (B3) | 🟡 |
| T-F0-14 | E2e de revocación (commit `c0cb9a8`) + verificado por HTTP propio | ✅ |

Sin funciones fuera de alcance detectadas (los stubs products/bookings y el override de tasas están
marcados `TODO(F1)`/`TODO(F2)`).

## 6. Reglas fijas

| Regla | Estado |
|---|---|
| Dinero `DECIMAL` | N/A en F0: el schema no tiene campos monetarios (los pagos llegan en F2); el delta `payments` es spec-only. Sin `float` para dinero en el código |
| `tenant_id` + RLS | ✅ `audit_logs` con `tenant_id` + políticas fail-closed (`FORCE ROW LEVEL SECURITY`, `current_setting(..., true)`); probado como `caribe_app` (NOBYPASSRLS) en `tenant.e2e.ts` y `audit.e2e.ts` |
| `.env` no versionado ni leído | ✅ (§1); los scripts de verificación usaron variables de entorno de dev, nunca imprimieron `.env` |
| Nombre «Caribe» | ✅ `caribe` / `@caribe/*` / compose `caribe`; sin restos del nombre viejo (los únicos matches de «ota» son palabras españolas —«nota», «rota»— y la sigla genérica «la OTA» en un comentario de `apps/web/page.tsx:21`) |

## 7. Hallazgos menores

- **M1 (ya registrado, re-confirmado):** `trustedProxies` sin configurar. El log del server muestra
  el warning de Better Auth («Rate limiting could not determine a client IP…»), y en mis filas HTTP
  con NODE_ENV sin fijar la auditoría registró IP vacía (la lib solo rellena 127.0.0.1 en
  dev/test). Deuda de hosting, `tasks.md:49-50`.
- **M2 (ya registrado):** sin Helmet/CSP/CORS hasta F5. `tasks.md:51`.
- **M3 (nuevo, informativo):** `revoke-user-session` de better-auth responde `200 {success:true}`
  aunque el token no coincida con ninguna sesión (no-op silencioso). La app se comporta bien (no
  audita lo que no ocurrió), pero conviene documentar el contrato: el panel debe pasar el **token
  crudo** que devuelve `list-user-sessions`, nunca el valor de la cookie (firmado). Un token de
  cookie pasado por error «revoca» nada sin ningún aviso.
- **M4 (nuevo, documentación):** `proposal.md` («Impacto en specs») no menciona el delta de
  `payments` que la change sí incluye (commit `121417b`, spec-only). No bloquea, pero el archivo y
  la propuesta quedan desalineados.
- **Nota:** `docs/plans/security-f0.md` está sin trackear (revisión de seguridad de otro agente, no
  de esta verificación; no lo toqué). Su veredicto «F0 puede archivarse» y su §2 («2FA en rutas
  administrativas — fix V1 vigente») quedan desactualizados por B3: esa revisión fue estática y no
  probó el estado sin organización activa.

## 8. Efectos colaterales sobre la BD dev local

- **Restaurado:** `owner@caribe-demo` y `superadmin@caribe-demo` quedaron con TOTP activado y
  secreto perdido tras mis pasadas HTTP (enable/verify); se les restauró el estado del seed
  (`twoFactorEnabled = false`, fila de `twoFactor` borrada). `admin@caribe-demo` conservó el TOTP
  que ya tenía antes de esta verificación.
- **Datos de prueba remanentes** (igual que deja cualquier corrida del e2e): usuarios throwaway
  (`*-v3-*`, `*-v4-*@example.com`), invitaciones pending, un `admin-v4-*` con rol `super_admin`
  (mismo patrón que los `super-rev-*` del e2e), filas de `audit_logs` de las acciones verificadas y
  un ban/unban de usuario throwaway. Todo en la BD de desarrollo local; sin impacto en el repo.

## 9. Veredicto

**No archivar `f0-foundations` todavía.** El pipeline está en verde, V2 está corregido y verificado,
y 19 escenarios están en verde; pero **B3** incumple la delta `auth-access` («Admin sin TOTP en una
ruta administrativa de Better Auth») en el estado por defecto de sesión y abre a cualquier
owner/admin sin segundo factor las escrituras administrativas de su agencia por
`/api/auth/organization/*`. Pasos:

1. Fix de B3 en `isAdminLevelSession`/hook `before` (criterio: organización afectada por la
   escritura, el mismo con el que autoriza la lib) — sin cambio de spec: ya está prohibida.
2. E2e del caso que falta: admin sin TOTP, sin `set-active`, `organizationId` en el body → 403
   `TWO_FACTOR_REQUIRED`; y con TOTP → 2xx.
3. Re-verificar en conversación limpia (T-F0-12) y entonces archivar.

Commits del fix anterior confirmados en la historia: `d8e33c7` (deltas), `7767397` (hooks),
`c0cb9a8` (preestado revoke), `b51717e` (e2e), `c520ca7` (informe 1).

## 10. Corrección (2026-11-11)

Fix de B3, M3 y M4 aplicado después de este informe, con tests primero y un commit por problema.
Sin cambio de esquema ni dependencias nuevas; `f0-foundations` sigue sin archivar (`T-F0-12`
pendiente: la re-verificación en conversación limpia).

| Commit | Tipo | Qué cierra |
|---|---|---|
| `20925b5` | `docs(spec)` | Deltas de `auth-access` (clasificación por la organización objetivo, 5 escenarios) y `audit` (atribución por la entidad afectada, 2 escenarios sin organización activa). |
| `6ab9432` | `fix(auth)` | **B3** (T-F0-15): capa de autorización por ruta, resolución de la organización objetivo y falla cerrada; auditoría imputada a la agencia objetivo o a la entidad devuelta. 5 e2e nuevos + inventario ampliado. |
| `73bf5fb` | `test(auth)` | **M3** (T-F0-16): documenta el 200 sin efecto de `revoke-user-session` en la regla de auditoría y lo cubre con un e2e. |
| `239201d` | `docs(spec)` | **M4** (T-F0-17): `proposal.md` declara el delta de `payments`. |

- **B3 resuelto en el criterio que pedía el informe:** la organización objetivo es
  `body.organizationId || query.organizationId ||` la activa, y el rol se evalúa en ESA agencia
  (`isAdminLevelSession(session, targetOrganizationId?)`). Sin objetivo determinable la sesión falla
  cerrada: un rol de plataforma o un owner/admin en cualquier agencia recibe 403
  `TWO_FACTOR_REQUIRED`; un rol no administrativo en todas pasa a Better Auth (400/403 normal).
  La tabla `BETTER_AUTH_ADMIN_ROUTES` declara ahora `authorization: "platform" | "organization"` y
  el inventario e2e verifica que no contradice la familia ni `audit.platform`.
- **Escenarios del informe cubiertos por HTTP, sin organización activa:** (a) owner sin TOTP con
  `organizationId` en el cuerpo → 403 `TWO_FACTOR_REQUIRED` y sin fila de invitación; (b) el mismo
  flujo con TOTP → 2xx y fila de `audit_logs` en la agencia; (c) sin `organizationId` → falla
  cerrada (owner) y 403 normal de la lib para el agente no administrativo; (d) owner de A con
  `organizationId` de B → denegado; (e) `/organization/list` sigue accesible. El inventario recorre
  además las dos pasadas (cuerpo con `organizationId` y cuerpo vacío) sobre todas las rutas
  administrativas.
- **M3 documentado y probado:** `revoke-user-session` responde 200 aunque el token no corresponda a
  ninguna sesión; el e2e verifica el 200, la sesión del actor intacta y la ausencia de fila.
- **Nota de `security-f0.md`:** se le añadió una cabecera de obsoleto fechada (revisión estática
  anterior a B3); no se modifica el resto del informe ni se archiva.
- **M1/M2:** sin cambios; siguen como deuda registrada en `tasks.md`.

### Pipeline tras el fix (sin caché)

| Paso | Resultado |
|---|---|
| `pnpm lint --force` | ✅ 4 tareas (shared, api, web, admin) |
| `pnpm typecheck --force` | ✅ 5 tareas (incluye el build de shared) |
| `pnpm test --force` | ✅ **171 tests** — api 101 · shared 44 · web 13 · admin 13 |
| `node scripts/check-specs.mjs` | ✅ 8 specs válidas |

En la API: 11 archivos / 101 tests; `two-factor.e2e.ts` 15, `auth.e2e.ts` 13, `audit.e2e.ts` 16.
Sigue pendiente el paso 3 del veredicto: re-verificar en conversación limpia (T-F0-12) y entonces
archivar.
