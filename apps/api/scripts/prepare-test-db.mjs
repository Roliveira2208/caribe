// Crea `caribe_test` en el mismo servidor PostgreSQL y le aplica las mismas
// migraciones versionadas que a `caribe_dev`, sin tocar la base de desarrollo
// ni sus datos de demostración. Idempotente: se puede correr antes de cada
// `pnpm test` o una sola vez tras `pnpm db:up`.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const databaseName = "caribe_test";
const localSource = "postgresql://caribe_dev:caribe_dev_password@localhost:5433/caribe_dev";

dotenv.config({ path: join(apiDir, ".env") });
dotenv.config({ path: join(apiDir, "../../.env") });

function urlFor(source, pathname, keepSchema) {
  const url = new URL(source);
  url.pathname = pathname;
  if (!keepSchema) url.searchParams.delete("schema");
  return url.toString();
}

const source = process.env.TEST_DB_ADMIN_URL ?? process.env.DATABASE_URL ?? localSource;
const adminUrl = urlFor(source, "/postgres", false);
const testUrl = urlFor(source, `/${databaseName}`, true);

const client = new Client({ connectionString: adminUrl });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    databaseName,
  ]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`Creada la base de pruebas ${databaseName}`);
  } else {
    console.log(`La base de pruebas ${databaseName} ya existía; se reutiliza`);
  }
} finally {
  await client.end();
}

// Se invoca el CLI de Prisma con node directamente (sin `shell`, sin .cmd)
// para evitar el aviso de deprecación de args + shell en Windows.
const prismaCli = join(apiDir, "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: apiDir,
  env: { ...process.env, DATABASE_URL: testUrl },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Migraciones aplicadas a ${databaseName}`);
