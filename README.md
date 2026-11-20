# Caribe

MVP de portafolio de una agencia de viajes en línea para Venezuela. Este repositorio arranca con el kit de
desarrollo asistido por IA (Spec Driven Development). Empieza por `docs/workflow.md`.

- Diseño: `docs/sdd/SDD.md` · Specs: `openspec/specs/` · Primera change: `openspec/changes/f0-foundations/`
- Validar specs: `node scripts/check-specs.mjs`

## Base de datos local

`pnpm db:up` levanta PostgreSQL 17 y Redis 7 (puertos 5433/6380) y `pnpm db:migrate:dev` aplica las
migraciones. El rol restringido `caribe_app` nace sin contraseña: define `CARIBE_APP_DB_PASSWORD` en tu
`.env` (ver `.env.example`) y asígnala con `pnpm db:app-password`.

## Base de datos de pruebas

Los tests **nunca** usan `caribe_dev`: `pnpm db:test:prepare` crea `caribe_test` en el mismo servidor y
le aplica las mismas migraciones versionadas (es idempotente; ejecútalo tras `pnpm db:up`). Vitest
fuerza el nombre `caribe_test` aunque tu `.env` apunte a otra base, y trunca sus tablas al empezar y al
terminar la corrida. Así los datos de demostración de `caribe_dev` quedan intactos.

```
pnpm db:up
pnpm db:test:prepare
pnpm test
```

## Correo local con Mailpit

`pnpm db:up` también levanta Mailpit: un servidor SMTP que **no envía** correos a Internet, los guarda
en una bandeja local. En tu `.env` apunta la API a él con `SMTP_HOST=localhost` y `SMTP_PORT=1025`
(el `SMTP_FROM` es el remitente que verás en los mensajes). Después de reservar (o de simular un pago
aprobado), abre **http://localhost:8025** para ver el correo de confirmación, su asunto y su
contenido en texto y HTML. La interfaz permite buscar por destinatario y borrar la bandeja.

El puerto SMTP es `1025` y el de la interfaz web `8025` (configurable con `MAILPIT_UI_PORT`); ninguno
choca con PostgreSQL (5433) ni Redis (6380). En tests no se usa SMTP real: el proveedor de
notificaciones se dobla, así que no hace falta Mailpit para correr `pnpm test`.

## Arranque local

Copia la plantilla con `cp .env.example .env` y ajusta los valores (al menos la contraseña de Better
Auth). Después, `pnpm db:up` levanta PostgreSQL, Redis y Mailpit. Con `pnpm dev`, Turbo compila y
arranca la API en `http://localhost:3002`, la web en `http://localhost:3000` y el panel en
`http://localhost:3001`. La API no recarga sola: reinicia `pnpm dev` tras cambiar TypeScript en
`apps/api`.

## Demo local (F1)

1. `pnpm db:up` y `pnpm db:migrate:deploy` (o `pnpm db:migrate:dev` si estás creando migraciones).
2. `pnpm db:seed`: crea la agencia `caribe-demo`, un usuario por rol (contraseña `CaribeDemo123!`), el
   proveedor y el destino de demostración, una política de cancelación flexible, un tipo de habitación
   publicado con 60 noches de disponibilidad desde hoy en `America/Caracas`, la tasa global del día y
   los ajustes de la agencia en modo de pago `MANUAL`. Es idempotente: la segunda corrida no crea ni
   pisa nada, e imprime al terminar qué creó y las credenciales.
3. `pnpm dev` y abre la web en `http://localhost:3000` y el panel en `http://localhost:3001` (la API
   queda en `http://localhost:3002`). Para el panel usa `owner@caribe-demo.example.com`; para reservar,
   `cliente@caribe-demo.example.com`.

La tasa global se crea solo si no existe una para hoy (el trabajo de tasas puede haberla escrito
antes); el resto del inventario se busca por clave natural y se deja intacto si ya existe.
