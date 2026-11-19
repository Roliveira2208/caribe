// Entorno de pruebas: el servidor y las credenciales vienen del proceso o del
// .env; si no hay nada configurado se usa el docker compose local. El nombre de
// la base siempre se reescribe a caribe_test (ver test-db.ts).
import { join } from "node:path";
import dotenv from "dotenv";
import { testDatabaseUrl } from "./test-db.js";

dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

// Se FUERZA la base de pruebas: los e2e limpian y siembran datos, y un `.env`
// con la URL de desarrollo no debe poder desviarlos a `caribe_dev`.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.BETTER_AUTH_SECRET ??= "test-secret-no-usar-en-produccion-0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3002";
process.env.TRUSTED_ORIGINS ??= "http://localhost:3000,http://localhost:3001";
process.env.ALLOWED_IMAGE_HOSTS ??= "images.caribe.test";
// Sin servidor real de tasas en pruebas: el proveedor falla rápido y cada e2e
// que lo necesite levanta su propio servidor y fija COTIZAVE_API_URL antes de
// crear la aplicación. La clave es un valor de prueba, nunca una real.
process.env.COTIZAVE_API_URL ??= "http://127.0.0.1:9/rates";
process.env.COTIZAVE_API_KEY ??= "ctz_live_test_no_usar";
