#!/usr/bin/env node
// Asigna la contrasena del rol restringido ota_app (migracion
// 20261110022152_restricted_app_role). El rol nace sin contrasena y esta nunca
// se versiona: se lee OTA_APP_DB_PASSWORD del entorno o del .env de la raiz
// (el entorno gana), se ejecuta ALTER ROLE dentro del contenedor de compose y
// se verifica el login por scram desde el host, como hara la aplicacion.
//
// Uso: pnpm db:app-password   (o: node scripts/set-ota-app-password.mjs)
// Requiere: pnpm db:up y las migraciones aplicadas (pnpm db:migrate:dev).
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Valor de una variable del .env de la raiz; no toca process.env. */
async function readEnvFile(name) {
  let content;
  try {
    content = await readFile(path.join(repoRoot, ".env"), "utf8");
  } catch {
    return undefined; // sin .env: solo cuenta la variable de entorno del proceso
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1 || trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

async function main() {
  const password = process.env.OTA_APP_DB_PASSWORD ?? (await readEnvFile("OTA_APP_DB_PASSWORD"));
  if (!password) {
    console.error("Falta OTA_APP_DB_PASSWORD: definela en el .env de la raiz (ver .env.example).");
    process.exit(1);
  }

  const pgUser = process.env.POSTGRES_USER ?? (await readEnvFile("POSTGRES_USER")) ?? "ota_dev";
  const pgDb = process.env.POSTGRES_DB ?? (await readEnvFile("POSTGRES_DB")) ?? "ota_dev";
  const pgPort = Number(process.env.POSTGRES_PORT ?? (await readEnvFile("POSTGRES_PORT")) ?? 5433);

  // ALTER ROLE como dueno dentro del contenedor (socket local). La contrasena
  // viaja por stdin (con ' escapado): nunca por argv, logs ni el repositorio.
  // execFileSync con input es la via soportada de escribir stdin; la variante
  // asincrona ignora `input` y dejaria a psql esperando EOF para siempre.
  const escaped = password.replace(/'/g, "''");
  const sql = `ALTER ROLE ota_app WITH PASSWORD '${escaped}';\n`;
  try {
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        pgUser,
        "-d",
        pgDb,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { cwd: repoRoot, input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] },
    );
  } catch (error) {
    console.error("No se pudo ejecutar ALTER ROLE dentro del contenedor de postgres:");
    console.error(error.stderr || error.message || error);
    console.error(
      "Revisa que la base este levantada (pnpm db:up) y migrada (pnpm db:migrate:dev).",
    );
    process.exit(1);
  }

  // Verificacion real de autenticacion (TCP + scram por el puerto publicado).
  try {
    const requireFromApi = createRequire(path.join(repoRoot, "apps", "api", "package.json"));
    const { Client } = requireFromApi("pg");
    const client = new Client({
      host: "localhost",
      port: pgPort,
      user: "ota_app",
      password,
      database: pgDb,
    });
    await client.connect();
    await client.end();
  } catch (error) {
    console.error("La contrasena quedo asignada pero el login de prueba fallo:");
    console.error(error.message || error);
    process.exit(1);
  }

  console.log(`OK: ota_app autentica por scram en localhost:${pgPort}.`);
}

await main();
