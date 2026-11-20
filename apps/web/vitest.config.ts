import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Next.js fija `jsx: preserve` en tsconfig.json y resuelve `@/*` con paths de
 * TypeScript. Los tests importan componentes .tsx directamente, así que Vite
 * necesita el runtime automático de React y los mismos alias que la app.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@caribe/shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
});
