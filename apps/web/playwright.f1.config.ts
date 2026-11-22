import { defineConfig, devices } from "@playwright/test";

/**
 * Config del recorrido F1 (T-F1-15). Requiere API y web ya levantadas en 3102/3100
 * con la misma BD sembrada; Playwright no inicia servidores para que la prueba
 * exercise exactamente los binarios que se entregan.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "./f1-hotels-e2e-results.json" }]],
  outputDir: "./test-results/f1-artifacts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
