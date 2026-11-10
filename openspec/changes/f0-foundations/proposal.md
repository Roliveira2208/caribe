# Change: f0-foundations

## Por qué
Sin repositorio, CI, identidad y aislamiento por tenant no se puede verificar nada de lo demás.
Implementa SDD §4 (arquitectura), §10 (seguridad) y la fase F0 de §13.

## Qué cambia
- Monorepo pnpm + Turborepo con `apps/web`, `apps/admin`, `apps/api`, `packages/shared`.
- CI (lint, typecheck, test, `node scripts/check-specs.mjs`).
- Better Auth en la API con Organization, Admin y Two-Factor; roles de `auth-access`.
- PostgreSQL + Prisma con `tenant_id`, RLS y tabla `audit_logs` inmutable.
- i18n es/en y wireframes de las pantallas clave (entregable de diseño).

## Impacto en specs
- `auth-access`: se implementa y se modifica el requisito del segundo factor: TOTP exigido también en la
  API (403 `TWO_FACTOR_REQUIRED`). Delta en `specs/auth-access/spec.md`.
- `audit`: se implementa y se añade el requisito de acciones de plataforma (`tenant_id` NULL, legible
  solo por el rol de plataforma). Delta en `specs/audit/spec.md`.

## Preguntas abiertas
- ¿Hosting definitivo de la API y la base de datos (planes gratuitos con arranque en frío)?
- ¿Se verificó el registro en Duffel y LiteAPI desde Venezuela? (no bloquea F0)
- Horas semanales y fecha objetivo del desarrollador (SDD §13).
- ¿Qué inventario básico debe crear el seed de demostración? F0 no tiene tablas de catálogo (fuera del
  alcance de esta change): el seed crea solo identidad y el inventario se añade cuando llegue
  specs/catalog en F1 (decisión del dueño, 2026-11-10).
- `prisma migrate dev` falla al reproducir la migración del rol restringido en su shadow database
  (`REVOKE` sobre `_prisma_migrations`, que allí no existe; preexistente de T-F0-4). Mientras, las
  migraciones con SQL propio se escriben a mano y se aplican con `migrate deploy` (verificado con
  `migrate diff`). ¿Se arregla la migración del rol (condicional en el REVOKE) aceptando el
  re-baseline local, o se documenta como vía permanente?

## Fuera de alcance
Catálogo, reservas, pagos y tasas (F1 y F2).
