import { join } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

// Los mismos archivos que setup-env (vitest corre con cwd en apps/api).
dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

/** Nombre fijo de la base de pruebas: nunca se escribe en `caribe_dev`. */
export const TEST_DATABASE_NAME = "caribe_test";

const LOCAL_SOURCE =
  "postgresql://caribe_dev:caribe_dev_password@localhost:5433/caribe_dev?schema=public";

/**
 * URL de la BD de pruebas. Se conservan servidor, puerto y credenciales del
 * entorno, pero el nombre de la base SIEMPRE se reescribe a `caribe_test`: así
 * un `.env` con `DATABASE_URL=.../caribe_dev` no puede hacer que los tests
 * borren los datos de demostración.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const source = env["TEST_DATABASE_URL"] ?? env["DATABASE_URL"] ?? LOCAL_SOURCE;
  const url = new URL(source);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  if (!url.searchParams.has("schema")) url.searchParams.set("schema", "public");
  return url.toString();
}

/** URL al catálogo `postgres` del mismo servidor, para crear la BD si falta. */
export function adminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const source = env["TEST_DB_ADMIN_URL"] ?? env["DATABASE_URL"] ?? LOCAL_SOURCE;
  const url = new URL(source);
  url.pathname = "/postgres";
  url.searchParams.delete("schema");
  return url.toString();
}

/**
 * Limpieza propia de `caribe_test`: trunca todas sus tablas (menos el control
 * de migraciones) con CASCADE y reinicia las secuencias. Antes de tocar nada
 * comprueba el nombre de la base: si no es `caribe_test`, falla cerrado.
 */
export async function resetTestDatabase(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  try {
    await client.connect();
    const current = await client.query<{ name: string }>("SELECT current_database() AS name");
    if (current.rows[0]?.name !== TEST_DATABASE_NAME) {
      throw new Error(
        `Limpieza rechazada: conectado a ${current.rows[0]?.name}, se esperaba ${TEST_DATABASE_NAME}`,
      );
    }

    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        ORDER BY tablename`,
    );
    if (rows.length === 0) {
      throw new Error(
        `${TEST_DATABASE_NAME} no tiene tablas; ejecuta pnpm db:test:prepare antes de pnpm test`,
      );
    }

    const tables = rows.map(({ tablename }) => `"${tablename}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}
