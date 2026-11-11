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
- `payments`: se modifica el requisito del modo de aprobación: la revisión de un pago (aprobarlo o
  rechazarlo) es exclusiva del Admin de agencia de la agencia del pago y nunca la hace quien lo reportó;
  el Super Admin y los demás roles no revisan. Delta en `specs/payments/spec.md`.

## Decisiones
- T-F0-8 entrega el mecanismo completo en la API (guard, 403 `TWO_FACTOR_REQUIRED`, inventario de rutas
  en tests); la pantalla de activación de TOTP se construye en T-F0-10 junto al shell con login, que
  redirige a la activación cuando la API responde 403 `TWO_FACTOR_REQUIRED` (decisión del dueño,
  2026-11-10). Precedente: T-F0-6b/7.
- T-F0-7: `audit_logs` nace con `tenant_id` + RLS; la inmutabilidad queda en T-F0-9 (decisión del dueño).
- Fix de infraestructura (2026-11-10, pedido por el dueño tras T-F0-8, fuera de `tasks.md`): el replay de
  la shadow database quedó arreglado (REVOKE condicional en la migración del rol + re-baseline del
  checksum local), `migrate dev` vuelve a estar disponible y la CI comprueba con `prisma migrate diff`
  que `schema.prisma` y las migraciones no divergen. Ver `design.md`.
- Organización activa por sesión (decisión del dueño, 2026-11-10, para implementar en F1): al iniciar
  sesión se auto-selecciona la organización cuando el usuario tiene una sola membresía; si tiene varias,
  se muestra un selector antes de entrar al panel. Responde la pregunta abierta surgida en la
  verificación e2e de T-F0-10 (las sesiones de Better Auth nacen sin organización activa); ver
  `design.md`.

## Preguntas abiertas
- ¿Hosting definitivo de la API y la base de datos (planes gratuitos con arranque en frío)?
- ¿Se verificó el registro en Duffel y LiteAPI desde Venezuela? (no bloquea F0)
- Horas semanales y fecha objetivo del desarrollador (SDD §13).
- ¿Qué inventario básico debe crear el seed de demostración? F0 no tiene tablas de catálogo (fuera del
  alcance de esta change): el seed crea solo identidad y el inventario se añade cuando llegue
  specs/catalog en F1 (decisión del dueño, 2026-11-10).

## Fuera de alcance
Catálogo, reservas, pagos y tasas (F1 y F2).
