import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unitarios *.test.ts y e2e *.e2e.ts (arrancan la app y tocan PostgreSQL).
    include: ["test/**/*.test.ts", "test/**/*.e2e.ts"],
    // Los e2e arrancan la app real y tocan PostgreSQL: necesitan mas tiempo
    // que los tests unitarios y un entorno de variables predecible.
    setupFiles: ["./test/setup-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
