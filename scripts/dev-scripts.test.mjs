// Comprobación de la configuración de arranque local. Usa node:test para no
// añadir dependencias: si falta un script o Turbo no propaga el entorno, el
// `pnpm dev` documentado no sirve y esto debe fallar antes que el usuario.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readText = (...parts) => readFileSync(join(root, ...parts), "utf8");
const readJson = (...parts) => JSON.parse(readText(...parts));
// turbo.json lleva comentarios de línea completa; se ignoran solo para leerlo.
const readTurbo = () => JSON.parse(readText("turbo.json").replace(/^\s*\/\/.*$/gm, ""));

test("pnpm dev levanta web, admin y API desde la raíz", () => {
  const rootPkg = readJson("package.json");
  assert.equal(rootPkg.scripts.dev, "turbo run dev");

  const apiPkg = readJson("apps/api/package.json");
  assert.match(apiPkg.scripts.dev ?? "", /dist\/main\.js/);
  assert.doesNotMatch(apiPkg.scripts.dev, /\bpnpm\b|tsc-watch|tsx watch/);

  const dev = readTurbo().tasks.dev;
  assert.equal(dev.persistent, true);
  assert.equal(dev.cache, false);
  for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "API_URL"]) {
    assert.ok(dev.env.includes(name), `turbo dev debe declarar ${name}`);
  }
});

test("la documentación explica los prerrequisitos de pnpm dev", () => {
  for (const file of ["README.md", "AGENTS.md"]) {
    const text = readText(file);
    assert.match(text, /pnpm dev/);
    assert.match(text, /cp \.env\.example \.env/);
    assert.match(text, /pnpm db:up/);
  }
});

test("pnpm test ejecuta la comprobación de scripts de desarrollo", () => {
  assert.match(readJson("package.json").scripts.test, /dev-scripts\.test\.mjs/);
});
