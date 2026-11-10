# OTA Venezuela

MVP de portafolio de una agencia de viajes en línea para Venezuela. Este repositorio arranca con el kit de
desarrollo asistido por IA (Spec Driven Development). Empieza por `docs/workflow.md`.

- Diseño: `docs/sdd/SDD.md` · Specs: `openspec/specs/` · Primera change: `openspec/changes/f0-foundations/`
- Validar specs: `node scripts/check-specs.mjs`

## Base de datos local

`pnpm db:up` levanta PostgreSQL 17 y Redis 7 (puertos 5433/6380) y `pnpm db:migrate:dev` aplica las
migraciones. El rol restringido `ota_app` nace sin contraseña: define `OTA_APP_DB_PASSWORD` en tu
`.env` (ver `.env.example`) y asígnala con `pnpm db:app-password`.
