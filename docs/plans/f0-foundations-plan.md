# Plan: f0-foundations

Fecha: 2026-11-09 · Estado: esperando respuestas del dueño · Fase F0 del ROADMAP.

## 1. Contexto leído

AGENTS.md, docs/workflow.md, docs/constitution.md, docs/context.md, docs/definition-of-done.md,
openspec/ROADMAP.md, docs/sdd/SDD.md (§4–§10 y §13 sobre todo), openspec/specs/auth-access/spec.md,
openspec/specs/audit/spec.md, change completa (proposal, design, tasks), scripts/check-specs.mjs
(verde: 8 specs válidas), comandos `/next-task` y `/verify`, skills `write-spec` y `conventional-commits`.

La change ya tiene proposal, design y tasks: este documento no los reemplaza; los revisa, fija
supuestos y lista lo que falta por decidir.

## 2. Supuestos que aplicaré (avísame si cambias alguno)

| # | Tema | Supuesto |
| --- | --- | --- |
| S1 | Versiones | Node 24 LTS, pnpm 10, Turborepo 2, TypeScript 5 estricto. Versiones exactas fijadas en `package.json` al hacer scaffold (última estable de cada una en ese momento). |
| S2 | Test runner | **Vitest en todo el monorepo** (api, web, admin, shared). Un solo runner, arranque rápido, funciona con `@nestjs/testing`. Cobertura con `@vitest/coverage-v8`. Si prefieres Jest en la API, decidirlo antes de T-F0-1. |
| S3 | Config compartida | Además de `packages/shared`, creo `packages/eslint-config` y `packages/tsconfig` (patrón estándar de monorepo; solo dev-tooling). Se justifica en `design.md` de la change. |
| S4 | Puertos locales | web 3000, admin 3001, api 3002. Rewrites de Next `/api/*` → `http://localhost:3002` (variable `API_URL` en el servidor). |
| S5 | RLS + Prisma | Prisma no aplica RLS solo. Patrón: rol de BD restringido para la app (sujeto a políticas) + rol de migraciones; `TenantModule` hace `SET LOCAL app.tenant_id` dentro de transacciones interactivas (`prisma.$transaction`). En F0 solo `audit_logs` (única tabla de negocio); las tablas de Better Auth quedan sin RLS porque se consultan fuera de contexto de tenant. |
| S6 | Endpoints mínimos para probar la spec | `auth-access` exige "Ruta protegida sin sesión" y "Catálogo público", pero productos/reservas existen en F1. Crearé en T-F0-5 endpoints mínimos: `GET /api/v1/products` (público, `[]`) y `GET /api/v1/bookings/:id` (protegido → 401). F1 los reemplaza por la implementación real; los tests no se reescriben. |
| S7 | Seed | `pnpm seed` (solo dev) con la agencia demo y un usuario por rol. No está en tasks.md → pido aprobación para añadirlo como tarea pequeña junto a T-F0-6 (ver §3.B6). |
| S8 | CI | GitHub Actions con contenedores postgres:17-alpine y redis:7-alpine como servicios. Asumo remote en GitHub aunque hoy no hay `origin` configurado. |
| S9 | TOTP en dos capas | "Admin sin TOTP" se cumple en UI (redirect de apps/admin a la pantalla de activación) **y** en API (guard: endpoints de admin devuelven 403 `TWO_FACTOR_REQUIRED`). Ver §3.B1: esto puede requerir un delta en la spec. |
| S10 | Docker Compose | `postgres:17-alpine`, `redis:7-alpine`, volúmenes locales, healthchecks. Sin contenedores de las apps (corren con `pnpm dev`). |

## 3. Preguntas antes de arrancar

### A. No bloquean F0 (de proposal.md)
1. Hosting definitivo de API y BD (¿Render/Railway/Fly + Neon/Supabase?) — afecta env vars y, si quieres, un job de deploy en CI.
2. Verificación del registro en Duffel/LiteAPI desde Venezuela — sin acción en F0; lo dejo anotado.
3. Horas semanales y fecha objetivo — sin esto no estimo duraciones de fase.

### B. Bloquean detalles de implementación
1. **"Admin sin TOTP" (auth-access):** la spec dice "solo puede acceder a la pantalla de activación".
   ¿Es restricción solo UI o también API? Mi propuesta (S9): ambas capas. Si la apruebas, primero un
   delta `MODIFIED` del requisito de 2FA en la spec (regla: spec antes que código).
2. **`audit_logs.tenant_id`:** ¿qué pasa con acciones a nivel de plataforma (Super Admin sin agencia,
   p. ej. crear tenants)? Propuesta: `tenant_id` NULL = acción de plataforma; el panel consulta solo
   su tenant. Requiere caso límite nuevo en la spec `audit`.
3. **Endpoints mínimos (S6):** ¿apruebas crear stubs `products`/`bookings` en F0 para poder probar la
   spec ya en T-F0-5, o prefieres rutas sintéticas de prueba? Alternativa: posponer esos escenarios a F1.
