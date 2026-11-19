import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SMTP local de desarrollo (punto 3 de la mejora de infraestructura): Mailpit
 * debe estar en compose.yaml en puertos que no choquen con PostgreSQL (5433)
 * ni Redis (6380), y el README debe explicar cómo ver los correos.
 */
const rootDir = join(process.cwd(), "../..");
const compose = readFileSync(join(rootDir, "compose.yaml"), "utf-8");
const readme = readFileSync(join(rootDir, "README.md"), "utf-8");

describe("SMTP local con Mailpit", () => {
  it("define el servicio mailpit con la imagen oficial", () => {
    expect(compose).toMatch(/^ {2}mailpit:\s*$/m);
    expect(compose).toMatch(/image:\s*axllent\/mailpit/);
  });

  it("expone SMTP en 1025 y la interfaz web en 8025, sin chocar con 5433 ni 6380", () => {
    expect(compose).toMatch(/- "\$\{SMTP_PORT:-1025\}:1025"/);
    expect(compose).toMatch(/- "\$\{MAILPIT_UI_PORT:-8025\}:8025"/);
    expect(compose).not.toMatch(/mailpit[\s\S]*?5433/);
    expect(compose).not.toMatch(/mailpit[\s\S]*?6380/);
  });

  it("tiene healthcheck para que db:up --wait espere a Mailpit", () => {
    const service = compose.split(/^ {2}\w[\w-]*:\s*$/m).find((block) => block.includes("mailpit:"));
    expect(service).toBeDefined();
    expect(service).toMatch(/healthcheck:/);
  });

  it("el README explica cómo abrir la bandeja de correos", () => {
    expect(readme).toMatch(/Mailpit/i);
    expect(readme).toMatch(/8025/);
    expect(readme).toMatch(/SMTP_HOST=localhost/);
  });
});
