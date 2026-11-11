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

## Decisiones técnicas de T-F0-4 (Prisma + tablas de Better Auth)
- **Prisma fijado a la línea 7** (`prisma`/`@prisma/client`/`@prisma/adapter-pg` en 7.10.1, pines
  exactos): el `latest` de npm resuelve al RC de Prisma 8 y Better Auth aún no soporta la 8 (issue
  #9636 de su repositorio). Igual criterio que con TypeScript y typescript-eslint.
- **better-auth no se instala aquí** (llega en T-F0-5); cuando toque se fija a 1.7.18 (la 1.7.19
  salió el mismo día y cae fuera de la política de `minimumReleaseAge`).
- **Esquema generado con el CLI oficial** `@better-auth/cli@1.4.21 generate` con el adaptador de
  Prisma y los plugins organization, admin y twoFactor: 8 tablas (user, session, account,
  verification, organization, member, invitation, twoFactor) con sus índices y FKs en cascada.
  No se edita a mano: se regenera y el diff se valida con `prisma migrate dev`.
- **Cliente generado en `apps/api/src/generated/prisma`** (generador `prisma-client`,
  `moduleFormat = "cjs"`), fuera de git; lo produce `prisma generate` en el `postinstall` del
  paquete (también `pnpm db:generate`). El cliente importa con extensión `.ts`, por eso
  `apps/api/tsconfig.json` activa `rewriteRelativeImportExtensions` (reescritura a `.js` al emitir).
- **URL del datasource en `prisma7.config.ts`** (formato de Prisma 7, ya no en `schema.prisma`):
  carga el `.env` del paquete y luego el del monorepo, sin sobrescribir variables existentes.
- **Migraciones SQL versionadas** con `prisma migrate dev` (nunca `db push`): una para las tablas de
  Better Auth y otra aparte para el rol. El esquema de RLS/tenant de negocio llega en F0 posteriores.
- **Rol de BD restringido `caribe_app`**, en migración propia: LOGIN sin contraseña (se asigna fuera de
  bandas con `ALTER ROLE` leyendo una variable de entorno; jamás en el repo), `NOBYPASSRLS`, sin
  SUPERUSER/CREATEDB/CREATEROLE, DML básico (SELECT/INSERT/UPDATE/DELETE) sobre las tablas y
  USAGE/SELECT en secuencias, `ALTER DEFAULT PRIVILEGES` para tablas futuras y `REVOKE` total sobre
  `_prisma_migrations`. Las tablas son propiedad del rol de migraciones: así RLS siempre aplica a la
  aplicación. T-F0-6 recortará `audit_logs` a INSERT/SELECT para este rol (auditoría inmutable).
- **Dependencias añadidas** (todas del stack del SDD salvo una): `@prisma/client`,
  `@prisma/adapter-pg`, `pg` 8.23.1 (driver nativo que exige el adapter de Prisma 7 y que permitirá
  `SET LOCAL app.tenant_id` por transacción), `prisma` y `@types/pg` como devDeps. La única fuera del
  SDD es `dotenv` 18.0.9 (devDep): la requiere `prisma7.config.ts` para cargar el `.env`; la 18.0.10
  salió el mismo día y cae fuera de la política de pnpm.
- **pnpm 12:** los scripts de instalación de `prisma` y `@prisma/engines` se aprueban en
  `pnpm-workspace.yaml`. pnpm 12.18 usa el formato `allowBuilds` (mapa) en vez de
  `onlyBuiltDependencies` (lista) y su `approve-builds` reescribió el yaml perdiendo la aprobación de
  `esbuild`; se restauró en el formato nuevo para que la CI no falle en un install limpio.
- **Comandos raíz nuevos:** `pnpm db:generate`, `pnpm db:migrate:dev`, `pnpm db:migrate:deploy`.

## Decisiones técnicas de T-F0-5 (Better Auth en NestJS)
- **Dependencias (pines exactos):** Nest 12.3.3 (`@nestjs/common`, `@nestjs/core`,
  `@nestjs/platform-express`) — la 12.4 salió el mismo día y cae fuera de la política de
  `minimumReleaseAge` de pnpm —, `@thallesp/nestjs-better-auth` 2.8.0, `better-auth` 1.7.18, `rxjs`
  7.8.2 y `reflect-metadata` 0.2.2. Los peers graphql/websockets/express de la lib comunitaria son
  opcionales y no se instalan. `dotenv` pasa de devDep a dependency (lo lee `src/env.ts` en runtime).
- **Versión del esquema verificada:** la sonda que generó `schema.prisma` con el CLI corría
  `better-auth@1.7.18`, la misma versión instalada; el CLI solo carga esa instancia para derivar las
  tablas. Además se comparó `getAuthTables` del paquete instalado contra la instancia real: los 8
  modelos y sus campos coinciden con `schema.prisma`. No hacía falta regenerar.
- **Guard global y rutas públicas:** `AuthModule.forRoot({ auth })` monta el handler de Better Auth en
  `/api/auth` (fuera del versionado, D15) y su `AuthGuard` global deniega por defecto; solo
  `GET /api/v1/products` se marca `@AllowAnonymous`. `bodyParser: false` porque Better Auth lee el
  cuerpo crudo; la lib re-agrega los parsers para el resto de las rutas.
- **Cookies y secreto:** httpOnly + SameSite=Lax por defecto de Better Auth; `advanced.useSecureCookies`
  solo con `NODE_ENV=production` (prefijo `__Secure-`). El secreto solo llega por `BETTER_AUTH_SECRET`.
- **Rate limit:** activo siempre (por defecto solo en producción) con `customRules` más estrictas en
  `/sign-in/email` (60 s/10), `/sign-up/email` (60 s/5) y `/forget-password` (60 s/5); las rutas son
  relativas al basePath de Better Auth. La IP del cliente: en desarrollo/test resuelve `127.0.0.1`;
  en producción, tras decidir el hosting (pregunta abierta), hay que fijar
  `advanced.ipAddress.trustedProxies` para leer `x-forwarded-for` de forma segura — sin proxies
  configurados solo acepta un valor único, no falseable, y sin IP cae a un bucket compartido por ruta
  con un warning en el log (falla cerrado, no abierto).
- **`admin()` con defaults** (rol de sistema `admin`, alta como `user` = Cliente de la spec): 1.7.18
  valida `adminRoles` contra el access control de `roles`; la matriz real llega en T-F0-6.
- **Nest 12** ya no exporta `INestApplication` desde su índice; `bootstrap.ts` exporta
  `type ApiApplication = Awaited<ReturnType<typeof createApp>>` para `main.ts` y los tests.
- **Tests:** `vitest.config.mts` con include de `*.test.ts` y `*.e2e.ts` y defaults de env hacia la BD
  local. El e2e monta la app real (`createApp`) en puerto aleatorio y crea datos con sufijos únicos en
  vez de limpiar; cubre 401 sin sesión, catálogo público 200 y 403 al leer la organización de otra
  agencia (`get-full-organization`).
- **Build:** `tsconfig.build.json` emite a `dist` con `paths` vacío (`@caribe/shared` se resuelve por
  node_modules hacia su dist, que turbo construye antes con `^build`). Scripts `build` y `start` en
  `apps/api`.
- **Contraseña de `caribe_app`:** variable `CARIBE_APP_DB_PASSWORD` en `.env` (sin valor en `.env.example`) y
  script local `scripts/set-caribe-app-password.mjs` (`pnpm db:app-password`): ejecuta `ALTER ROLE`
  dentro del contenedor y verifica el login por scram desde el host; nunca imprime el valor.
- **CI:** `pnpm test` ahora incluye e2e que necesitan las tablas; el workflow aplica las migraciones
  (`pnpm db:migrate:deploy`) antes de los tests sobre el servicio de PostgreSQL.

## Decisiones técnicas de T-F0-6 (roles y permisos)

- **Un solo archivo de access control** (`apps/api/src/access.ts`): define el universo de recursos y
  acciones y, a partir de él, los roles de las dos capas. TypeScript solo acepta acciones del universo
  al declarar un rol; `test/access.test.ts` recorre cada celda del universo contra cada rol y falla ante
  cualquier concesión o denegación fuera de la matriz aprobada.
- **Diferencia entre capas (verificada contra better-auth 1.7.18):** el mapa de `roles` de `admin()`
  REEMPLAZA sus defaults (el rol de sistema `admin` que trae todo dejó de existir; quedan `user` y
  `super_admin`); el de `organization()` SE MEZCLA con los defaults (por eso `member` se redefine con
  permisos vacíos: una membresía sin rol conocido no concede nada).
- **Guards sin dependencias nuevas:** `@MemberHasPermission` (agencia, `member.role`), `@UserHasPermission`
  (sistema, `user.role`), `@Roles`, `@OrgRoles` y `@RequireActiveOrg` de `@thallesp/nestjs-better-auth`
  2.8.0, ya instalado. Ningún rol hereda del otro y las capas no se cruzan: un permiso declarado en una
  no autoriza en la otra.
- **Alta de agencias solo como acción de sistema** (`allowUserToCreateOrganization: false`): sin sesión
  y con `userId` en el body es la única vía que queda (verificado en `crud-org.mjs` de 1.7.18:
  `isSystemAction = !session && ctx.body.userId`). El e2e la usa y el seed de T-F0-6b la usará; el
  endpoint del panel llega con su propia change.

### Matriz aprobada (2026-11-10)

**Negocio** (agencia: `member.role`; plataforma: `user.role`):

| Recurso | `agent` | `provider` | `owner`/`admin` | `super_admin` | Cliente |
|---|---|---|---|---|---|
| product | — | create, read, update, delete (solo suyos, F1) | create, read, update, delete | read | catálogo público |
| booking | create, read | read (solo de sus productos, F1) | create, read, update, cancel | read | sesión + propiedad (404 ajena) |
| payment | read | — | read, **review** | read | sesión + propiedad |
| exchange-rate | — | — | read, **update** (override con motivo) | read | tasa actual pública |
| report | — | — | read | read | — |
| audit | — | — | read (su tenant) | read (plataforma + tenants) | — |

- `review` = aprobar/rechazar; revisor siempre distinto de quien reportó (delta de payments en esta
  change). super_admin es de solo lectura en negocio: nadie más que owner/admin revisa pagos.
- `exchange-rate` update = ajuste manual solo owner/admin, con motivo obligatorio y auditoría
  (spec `exchange-rates`); el invariante "nadie aprueba su propio pago" y el alcance de auditoría de
  super_admin quedaron como deltas de `payments` y `audit` en esta change.
- audit: nadie tiene update/delete; la BD limitará `audit_logs` a INSERT/SELECT para `caribe_app` (T-F0-9).

**Gestión de la agencia** (organization, `member.role`):

| Recurso | `owner` | `admin` | `agent` | `provider` | `member` |
|---|---|---|---|---|---|
| organization | update, **delete** | update | — | — | — |
| member | create, update, delete | create, update, delete | — | — | — |
| invitation | create, cancel | create, cancel | — | — | — |
| team / ac (roles dinámicos) | — | — | — | — | — |

**Plataforma** (`super_admin`, `user.role`): organization create/read/update (sin delete físico: se
desactiva), user create/list/get/update/set-role/ban/set-password, session list/revoke. **Sin
impersonate ni delete de usuarios** (tampoco set-email/set-phone): son acciones que los endpoints de
Better Auth exigen pero que ningún rol declara, así que quedan denegados para todos por siempre. Cliente (`user` de
sistema): statements vacíos; su acceso a reservas/pagos/documentos es por sesión + propiedad de fila
(404 si ajeno), sin RBAC. Provider no reserva ni paga: denegación por rol en la capa de servicio
(cuando lleguen esas rutas en F1/F2, sus specs fijan el mapeo fino).

### Pruebas de T-F0-6

- **Unitarias** (`test/access.test.ts`): las 7 filas de la matriz (user, super_admin, owner, admin,
  agent, provider, member neutralizado) contra cada celda del universo de permisos.
- **E2E** (`test/auth.e2e.ts`): stub `PUT /api/v1/products/:id` con `@MemberHasPermission` → provider
  200, agent 403, cliente 403, sin sesión 401; invitaciones reales → owner 200, provider 403; un
  usuario no crea agencias por HTTP (403) ni accede a `GET /api/auth/admin/list-users` (403). La
  propiedad de fila (producto ajeno, reserva ajena) llega con datos reales en F1 (T-F1-7).
- El alta de usuarios del e2e va por la API de servidor (`auth.api.signUpEmail`): el HTTP de registro
  limita a 5/min por IP y crear datos no es el comportamiento bajo prueba; el inicio de sesión sí va
  por HTTP para ejercitar la cookie real (9 inicios, bajo el límite de 10/min).

## Decisiones técnicas de T-F0-6b (seed de demostración)

- **Lógica y CLI separados:** `src/seed.ts` exporta `seedDemo()` (datos fijos, sin consola ni procesos)
  y `src/seed-main.ts` es solo la entrada que imprime el resumen. `test/seed.e2e.ts` importa `seedDemo`
  y prueba la idempotencia sin depender del CLI.
- **Vías de alta idénticas a las del sistema:** usuarios por `auth.api.signUpEmail` (API de servidor),
  agencia como acción de sistema (`auth.api.createOrganization` con `userId`, sin sesión) y membresías
  directas por Prisma generando `id`/`createdAt` a mano (el modelo no tiene defaults de BD; Better
  Auth los genera en la capa de aplicación). El rol `super_admin` se fija por update directo: no hay
  endpoint de servidor para cambiar roles.
- **Idempotencia por búsqueda previa** de cada entidad (email, slug, par organization+user), no por
  "limpiar y recrear": el e2e corre el seed dos veces y exige que la segunda sea un no-op completo y
  que usuarios y membresías conserven sus ids. No asume una BD limpia: si los datos ya existen de una
  corrida anterior, completa lo que falte.
- **Alcance:** solo identidad (una agencia, owner/admin/agent/provider como miembros, cliente y
  super_admin sueltos). El "inventario básico" de la tarea no puede existir aún: F0 no tiene tablas de
  catálogo (fuera de alcance de la change) y se añadirá al seed cuando llegue specs/catalog en F1.
  Decisión del dueño del 2026-11-10, anotada como pregunta abierta en la propuesta.
- **Contraseña fija de demostración** (`DEMO_PASSWORD`, exportada y documentada en el propio archivo):
  dato público de la BD local de desarrollo, no un secreto de entorno; la BD de demostración no es de
  producción y el seed no debe correrse allí. Los datos fijos usan `caribe-demo.example.com`, dominio
  reservado para documentación, para no chocar con correos reales.
- **Ejecución:** `pnpm db:seed` = `turbo run build --filter=@caribe/api` + `node dist/seed-main.js`
  (mismo vehículo que `pnpm start`, dist/). Necesita el entorno de la API (`DATABASE_URL`,
  `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`) porque importa `auth.ts`: las credenciales solo se crean
  por las vías del sistema, nunca con INSERT a mano de cuentas.

## Decisiones técnicas de T-F0-7 (TenantModule, SET LOCAL y RLS)

- **`audit_logs` nace aquí y no en T-F0-9** (decisión del dueño, 2026-11-10): era la única tabla con
  `tenant_id` dentro del alcance de la change y las políticas RLS necesitaban una tabla real que
  filtrar. T-F0-9 queda con la inmutabilidad (INSERT/SELECT para `caribe_app`), el interceptor de
  auditoría y el endpoint de ejemplo. El catálogo (F1) y las reservas heredarán el mismo patrón.
- **Modelo Prisma `AuditLog` sin relaciones** a `User`/`Organization` a propósito: la historia de
  auditoría sobrevive al borrado de agencias y usuarios (dueño disuelve la agencia ↔ audit inmutable),
  y tocar los modelos generados por el CLI de Better Auth los haría perder campos en la próxima
  regeneración. `tenant_id`/`actor_id` los fija la capa de aplicación desde la sesión verificada.
- **Políticas RLS** (migración `20261110061923_audit_logs_tenant_rls`, SQL propio): `audit_logs_tenant`
  compara `tenant_id = current_setting('app.tenant_id', true)` en USING y WITH CHECK (ni leer ni
  escribir fuera del tenant); `audit_logs_platform` exige `app.platform = 'on'` (Super Admin sin
  agencia activa: filas de todas las agencias y las de plataforma con `tenant_id` NULL). Sin GUC
  fijado, `current_setting(..., true)` devuelve NULL y ninguna política otorga filas: **fallo
  cerrado**. `FORCE ROW LEVEL SECURITY` extiende las políticas también al rol dueño por si una
  conexión no superusuario llegara a usarlo.
- **`TenantService`** (`src/tenant/`): la resolución es una función pura (`tenant-context.ts`) sobre
  la organización activa y el rol de sistema — la org activa gana al rol de plataforma; Cliente sin
  membresía queda en "none" y RLS no le otorga nada. `withTenant`/`withPlatform` ejecutan dentro de
  una transacción interactiva de Prisma con `set_config(..., true)` (equivalente a `SET LOCAL`, pero
  parametrizable: `SET` no acepta bind parameters); `withContext` despacha según el contexto y
  rechaza "none" con 403. Todo acceso a datos con `tenant_id` de la app pasa por este módulo.
- **Migración creada a mano y aplicada con `migrate deploy`:** `migrate dev` no puede reproducir en
  su shadow database la migración del rol restringido (el `REVOKE` sobre `_prisma_migrations`, que
  allí no existe; preexistente de T-F0-4). El CREATE TABLE replica lo que generaría el CLI y se
  verificó con `prisma migrate diff --from-config-datasource --to-schema`: diff vacío. Pregunta
  abierta en la propuesta.
- **Pruebas de RLS como el rol real, sin secretos:** `tenant.e2e.ts` monta dos agencias y filas por
  tenant/plataforma, y consulta con `SET ROLE caribe_app` (NOBYPASSRLS, no dueño: las políticas siempre
  aplican) sobre la conexión de `DATABASE_URL` — funciona igual en local (`caribe_dev`) y CI
  (`caribe_ci`), ambas superusuario, sin contraseñas en el repo. Cubre: lectura filtrada por tenant,
  fila ajena por id invisible (el 404 de la capa de servicio traduce ese vacío), lectura de
  plataforma, fallo cerrado sin contexto, y WITH CHECK (no escribir filas de otro tenant, sí las
  propias y las de plataforma con `tenant_id` NULL). El escenario HTTP literal ("producto de otra
  agencia → 404") llega con el catálogo en F1, igual que la propiedad de fila quedó anotada en
  T-F0-6; `database.test.ts` valida además el SQL de la migración (RLS+FORCE, políticas con GUC y
  fallo cerrado, WITH CHECK en ambas).

## Decisiones técnicas de T-F0-8 (segundo factor en la API)

- **Subclase del `AuthGuard` de la lib:** `AdminTwoFactorGuard` extiende el `AuthGuard` exportado por
  `@thallesp/nestjs-better-auth` (constructor público `(reflector, options)`); el `app.module`
  registra la lib con `disableGlobalAuthGuard: true` y `AdminModule` provee la subclase como único
  guard global (`APP_GUARD`). Sesión, permisos y rutas públicas siguen siendo los de la lib, con el
  check de TOTP añadido; `super()` recibe el mismo singleton `auth` del módulo.
- **El check de 2FA corre antes que `super.canActivate`** (deliberado): un rol administrativo sin TOTP
  recibe siempre 403 `TWO_FACTOR_REQUIRED`, aunque además le falte el permiso de la ruta (p. ej. un
  `super_admin` sin `exchange-rate:update`), para que la UI pueda llevarlo a la pantalla de
  activación y no a un 403 opaco. Sin sesión responde 401 el `AuthGuard`; los roles no
  administrativos reciben su 403 normal; la activación vive en `/api/auth/*` (middleware de Better
  Auth, sin guards de Nest) y queda accesible.
- **Clasificación de ruta administrativa como función pura** (`src/admin/admin-route.ts`), compartida
  por el guard y los tests: prefijo `/admin`, permiso exclusivo de owner/admin/super_admin — calculado
  desde la matriz de `access.ts`, no a mano, para que un cambio de matriz recalibre qué rutas exigen
  TOTP — o rol administrativo exigido con `@Roles`/`@OrgRoles` (más estricto que la spec, nunca
  menos). `admin-route.test.ts` fija esos exclusivos contra la matriz aprobada en T-F0-6.
- **Claves de metadata de la lib duplicadas en `AUTH_METADATA_KEYS`** (`ROLES`, `ORG_ROLES`,
  `USER_HAS_PERMISSION`, `MEMBER_HAS_PERMISSION`): la lib no las exporta. Si una versión futura las
  cambia, el guard dejaría de verlas y el inventario e2e falla: esa es la red de seguridad.
- **Rol del miembro activo por Prisma** (`member.findFirst({ userId, organizationId })`): Better Auth
  1.7.18 no expone `getActiveMemberRole`/`getActiveMember` (la lib cae en undefined). La organización
  activa la verificó Better Auth al fijarla.
- **Stub `PUT /api/v1/admin/exchange-rates/override`** (SDD, tabla de endpoints, permiso
  `exchange-rate:update`): endpoint real bajo `/admin` para ejercitar el guard; specs/payments (F2)
  lo sustituye (TODO(F2)).
- **Tests sin dependencias nuevas:** el TOTP se calcula a mano en `test/auth-helpers.ts` (RFC 6238,
  HMAC-SHA-1 + base32 con `node:crypto`); los helpers de alta de usuarios/agencias se movieron ahí
  desde `auth.e2e.ts` para compartirlos. `verify-totp` rota la sesión (crea una nueva y fija cookie
  nueva): el e2e se queda con la cookie de la respuesta.
- **Pruebas (`test/two-factor.e2e.ts`):** inventario de rutas registradas (DiscoveryService +
  metadata de Nest, clasificadas con la misma función del guard) llamadas por HTTP con un admin sin
  TOTP: toda administrativa debe responder 403 `TWO_FACTOR_REQUIRED`; además cubre admin sin TOTP en
  endpoint no administrativo → 2xx, rol no administrativo → 403 normal (sin el código), super_admin
  sin TOTP, 401 sin sesión y el flujo completo enable → verify-totp → 2xx.
- **Pantalla de activación:** se construye en T-F0-10 junto al shell con login, que redirige ante el
  403 `TWO_FACTOR_REQUIRED` (decisión del dueño del 2026-11-10, anotada en `proposal.md`).

## Decisiones técnicas de T-F0-9 (auditoría inmutable + AuditModule)

- **Inmutabilidad en dos capas (migración `audit_logs_immutable`):** `REVOKE UPDATE, DELETE ON
  audit_logs FROM caribe_app` (al rol de aplicación solo le quedan INSERT y SELECT, como pide el
  SDD) **y** un trigger `BEFORE UPDATE OR DELETE` que lanza excepción para cualquier rol. El REVOKE
  quita el privilegio; el trigger es defensa en profundidad: aunque un rol con privilegios (o el
  dueño de la tabla) intente modificar, la BD lo rechaza. `TRUNCATE` no se bloquea: `caribe_app`
  nunca lo recibió por GRANT y la spec solo nombra UPDATE/DELETE.
- **El interceptor es dueño de la transacción (spec audit, casos límite):** `AuditInterceptor`
  (APP_INTERCEPTOR del `AuditModule`) abre `prisma.$transaction`, ejecuta el handler DENTRO con un
  `AsyncLocalStorage` (`attachAuditData`/`currentAuditTx`) y escribe la fila de auditoría en esa
  MISMA transacción al final: si la auditoría falla, la operación se revierte. Solo actúa en rutas
  con `@Auditable({ action, entity, platform? })`; el resto pasa de largo.
- **Actor, IP y fecha nunca del body:** el interceptor los toma de la sesión verificada
  (`request.session.user.id`, fijada por el guard), de `request.ip` y del reloj del servidor. El
  handler solo aporta `entityId`/`before`/`after` vía `attachAuditData`; si un handler auditable no
  aporta `entityId`, el interceptor falla (fallo cerrado) y la transacción no se confirma.
- **Contexto de tenant reutilizado:** para fijar los GUC en la transacción del interceptor,
  `TenantService` gana `bindContext(tx, context)` y `withTenant`/`withPlatform`/`withContext`
  delegan en él (misma lógica, sin duplicar). Las acciones `platform: true` (crear agencia) auditan
  con `tenant_id` NULL bajo `app.platform`; las de agencia exigen contexto tenant (403 si no).
- **Alcance de lectura (`GET /admin/audit-logs`) resuelto en el handler:** la lib AND-evalúa
  `@UserHasPermission` y `@MemberHasPermission` (verificado en su código), así que "owner/admin de
  agencia **o** super_admin" no es expresable con decoradores. El handler resuelve: rol de
  plataforma → contexto plataforma (filas NULL + todas las agencias, delta de audit); si no,
  miembro owner/admin de la org activa → contexto tenant; cualquier otro caso → 403. Los roles con
  `audit:read` de agencia se calculan desde la matriz de `access.ts` (hoy owner y admin) y un test
  fija esa correspondencia. Además del RLS, la consulta de agencia lleva `where tenant_id`:
  defensa en profundidad (en pruebas la API conecta como superusuario de PostgreSQL, a quien RLS
  no aplica; con el rol de aplicación ambas capas coinciden).
- **Endpoints de ejemplo:** `PUT /admin/exchange-rates/override` (stub existente, acción
  `exchange-rate.override`, "fijar tasas" está en la lista de la spec; `before` NULL porque F0 no
  tiene tabla de tasas — F2 la sustituye con estado real) y `POST /admin/organizations` (acción real
  de plataforma `organization.create`, delta "Super Admin crea una agencia": replica los INSERT de
  `createOrganization` de Better Auth —organization + member owner— dentro de la transacción del
  interceptor, precedente del seed; el creador queda owner, validación manual de name/slug sin zod).
- **Sanitizador (`sanitizeAuditPayload`):** denylist por clave normalizada (minúsculas, sin
  separadores: password, token, secret, cvv, cvc, card, cardnumber, …) aplicada recursivamente a
  `before`/`after` dentro de `AuditService.record`; los valores sensibles se sustituyen por
  `[redacted]`. Redactar de más es seguro; redactar de menos es un fuga. `AuditService.record`
  nunca abre su propia transacción: recibe la del llamador.
- **Pruebas:** `test/audit-sanitize.test.ts` (unitario), `test/audit.e2e.ts` (HTTP: acción de
  agencia con TOTP → fila con actor/acción/antes/después/IP; agente → 403; admin de agencia solo ve
  su tenant y nunca filas NULL; super admin crea agencia → fila NULL + spoof de actor/ip/at en el
  body ignorado; super admin ve NULL + ambas agencias; integración: si `record` falla dentro de la
  transacción, la operación no se confirma) y bloque de BD con `SET ROLE caribe_app`
  (INSERT/SELECT ok; UPDATE/DELETE rechazados; el trigger también rechaza al dueño). Reforzadas
  en el commit aparte posterior (ver «Refuerzo de T-F0-9»).

## Fix de infraestructura: shadow database de prisma migrate (2026-11-10)

Fix pedido por el dueño tras aprobar T-F0-8, fuera de `tasks.md` (no cambia comportamiento
especificado). Cierra la pregunta abierta de la propuesta sobre `migrate dev`.

- **Causa (P3006):** la migración del rol restringido ejecutaba `REVOKE ALL PRIVILEGES ON TABLE
  "_prisma_migrations" FROM caribe_app`, y en la shadow database esa tabla no existe durante el
  replay (Prisma aplica los SQL de las migraciones sin registrarlas allí). `migrate dev`/`migrate
  diff` replayean TODAS las migraciones en una BD vacía: cualquier SQL no ejecutable desde cero
  rompe el flujo para siempre. `caribe_dev` ya tenía CREATEDB (es el `POSTGRES_USER` del compose,
  superusuario): el problema nunca fue de permisos, por eso las opciones CREATEDB/shadowDatabaseUrl
  no bastaban solas.
- **Fix:** el REVOKE queda condicionado a la existencia de la tabla (DO block con
  `information_schema.tables`). En la BD real aplica exactamente igual (la tabla existe allí) y
  en la shadow es un no-op. De las opciones de la pregunta abierta, la elegida fue «arreglar la
  migración del rol aceptando el re-baseline local».
- **Re-baseline local:** editar una migración ya aplicada cambia su checksum (SHA-256 del archivo);
  `migrate deploy`/`status` fallan con P3007 hasta actualizarlo. Se recalculó a mano en la BD local
  (una sola vez; la CI y los futuros entornos aplican migraciones desde cero y no lo notan):
  `UPDATE _prisma_migrations SET checksum = '<sha256>' WHERE migration_name = '...'` para
  `20261110022152_restricted_app_role` y `20261110061923_audit_logs_tenant_rls` (la segunda solo
  cambió su comentario de cabecera, que describía el problema como vigente).
- **Shadow en Prisma 7:** `datasource.shadowDatabaseUrl` vive en `prisma7.config.ts` y lee
  `SHADOW_DATABASE_URL` (opcional; documentada en `.env.example` con la BD local `caribe_shadow`,
  creada una vez — el CLI la resetea en cada uso, nunca apunta a la BD de desarrollo). `migrate
  diff --from-migrations` la exige siempre; `migrate dev` solo la necesita cuando debe generar o
  comparar migraciones (si no está, `caribe_dev` puede auto-crearla al ser superusuario).
- **Comprobación de divergencia en CI:** nuevo step que crea `caribe_ci_shadow` y corre
  `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma
  --exit-code` (en Prisma 7: exit 0 = sin diferencia, 2 = divergen, 1 = error; el step falla en
  ambos casos no cero). Cualquier cambio de schema sin su migración (o migración que no refleje el
  schema) rompe la CI antes de aplicar nada.
- **Verificado:** `migrate diff` → «No difference detected» (exit 0); `migrate status` → «Database
  schema is up to date»; `migrate dev` → «Already in sync» sin tocar la BD local (conteos de
  `audit_logs`/`user`/`organization` intactos antes y después).

## Refuerzo de T-F0-9: pruebas como caribe_app y notas para F1/F2 (2026-11-10)

Commit aparte pedido por el dueño tras aprobar T-F0-9, fuera de `tasks.md`. No cambia
comportamiento especificado: refuerza pruebas y deja anotadas dos decisiones para F1/F2.

- **Las pruebas de BD ejecutan como el rol real de la aplicación.** Todo lo que `caribe_app`
  (NOBYPASSRLS, sin contraseña en el repositorio) puede ejercitar se prueba con `SET ROLE
  caribe_app`; una prueba fija la precondición en `pg_roles` (ni superusuario ni `BYPASSRLS`)
  para que, si alguien alterara el rol, el patrón deje de pasar en vez de dejar de probar RLS.
  El montaje y la verificación de datos por Prisma siguen siendo del dueño: montar filas de
  cualquier tenant lo exige. Como el REVOKE detiene a `caribe_app` con `permission denied`
  antes de que corra el trigger, la capa del trigger se prueba con un GRANT transitorio (abajo)
  y, en su variante «incluso el dueño», como dueño de la tabla.
- **RLS aísla por sí sola (sin `where tenant_id`).** Prueba nueva en `tenant.e2e.ts`: como
  `caribe_app` con contexto de la agencia A, `SELECT tenant_id FROM audit_logs` sin ningún
  predicado devuelve solo filas de A. El `where tenant_id` de los handlers es defensa en
  profundidad, no sustituto de la política.
- **El trigger, también como `caribe_app` (GRANT transitorio).** Para ejercitar la segunda capa
  con el rol real, el test le devuelve UPDATE/DELETE con un `GRANT` que vive solo dentro de la
  transacción de la prueba (deshecho por ROLLBACK y verificado después con
  `has_table_privilege`): modela el mal otorgamiento accidental que el trigger tiene que seguir
  bloqueando. El caso «incluso el dueño» se prueba como dueño de la tabla, el único rol con
  privilegios estables.
- **Divergencia con Better Auth.** `POST /admin/organizations` replica a mano los INSERT de
  `createOrganization`; un test crea una agencia por cada vía (mismo creador) y compara las
  filas de `organization` y `member` en forma: columnas pobladas (`logo`/`metadata` NULL),
  `createdAt` fecha, rol owner, un solo miembro. Si una actualización de better-auth cambia lo
  que escribe la lib (nuevas columnas, otro `creatorRole`, filas extra), el test rompe y toca
  alinear el endpoint.
- **Nota para F1/F2: sanitizador por allowlist en acciones críticas.** La denylist de T-F0-9
  (redactar de más es seguro) vale para acciones genéricas, pero las acciones críticas de F1/F2
  (pagos, reservas, tasas) deben construir su payload de auditoría por allowlist: solo entran
  en `before`/`after` las claves que la acción declara explícitamente; cualquier clave fuera de
  la lista no se registra.
- **Nota para F1/F2: la transacción de auditoría no abarca llamadas a proveedores externos.**
  Los handlers de F1/F2 que llamen a proveedores externos (Duffel, LiteAPI, DolarAPI, SMTP) no
  pueden mantener abierta la transacción del `AuditInterceptor` durante esas llamadas: una
  transacción larga con I/O externo acapara conexiones y locks del pool. La operación se
  confirma con sus efectos locales y su auditoría en una transacción; la interacción con el
  proveedor se audita en su propia fila/transacción cuando la llamada vuelve.

## Decisiones técnicas de T-F0-10 (next-intl, shells de web/admin y pantalla TOTP)

- **Dependencias nuevas, todas del stack del SDD:** `next` 16.4.6 + `react`/`react-dom` 19.3.1 en
  ambas apps y `next-intl` 4.14.10 (es/en con prefijo de locale). En web, además: `react-qr-code`
  2.2.0 (QR de la activación TOTP: renderiza SVG, sin canvas ni APIs de navegador), Tailwind 4
  (`tailwindcss` + `@tailwindcss/postcss` 4.3.5) y los cuatro paquetes que exige el patrón
  shadcn/ui para button/input/label/card montados a mano (`@radix-ui/react-slot`,
  `class-variance-authority`, `clsx`, `tailwind-merge`); los componentes se copiaron a mano en
  vez de usar el CLI para no arrastrar dependencias sin usar. En admin: `antd` 6.7.0 y
  `@ant-design/nextjs-registry` 1.3.0 (extrae los estilos cssinjs de antd durante el SSR; es
  named export en esta versión). Pines exactos, misma política que TypeScript/Prisma/better-auth.
- **Sin cliente JS de better-auth en los frontends:** las llamadas van con `fetch` crudo al
  mismo origen (los rewrites de `next.config` las llevan a la API), para no sumar dependencias y
  para que los tests de shared controlen la red con un `fetch` inyectable. El contrato vive en
  `packages/shared`: `auth-api.ts` (constantes `AUTH_BASE_PATH`/`TWO_FACTOR_REQUIRED`, tipos de
  respuesta, `twoFactorScreenMode`, `parseOtpauthUri`, `safeLocalizedRedirectPath`) y
  `auth-client.ts` (wrappers `signInEmail`/`signOut`/`getSession`/`enableTwoFactor`/`verifyTotp`/
  `generateBackupCodes`). `TWO_FACTOR_REQUIRED` se define una sola vez, en shared, y el guard del
  API lo importa desde ahí (antes lo duplicaba).
- **Contrato observado de Better Auth 1.7.18 (verificado e2e por el proxy de admin):** login sin
  TOTP crea sesión normal; con TOTP activo responde 200 con `twoFactorRedirect: true` y
  `twoFactorMethods: ["totp"]`, borra las cookies de sesión (`Max-Age=0`) y deja solo
  `better-auth.two_factor` (HttpOnly, `Max-Age=600`). `two-factor/enable` exige sesión y
  contraseña y devuelve `{method, totpURI, backupCodes:10}` — los códigos de recuperación
  viajan en claro solo en esa respuesta. `two-factor/verify-totp` sirve tanto para completar la
  activación como para el login pendiente (en ambos rota la sesión y fija cookie nueva).
- **Pantalla TOTP con dos modos (`twoFactorScreenMode`):** sin sesión → verificación (login
  pendiente por la cookie `two_factor`); sesión sin TOTP → activación (contraseña → QR + clave
  manual → código → códigos de recuperación con copiar/regenerar); sesión con TOTP → redirect al
  destino. El secreto y los códigos se muestran en pantalla y jamás se escriben en logs ni URLs:
  no hay `console.*` en `src` de ninguna app y se revisaron los logs de los tres servers tras la
  verificación e2e.
- **`redirectTo` validado en servidor:** las páginas de login y two-factor pasan el query param
  por `safeLocalizedRedirectPath` antes de entregárselo al componente (path interno localizado o
  fallback a portada/panel), para que un `redirectTo` externo no sobreviva al render server-side.
  La navegación programática usa `useRouter` de next/navigation y los enlaces internos el `Link`
  de next-intl (preserva el locale).
- **Next 16 + next-intl:** middleware en `src/proxy.ts` (`middleware.ts` está deprecado en 16);
  `createMiddleware` default de next-intl ya excluye `/api` del matcher; `getRequestConfig` con
  fallback a es; `hasLocale` + `NextIntlClientProvider` en los layouts; `generateStaticParams`
  por locale (SSG de `/es` y `/en`). Cada página declara `generateMetadata` con canonical +
  hreflang es/en + x-default (`alternateLinks` sobre `WEB_URL`/`ADMIN_URL`). Un locale
  desconocido se redirige bajo el locale por defecto (`/fr` → `/es/fr`) y cae al catch-all
  `[...rest]` → 404 localizado (comportamiento de next-intl con `localePrefix: "always"`).
- **Imports relativos siempre sin extensión:** Turbopack no resuelve especificadores `.js` a
  archivos `.ts/.tsx` (tsc sí). Por eso `src` de web/admin y de shared usan imports
  extensionless; las apps consumen shared por `paths` → `src` con `moduleResolution: "Bundler"`.
  shared compila bajo `NodeNext` sin `"type": "module"` (CJS), donde los extensionless son
  válidos; la API (`Node10`) resuelve la dependencia construida vía workspace.
- **antd solo en admin, Tailwind solo en web** (regla del AGENTS.md raíz): admin no tiene Tailwind
  (estilos inline mínimos fuera de antd) y antd vive solo en archivos "use client"; `AntRegistry`
  + `ConfigProvider` con `antd/locale/es_ES`/`en_US` fijan el idioma de antd al locale activo.
  antd 6 deprecó `Alert message` en favor de `title` (corregido en los tres componentes que lo
  usan; sin advertencias en dev).
- **Textos por i18n sin cadenas fijas:** namespaces nav/metadata/login/twoFactor/notFound
  (mismas claves en web y admin) + `home` (web) / `panel` (admin). Tests de mensajes en cada app:
  extraen namespaces y claves de `useTranslations`/`getTranslations` + llamadas `t("...")`
  literales por regex y exigen que toda clave usada exista y que es/en tengan paridad exacta.
- **`next-env.d.ts` commiteado y fuera de prettier:** el typecheck funciona sin `.next` porque el
  archivo está commiteado (verificado en ambas apps moviendo `.next` fuera). `.prettierignore` lo
  excluye (lo genera Next). Igual tratamiento para los `AGENTS.md` de `apps/web` y `apps/admin`:
  los escribe `next dev` (puntero de 9 líneas a los docs de Next 16) y commitearlos mantiene el
  árbol limpio.
- **turbo.json:** `build.outputs` pasa a `["dist/**", ".next/**", "!.next/cache/**"]` para que el
  caché de Turborepo registre los artefactos de Next (evita los warnings de "no output files
  found" que salían con solo `dist/**`).

### Decisión para F1: organización activa por sesión

Las sesiones de Better Auth nacen **sin organización activa** (el plugin Organization no la
auto-fija); hoy solo se fija con `POST /api/auth/organization/set-active`, como hacen los tests
en `auth-helpers.ts`. El panel de auditoría exige agencia activa (o rol de plataforma), así que
en la verificación e2e un admin recién logueado recibe 403 «La auditoría requiere una agencia
activa o el rol de plataforma» hasta llamar a set-active con su agencia.

Decisión del dueño (2026-11-10), a implementar en F1: al iniciar sesión se auto-selecciona la
organización cuando el usuario tiene una sola membresía; si tiene varias, se muestra un selector
antes de entrar al panel. El endpoint set-active de Better Auth ya existe; falta la UX del login.
No tocó F0 porque es comportamiento de producto del panel, no del shell.

## CI: build del monorepo y rama del push (2026-11-10)

Cambio pedido por el dueño tras aprobar T-F0-10, fuera de `tasks.md`:

- **`pnpm build` entra a la CI** después de typecheck y tests: valida el bundling completo
  (dist de shared y de la API; las dos apps de Next con Turbopack y SSG de `/es` y `/en`). No
  necesita BD ni secretos — `WEB_URL`/`ADMIN_URL` tienen defaults locales — y corre después de
  los tests, antes de la validación de specs.
- **El trigger de push apuntaba a `master` y la rama es `main`:** CI nunca había corrido en un
  push (solo en PR y dispatch manual). Corregido a `branches: [main]`; junto con el paso de
  build, el push que revisa el dueño en la pestaña Actions por fin ejecuta la verificación
  completa.

## Fix de la verificación f0-foundations: TOTP y auditoría en rutas de Better Auth (2026-11-10)

Fix de los bloqueantes V1/V2 del informe de verificación (`docs/plans/verify-f0-foundations.md`),
aplicado tras la primera verificación. Deltas de spec primero (`d8e33c7`), luego el código
(`7767397` + `c0cb9a8`); tareas T-F0-13/T-F0-14. Sin dependencias nuevas.

- **Por qué hooks y no guards de Nest:** `@thallesp/nestjs-better-auth` monta el handler de
  Better Auth como middleware crudo del adaptador HTTP, que corre antes del pipeline de Nest;
  ni `AdminTwoFactorGuard` ni el `AuditInterceptor` alcanzan `/api/auth/*`. Los
  `hooks.before`/`after` de la propia instancia de Better Auth son el único punto que ve esas
  rutas.
- **before: mismo contrato que el guard de Nest** (delta de auth-access): en las rutas de la
  tabla, un rol administrativo sin TOTP recibe 403 `TWO_FACTOR_REQUIRED` ANTES de validar el
  cuerpo y los permisos, para que la UI lo lleve a la activación y no a un 403 opaco (mismo
  orden deliberado que el guard). Sin sesión HTTP pasa de largo (acción de sistema: seed,
  `auth.api`); los roles no administrativos reciben su 403 normal de permisos de la lib.
  `isAdminLevelSession` (nuevo `src/admin/admin-session.ts`) la comparten guard y hooks, para
  que ambas familias clasifiquen igual a un mismo usuario.
- **Clasificación cerrada en `BETTER_AUTH_ADMIN_ROUTES`** (`src/admin/admin-route.ts`): las 15
  rutas `/admin/*` del plugin admin y las 7 escrituras administrativas de `/organization/*`
  (create queda clasificada pero sin auditoría: con `allowUserToCreateOrganization: false` una
  sesión de usuario nunca llega a escribir), cada una con su regla de auditoría (acción con
  prefijo `auth.`, entidad, plataforma/agencia, extracción de `entityId` y `after`); la
  allowlist `BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS` (15) completa la partición de
  `/organization/*`. La lista es cerrada a propósito: si better-auth añade o renombra rutas,
  el inventario e2e falla hasta que alguien las reclasifique conscientemente (misma filosofía
  que `AUTH_METADATA_KEYS`).
- **after: auditoría en transacción propia.** El middleware no puede unirse a la transacción
  interna de la lib, así que la fila se escribe tras confirmarse la escritura, en su propia
  transacción con el GUC RLS de la acción (plataforma → `tenant_id` NULL; agencia →
  `app.tenant_id` de la organización afectada). Solo audita escrituras 2xx (los `APIError`
  llegan al hook como instancia de `Error`; `ctx.context.returned` es JSON plano porque el
  dispatch de la lib fuerza `asResponse: false` y asigna el resultado antes de correr los after
  hooks) y solo con sesión (las acciones de sistema por `auth.api` las audita su llamador, si
  le toca). Si la fila falla, la acción ya está confirmada: queda en el log y la respuesta
  pasa. `before` queda NULL porque el middleware solo observa el resultado (lo declara el delta
  de audit).
- **revoke-user-session conserva el antes en el before:** la fila de `session` se borra al
  ejecutar la acción, así que el hook `before` stashea `{ sessionId, userId }` en un `WeakMap`
  por `ctx.context` (el dispatch conserva la referencia entre before y after, verificado en
  su código) y la regla lo usa como `entityId` y para el `after` (solo el dueño). Las props de
  `BetterAuthPreState` son obligatorias a propósito: la primera versión guardaba la fila de
  Prisma con `id` mientras la regla leía `sessionId`, y las props opcionales escondieron el
  desalineo de typecheck; lo cazó el e2e de T-F0-14 y el fix lo hace imposible en tipo
  (`c0cb9a8`).
- **Pruebas:** inventario e2e de las dos familias (las rutas registradas por la lib se particionan
  completa entre administrativas y allowlist) con admin sin TOTP; negativos por rol; fila de
  `auth.organization.invite-member` (audit); "owner invita a un proveedor" pasa a owner con
  TOTP (auth-access); y el e2e de V2: revocación → 200 + fila de plataforma + 401 a la víctima
  con la cookie revocada. La víctima inicia sesión por `auth.api` (acción de sistema) para no
  sumar al rate limit HTTP de `/sign-in/email`: el archivo va justo en 10 por ventana de 60s.




