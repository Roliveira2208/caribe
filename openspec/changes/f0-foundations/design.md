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

