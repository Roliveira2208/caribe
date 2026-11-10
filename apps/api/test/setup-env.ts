// Entorno de pruebas: los valores reales del proceso o del .env ganan; estos
// son solo valores por defecto para correr vitest sin configurar nada (la BD
// local de docker compose). La CI inyecta DATABASE_URL a nivel de job.
import { join } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

process.env.DATABASE_URL ??=
  "postgresql://ota_dev:ota_dev_password@localhost:5433/ota_dev?schema=public";
process.env.BETTER_AUTH_SECRET ??= "test-secret-no-usar-en-produccion-0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3002";
process.env.TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
