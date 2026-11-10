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
`auth-access` y `audit` pasan de contrato a implementados; el resto no se toca.

## Preguntas abiertas
- ¿Hosting definitivo de la API y la base de datos (planes gratuitos con arranque en frío)?
- ¿Se verificó el registro en Duffel y LiteAPI desde Venezuela? (no bloquea F0)
- Horas semanales y fecha objetivo del desarrollador (SDD §13).

## Fuera de alcance
Catálogo, reservas, pagos y tasas (F1 y F2).