4. **Matriz rol × permisos (T-F0-6):** redactaré recursos/acciones (`product`, `booking`, `payment`,
   `exchange-rate`, `report`, `audit`) y la matriz rol × recurso en `design.md`. ¿Quieres revisarla tú
   antes de que haga el commit de T-F0-6?
5. **Wireframes (T-F0-11):** ¿los genero yo en baja fidelidad (SVG estático, versionable en git, en
   `docs/wireframes/`, 14 pantallas de SDD §9) o los harás tú? ¿Otro formato (HTML, imágenes)?
6. **Seed (S7):** ¿añado tarea `T-F0-6b` para el script de seed demo, o lo dejo fuera y las pruebas
   crean sus propios datos?

## 4. Reglas de specs que creo incompletas

1. `auth-access`: no dice si al banear (`banned`) un usuario se revocan sus sesiones activas o solo
   se le bloquea el próximo login.
2. `auth-access`: "límite de intentos" sin número (¿dejamos los defaults de Better Auth y lo
   documentamos, o la spec fija cifras?).
3. No existe spec para la convención de errores (Problem Details RFC 9457 + códigos estables) que el
   SDD §7 exige. ¿Spec nueva (p. ej. `api-errors`) en F1 o delta de cada spec afectada?
4. `audit`: no define retención (ya está fuera de alcance, OK) ni si los jobs de fondo pueden escribir
   auditoría o solo el interceptor HTTP.
5. `tasks.md` de F0: las tareas de infraestructura (T-F0-1 a T-F0-4, T-F0-10, T-F0-11) no llevan
   "Prueba: spec › escenario" porque no hay escenario de spec que las cubra (las valida el pipeline en
   verde). Las dejo como están salvo que quieras anotarles "Prueba: pipeline en verde".

## 5. Desglose de ejecución (una tarea = un commit)

| Tarea | Entregable | Prueba |
| --- | --- | --- |
| T-F0-1 | Monorepo pnpm+Turborepo, 4 apps, TS estricto, ESLint+Prettier compartidos | `pnpm lint`/`typecheck`/`test` en verde (pipeline) |
| T-F0-2 | `docker-compose.yml` + `.env.example` | `docker compose up` sano; `pnpm dev` conecta |
| T-F0-3 | Workflow GitHub Actions | CI en verde en el remote |
| T-F0-4 | Prisma + tablas Better Auth (CLI de Better Auth + `prisma migrate dev`) | migración aplicada; test smoke de esquema |
| T-F0-5 | Better Auth en NestJS (`@thallesp/nestjs-better-auth`), plugins Organization/Admin/TwoFactor, guard global, decorador `@Public` | auth-access › "Ruta protegida sin sesión", "Catálogo público" (con stubs S6) |
| T-F0-6 | Roles/permisos + guards por permiso + matriz en design.md (+ seed si apruebas B6) | auth-access › escenarios Proveedor y Cliente |
| T-F0-7 | `TenantModule`, `SET LOCAL app.tenant_id`, RLS en `audit_logs` | auth-access › "Admin de otra agencia" (2 tenants) |
| T-F0-8 | TOTP obligatorio admin/owner/super_admin + pantalla activación | auth-access › "Admin sin TOTP" |
| T-F0-9 | `audit_logs` inmutable (permisos BD rol app) + interceptor con endpoint ejemplo | audit › "Intento de borrado", "Admin aprueba un pago" (acción de ejemplo) |
| T-F0-10 | `next-intl` es/en con rutas `/es` `/en`, shell con login en ambas apps | smoke de rutas y textos en es/en |
| T-F0-11 | Wireframes SDD §9 en `docs/wireframes/` | revisión visual (formato según B5) |
| T-F0-12 | `node scripts/check-specs.mjs` + DoD + informe | verificación en sesión limpia |

Nota T-F0-4/T-F0-7: si aplico RLS a una tabla de Better Auth por error, rompo su funcionamiento;
me limito a tablas de negocio y lo documento.

## 6. Riesgos conocidos

- `@thallesp/nestjs-better-auth` es comunitaria; si no funciona con la versión actual de Better Auth,
  aplico el respaldo ya previsto en `design.md` (montar el handler oficial) y te aviso antes de seguir.
- RLS exige conectarse con rol no-dueño; en CI el job de Postgres debe crear ese rol (lo incluyo en
  la migración/setup de CI, no a mano).
- La prueba de "Admin aprueba un pago" usa una acción de ejemplo (los pagos llegan en F1): el
  interceptor y la inmutabilidad quedan probados; la acción real se re-prueba en F2.

## 7. Qué necesito del dueño

1. Respuestas a §3.B (con A cuando quieras; no bloquean).
2. Confirmación de los supuestos de §2 o correcciones.
3. Visto bueno para arrancar T-F0-1.
