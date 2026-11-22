import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Next.js fija `jsx: preserve` en tsconfig.json y resuelve `@/*` con paths de
 * TypeScript. Los tests importan componentes .tsx directamente, así que Vite
 * necesita el runtime automático de React y los mismos alias que la app.
 */
export default defineConfig({
  // Los e2e de Playwright viven en `e2e/` y usan el runner de Playwright;
  // Vitest solo ejecuta las pruebas unitarias de `test/`.
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@caribe/shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
});
