import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { type ApiApplication, createApp } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import { TenantService } from "../src/tenant/tenant.service.js";
import {
  addMember,
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E del contrato de errores (T-F1-0c, spec api-errors).
 *
 * Recorre los estados que ya existen en F0 (401/403/403 TOTP/404/405/413/422)
 * y comprueba el `Content-Type`, el cuerpo Problem Details y que un 500 no
 * filtra traza, SQL ni nombres de tabla. Los escenarios de cupo, reserva
 * vencida y tasa llegan con sus dominios (T-F1-7 y posteriores); aqui se
 * prueba el contrato que todos comparten.
 */

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: Array<{ path: string; message: string }>;
  correlationId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Comprueba estado, cabecera y campos obligatorios de un Problem Details. */
async function expectProblem(res: Response, status: number, code: string): Promise<ProblemBody> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = (await res.json()) as ProblemBody;
  expect(body).toMatchObject({ status, code });
  expect(body.type).toBe(`https://caribe.app/problems/${code.toLowerCase().replaceAll("_", "-")}`);
  expect(body.title).toBeTruthy();
  expect(body.detail).toBeTruthy();
  expect(body.instance.startsWith("/api/v1/")).toBe(true);
  // `instance` es la ruta, nunca la query con datos del cliente.
  expect(body.instance).not.toContain("?");
  return body;
}

