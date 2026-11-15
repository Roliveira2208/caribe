// Entorno de pruebas: los valores reales del proceso o del .env ganan; estos
// son solo valores por defecto para correr vitest sin configurar nada (la BD
// local de docker compose). La CI inyecta DATABASE_URL a nivel de job.
import { join } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

process.env.DATABASE_URL ??=
  "postgresql://caribe_dev:caribe_dev_password@localhost:5433/caribe_dev?schema=public";
process.env.BETTER_AUTH_SECRET ??= "test-secret-no-usar-en-produccion-0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3002";
process.env.TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
process.env.ALLOWED_IMAGE_HOSTS ??= "images.caribe.test";
// Sin servidor real de tasas en pruebas: el proveedor falla rápido y cada e2e
// que lo necesite levanta su propio servidor y fija DOLARAPI_URL antes de
// crear la aplicación.
process.env.DOLARAPI_URL ??= "http://127.0.0.1:9/dolar";
