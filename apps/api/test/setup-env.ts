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
// El socket local actúa como proxy de confianza en los e2e de seguridad: permite
// simular clientes reales con una cadena `cliente, 127.0.0.1` sin red extra.
// Un .env copiado de .env.example lo trae vacío: en ese caso también hay que
// fijarlo, para que el gate de proxies de confianza no dependa del entorno.
if (!process.env.TRUSTED_PROXIES) process.env.TRUSTED_PROXIES = "127.0.0.1/32";
process.env.ALLOWED_IMAGE_HOSTS ??= "images.caribe.test";
// Sin servidor real de tasas en pruebas: se FUERZA el stub local después de
// cargar .env. Con `??=` las credenciales reales del entorno ganaban y cada
// signIn lanzaba un refresco HTTP real (5 s + reintento + circuit breaker)
// justo durante los beforeAll pesados; eso provocaba `Hook timed out`.
// Los e2e que levantan su propio servidor sobreescriben la variable después.
process.env.COTIZAVE_API_URL = "http://127.0.0.1:9/rates";
process.env.COTIZAVE_API_KEY = "ctz_live_test_no_usar";
// La caché de tasas de Redis sobrevive a la limpieza de `caribe_test`: una
// corrida anterior podía dejar la tasa de hoy y hacer que el e2e de pagos no
// llamara al proveedor. En pruebas se usa solo la caché en memoria, que muere
// con el proceso (jobs sigue deshabilitado por NODE_ENV).
process.env.REDIS_URL = "";
