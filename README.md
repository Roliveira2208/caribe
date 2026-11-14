# Caribe

MVP de portafolio de una agencia de viajes en línea para Venezuela. Este repositorio arranca con el kit de
desarrollo asistido por IA (Spec Driven Development). Empieza por `docs/workflow.md`.

- Diseño: `docs/sdd/SDD.md` · Specs: `openspec/specs/` · Primera change: `openspec/changes/f0-foundations/`
- Validar specs: `node scripts/check-specs.mjs`

## Base de datos local

`pnpm db:up` levanta PostgreSQL 17 y Redis 7 (puertos 5433/6380) y `pnpm db:migrate:dev` aplica las
migraciones. El rol restringido `caribe_app` nace sin contraseña: define `CARIBE_APP_DB_PASSWORD` en tu
`.env` (ver `.env.example`) y asígnala con `pnpm db:app-password`.

## Demo local (F1)

1. `pnpm db:up` y `pnpm db:migrate:deploy` (o `pnpm db:migrate:dev` si estás creando migraciones).
2. `pnpm db:seed`: crea la agencia `caribe-demo`, un usuario por rol (contraseña `CaribeDemo123!`), el
   proveedor y el destino de demostración, una política de cancelación flexible, un tipo de habitación
   publicado con 60 noches de disponibilidad desde hoy en `America/Caracas`, la tasa global del día y
   los ajustes de la agencia en modo de pago `MANUAL`. Es idempotente: la segunda corrida no crea ni
   pisa nada, e imprime al terminar qué creó y las credenciales.
3. `pnpm dev` y abre la web en `http://localhost:3000` y el panel en `http://localhost:3001`. Para el
   panel usa `owner@caribe-demo.example.com`; para reservar, `cliente@caribe-demo.example.com`.

La tasa global se crea solo si no existe una para hoy (el trabajo de tasas puede haberla escrito
antes); el resto del inventario se busca por clave natural y se deja intacto si ya existe.
