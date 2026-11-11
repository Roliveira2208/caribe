# Caribe — contexto del proyecto para agentes

MVP de portafolio de una agencia de viajes en línea (OTA) para Venezuela. Un solo desarrollador.
Fuente de verdad del diseño: `docs/sdd/SDD.md` (Software Design Document). Fuente de verdad del
comportamiento: `openspec/specs/`. Si el código contradice una spec, el código está mal.

## Stack (decidido en el SDD, no lo cambies sin una propuesta)
- Monorepo pnpm + Turborepo: `apps/web` (Next.js, shadcn/ui, Tailwind, PWA), `apps/admin` (Next.js, Ant Design),
  `apps/api` (NestJS, monolito modular), `packages/shared` (tipos y esquemas Zod).
- PostgreSQL + Prisma, Redis + BullMQ, Better Auth (plugins Organization, Admin, Two-Factor).
- Idiomas: es (por defecto) y en, con `next-intl`.

## Comandos (ajusta aquí cuando existan)
- `pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e`
- `pnpm db:up` · `pnpm db:down` (PostgreSQL y Redis locales vía Docker Compose)
- `pnpm db:generate` · `pnpm db:migrate:dev` · `pnpm db:migrate:deploy` (Prisma en `apps/api`;
  migraciones SQL versionadas, nunca `db push`)
- `pnpm db:app-password` (contraseña local del rol `caribe_app`: lee `CARIBE_APP_DB_PASSWORD` de `.env`)
- `pnpm db:seed` (datos de demostración: una agencia y un usuario por rol; idempotente, necesita el
  mismo entorno de la API: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`)
- Antes de dar algo por terminado: lint + typecheck + test en verde.

## Reglas que no se negocian
1. **Dinero:** `DECIMAL` en base de datos, nunca `float`. Montos 14,2; tasas 18,4. Los montos y la tasa se
   calculan siempre en el servidor; nunca se confía en un monto enviado por el cliente.
2. **Tenant:** toda tabla de negocio lleva `tenant_id` con Row-Level Security. Cada agencia es una
   organización de Better Auth.
3. **Reservas:** el cupo se bloquea en una transacción con `SELECT ... FOR UPDATE`. Cero sobreventa.
4. **Tasa:** cada pago guarda `exchange_rate_id` y `amount_ves`; ese par no se recalcula después.
5. **Proveedores externos** (Duffel, LiteAPI, DolarAPI, SMTP) solo entran por las interfaces
   `InventoryProvider`, `ExchangeRateProvider`, `PaymentProvider`, `InvoiceProvider`, `NotificationProvider`.
6. **Comprobantes:** siempre con la leyenda "Documento no fiscal". No se emiten facturas fiscales.
7. **Secretos** solo en variables de entorno. Nunca leas ni imprimas `.env`; mantén `.env.example` al día.
8. **Auditoría:** acciones sobre pagos, tasas, reservas y roles escriben en `audit_logs` (inmutable).
9. Textos visibles al usuario en JSONB `es`/`en`; nada de cadenas fijas en componentes.

## Cómo trabajamos (Spec Driven Development)
Detalle en `docs/workflow.md`. Resumen:
- Una **change** = una carpeta en `openspec/changes/<nombre>/` con `proposal.md`, `design.md`, `tasks.md` y
  specs delta en `specs/<dominio>/spec.md`.
- Orden: especificar → planificar → implementar → verificar. No escribas código de una funcionalidad
  sin spec; no escribas spec para cambios triviales (errata, subir versión, renombrar).
- Trabaja **una tarea de `tasks.md` a la vez**, marca `[x]` al terminar y haz un commit por tarea.
- Si la spec es ambigua o contradice el SDD, **detente y pregunta**; no rellenes huecos con suposiciones.
- Si descubres algo que la spec no cubre, anótalo en la propuesta como pregunta abierta; no lo inventes.
- Para cambiar un comportamiento: edita primero la spec (delta), luego el código.

## Definición de terminado
- Cada escenario GIVEN/WHEN/THEN de la spec tiene un test (unitario, de integración o e2e).
- lint, typecheck y tests en verde; sin `any` nuevos ni `@ts-ignore` sin justificar.
- Cambios de esquema con migración Prisma; RLS y pruebas de aislamiento entre tenants si hay tabla nueva.
- Textos nuevos en es y en; accesibilidad básica (teclado, etiquetas) en pantallas nuevas.
- Commit en formato Conventional Commits (skill `conventional-commits`).

## Qué NO hacer
- No borres archivos ni ramas, no uses `git push --force` ni `rm -rf` sin pedirlo.
- No añadas dependencias sin justificarlo en `design.md`.
- No mezcles Ant Design en `apps/web` ni shadcn/ui en `apps/admin`.
- No guardes número de tarjeta ni CVV. Los pagos son simulados en el MVP.
- No cambies decisiones D1–D15 del SDD; propón un cambio en `openspec/changes/`.
- No uses `pnpm approve-builds` sin revisar `pnpm-workspace.yaml` después: pnpm 12 lo reescribe al
  formato `allowBuilds` y puede perder aprobaciones previas (ya perdimos la de `esbuild`); revísalo
  también tras `pnpm add` o `pnpm install`.
- No habilites ningún plugin de Better Auth ni autenticación por token (API key, bearer, SSO, OAuth)
  sin una change propia que actualice la clasificación de rutas, el inventario y la política para
  rutas sin sesión.
