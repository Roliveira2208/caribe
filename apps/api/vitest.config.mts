import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unitarios *.test.ts y e2e *.e2e.ts (arrancan la app y tocan PostgreSQL).
    include: ["test/**/*.test.ts", "test/**/*.e2e.ts"],
    // Los e2e arrancan la app real y tocan PostgreSQL: necesitan mas tiempo
    // que los tests unitarios y un entorno de variables predecible.
    setupFiles: ["./test/setup-env.ts"],
    // Limpieza propia de caribe_test antes y después de la corrida.
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20_000,
    // 30 s es suficiente cuando las pruebas NO llaman al proveedor real:
    // setup-env.ts fuerza COTIZAVE_API_URL al stub local. No subir el timeout
    // para enmascarar llamadas de red accidentales en los `beforeAll`.
    hookTimeout: 30_000,
    // Los e2e comparten una sola base PostgreSQL y varios fijan estado global
    // (la tasa del día, el seed de demostración). En paralelo se pisan entre
    // archivos; en serie el estado de cada archivo queda aislado. Además evita
    // que varios Nest arranquen a la vez y agoten el hookTimeout.
    fileParallelism: false,
  },
});