describe("api-errors (Problem Details)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let superCookie: string;
  let ownerNoTotpCookie: string;
  let agentCookie: string;
  let agentEmail: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // Agencia con owner sin TOTP (para el 403 TWO_FACTOR_REQUIRED) y agente.
    const ownerEmail = `owner-errors-${suffix}@example.com`;
    const ownerId = await createUser(ownerEmail);
    const org = await createAgency(ownerId, `Agencia ERR ${suffix}`, `agencia-err-${suffix}`);
    ownerNoTotpCookie = await signIn(baseUrl, ownerEmail);
    await setActiveOrg(baseUrl, ownerNoTotpCookie, org.id);

    agentEmail = `agent-errors-${suffix}@example.com`;
    const agentId = await createUser(agentEmail);
    await addMember(org.id, agentId, "agent");
    agentCookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, agentCookie, org.id);

    // Super Admin de plataforma con TOTP (las rutas /admin lo exigen).
    const superAdmin = await userWithTotp(baseUrl, `super-errors-${suffix}@example.com`);
    await prisma.user.update({ where: { id: superAdmin.userId }, data: { role: "super_admin" } });
    superCookie = superAdmin.cookie;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("estados sin código de dominio", () => {
    it("sin sesión -> 401 UNAUTHENTICATED", async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/no-existe`);
      const body = await expectProblem(res, 401, "UNAUTHENTICATED");
      expect(body.instance).toBe("/api/v1/bookings/no-existe");
    });

    it("rol sin permiso -> 403 FORBIDDEN", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: agentCookie, origin: authOrigin },
      });
      await expectProblem(res, 403, "FORBIDDEN");
    });

    it("rol administrativo sin TOTP -> 403 TWO_FACTOR_REQUIRED", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/exchange-rates/override`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: ownerNoTotpCookie, origin: authOrigin },
        body: JSON.stringify({}),
      });
      const body = await expectProblem(res, 403, "TWO_FACTOR_REQUIRED");
      expect(body.detail).toContain("segundo factor");
    });

    it("ruta inexistente -> 404 NOT_FOUND", async () => {
      const res = await fetch(`${baseUrl}/api/v1/no-existe`);
      const body = await expectProblem(res, 404, "NOT_FOUND");
      expect(body.instance).toBe("/api/v1/no-existe");
    });

    it("método no permitido -> Problem Details (404 o 405, nunca HTML)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/no-existe`, {
        method: "POST",
        headers: { cookie: agentCookie, origin: authOrigin },
      });
      // Nest no emite 405 en todas las versiones: el caso límite de la spec
      // tolera el 404 de ruta no encontrada, pero ambos con Problem Details.
      expect([404, 405]).toContain(res.status);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      const body = (await res.json()) as ProblemBody;
      expect(["NOT_FOUND", "METHOD_NOT_ALLOWED"]).toContain(body.code);
      expect(body.status).toBe(res.status);
    });
  });

  describe("validación estricta (422)", () => {
    it("cuerpo inválido -> 422 con la ruta del campo en falta", async () => {
      const slug = `agencia-invalida-${suffix}`;
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({ slug }),
      });
      const body = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(body.instance).toBe("/api/v1/admin/organizations");
      expect(body.errors).toEqual([expect.objectContaining({ path: "name" })]);
      await expect(prisma.organization.findUnique({ where: { slug } })).resolves.toBeNull();
    });

    it("campo desconocido (cardNumber) -> 422 y el valor no se devuelve", async () => {
      const slug = `agencia-card-${suffix}`;
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({ name: "Tarjeta", slug, cardNumber: "4111111111111111" }),
      });
      const body = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(body.errors?.map((issue) => issue.path)).toEqual(["cardNumber"]);
      expect(JSON.stringify(body)).not.toContain("4111");
      await expect(prisma.organization.findUnique({ where: { slug } })).resolves.toBeNull();
    });

    it("monto, tasa o campo calculado enviado por el cliente -> 422 y no se usa", async () => {
      const slug = `agencia-calc-${suffix}`;
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({
          name: "Calculada",
          slug,
          amount_usd: "100.00",
          amount_ves: "90000.00",
          total_usd: "100.00",
          rate: "900.0000",
          tenant_id: "otra-agencia",
          user_id: "otro-usuario",
          code: "INVENTADO",
        }),
      });
      const body = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(body.errors?.map((issue) => issue.path).sort()).toEqual(
        ["amount_usd", "amount_ves", "code", "rate", "tenant_id", "total_usd", "user_id"].sort(),
      );
      // La validación corre antes del handler: no se creó nada.
      await expect(prisma.organization.findUnique({ where: { slug } })).resolves.toBeNull();
    });

    it("query inválida -> 422 VALIDATION_ERROR", async () => {
      for (const query of ["limit=0", "limit=101", "outcome=bogus", "desconocido=1"]) {
        const res = await fetch(`${baseUrl}/api/v1/admin/auth-events?${query}`, {
          headers: { cookie: superCookie, origin: authOrigin },
        });
        const body = await expectProblem(res, 422, "VALIDATION_ERROR");
        expect(body.errors?.length, query).toBeGreaterThan(0);
      }
    });
  });

  describe("cuerpo mal formado o demasiado grande", () => {
    it("JSON inválido -> 422 VALIDATION_ERROR sin copiar el mensaje del parser", async () => {
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: '{"name":',
      });
      const body = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(body.detail).not.toContain("Unexpected");
      expect(JSON.stringify(body)).not.toContain("position");
    });

    it("cuerpo mayor al límite -> 413 PAYLOAD_TOO_LARGE", async () => {
      const huge = "a".repeat(150_000);
      const res = await fetch(`${baseUrl}/api/v1/admin/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: superCookie, origin: authOrigin },
        body: JSON.stringify({ name: "Grande", slug: `grande-${suffix}`, blob: huge }),
      });
      const body = await expectProblem(res, 413, "PAYLOAD_TOO_LARGE");
      // El cuerpo recibido no vuelve en la respuesta.
      expect(JSON.stringify(body)).not.toContain("aaaa");
    });
  });

  describe("error inesperado", () => {
    it("500 con correlación, sin traza, SQL ni nombres de tabla", async () => {
      const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      vi.spyOn(TenantService.prototype, "withPlatform").mockRejectedValueOnce(
        new Error('relation "audit_logs" does not exist: SELECT * FROM audit_logs'),
      );

      const res = await fetch(`${baseUrl}/api/v1/admin/audit-logs`, {
        headers: { cookie: superCookie, origin: authOrigin },
      });
      const body = await expectProblem(res, 500, "INTERNAL_ERROR");
      expect(body.instance).toBe("/api/v1/admin/audit-logs");
      expect(body.correlationId).toMatch(UUID_PATTERN);
      expect(res.headers.get("x-correlation-id")).toBe(body.correlationId);

      const raw = JSON.stringify(body);
      // `correlationId` contiene la palabra "relation": se buscan los
      // fragmentos del error interno, no la subcadena suelta.
      for (const leak of ["audit_logs", "SELECT", 'relation "', "does not exist", "stack"]) {
        expect(raw).not.toContain(leak);
      }
      expect(logged).toHaveBeenCalled();
    });
  });

  describe("frontera con Better Auth", () => {
    it("un error de /api/auth conserva el formato de Better Auth", async () => {
      const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: authOrigin },
        body: JSON.stringify({ email: agentEmail, password: "ClaveIncorrecta123!" }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type") ?? "").not.toContain("application/problem+json");
      const body = (await res.json()) as { code?: string; type?: string };
      expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      expect(body.type).toBeUndefined();
    });
  });
});
