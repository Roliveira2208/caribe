import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiApplication, createApp } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";

/**
 * E2E de auth-access (f0-foundations): monta la app real de NestJS con Better
 * Auth y PostgreSQL. Los datos se crean por ejecucion con sufijos unicos para
 * no chocar con corridas anteriores ni depender de limpieza.
 */
describe("auth-access", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3002";
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("Ruta protegida sin sesión", () => {
    it("GET /api/v1/bookings/:id sin cookie responde 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/does-not-exist`);
      expect(res.status).toBe(401);
    });
  });

  describe("Catálogo público", () => {
    it("GET /api/v1/products sin sesión responde 200", async () => {
      const res = await fetch(`${baseUrl}/api/v1/products`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  describe("Aislamiento entre tenants (identidad)", () => {
    it("una sesión no accede a la organización de otra agencia", async () => {
      const emailA = `owner-a-${suffix}@example.com`;
      const emailB = `owner-b-${suffix}@example.com`;
      const password = "Password123!";

      await signUp(emailA, password);
      await signUp(emailB, password);

      const cookieA = await signIn(emailA, password);
      const cookieB = await signIn(emailB, password);
      expect(cookieA).toBeTruthy();
      expect(cookieB).toBeTruthy();

      const orgA = await createOrganization(cookieA, `Agencia A ${suffix}`, `agencia-a-${suffix}`);
      const orgB = await createOrganization(cookieB, `Agencia B ${suffix}`, `agencia-b-${suffix}`);

      // A pide la organización completa de B: no es miembro.
      const res = await fetch(
        `${baseUrl}/api/auth/organization/get-full-organization?organizationId=${orgB.id}`,
        { headers: { cookie: cookieA, origin } },
      );
      expect(res.status).toBe(403);

      // Control: A sí puede leer su propia organización.
      const own = await fetch(
        `${baseUrl}/api/auth/organization/get-full-organization?organizationId=${orgA.id}`,
        { headers: { cookie: cookieA, origin } },
      );
      expect(own.status).toBe(200);
    });
  });

  async function signUp(email: string, password: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: `Usuario ${suffix}`, email, password }),
    });
    if (!res.ok) {
      throw new Error(`sign-up falló: ${await res.text()}`);
    }
  }

  async function signIn(email: string, password: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(`sign-in falló: ${await res.text()}`);
    }
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.startsWith("better-auth.session_token"));
    return session?.split(";")[0] ?? "";
  }

  async function createOrganization(
    cookie: string,
    name: string,
    slug: string,
  ): Promise<{ id: string }> {
    const res = await fetch(`${baseUrl}/api/auth/organization/create`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ name, slug }),
    });
    if (!res.ok) {
      throw new Error(`create organization falló: ${await res.text()}`);
    }
    return (await res.json()) as { id: string };
  }
});
