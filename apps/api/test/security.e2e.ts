import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { resolveClientIp } from "../src/security/client-ip.js";
import { prisma } from "../src/prisma.js";
import {
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E de seguridad (T-F2-2, spec security).
 *
 * La IP se resuelve en un middleware que decide si la cabecera de reenvío es
 * confiable usando la dirección del socket y `TRUSTED_PROXIES`; el resultado se
 * publica como `request.ip` y como cabecera interna leída por Better Auth, de
 * modo que auditoría y rate limit vean exactamente el mismo valor.
 *
 * En pruebas `TRUSTED_PROXIES = 127.0.0.1/32` (ver setup-env): el socket local
 * actúa como proxy de confianza y una cadena `cliente, 127.0.0.1` simula un
 * cliente real detrás de él. Una cadena cuyo último salto no es el socket se
 * descarta, igual que cualquier cabecera recibida desde un socket no confiable.
 */
describe("security", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);
  const trustedSocket = "127.0.0.1";
  const otherSocket = "198.51.100.5";
  const clientA = "203.0.113.10";
  const clientB = "203.0.113.11";

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    // `app.getUrl()` puede devolver `localhost` o `[::1]`. La configuración de
    // pruebas confía en 127.0.0.1/32: forzar IPv4 mantiene el socket y la
    // cadena de reenvío coherentemente en la misma familia.
    baseUrl = (await app.getUrl())
      .replace(/\/$/, "")
      .replace("localhost", "127.0.0.1")
      .replace("[::1]", "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Cadena de reenvío de un cliente detrás del proxy local de pruebas. */
  function chainOf(clientIp: string): string {
    return `${clientIp}, ${trustedSocket}`;
  }

  /** Petición a Better Auth con una cadena de reenvío controlada. */
  function postAuth(
    path: string,
    body: unknown,
    options: { cookie?: string; forwardedFor?: string } = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: authOrigin,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.forwardedFor ? { "x-forwarded-for": options.forwardedFor } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  describe("IP real tras proxies de confianza", () => {
    it("IP tras proxy de confianza", async () => {
      // El último salto es el proxy de confianza: se recorre hacia la izquierda
      // hasta el primer salto que no es proxy; ese es el cliente.
      expect(
        resolveClientIp({
          socketAddress: "10.0.0.5",
          forwardedFor: "203.0.113.9, 10.0.0.5",
          trustedProxies: ["10.0.0.0/8"],
        }),
      ).toBe("203.0.113.9");

      // La misma decisión la toma la app: la IP resuelta llega a auth_events.
      const owner = await userWithTotp(baseUrl, `ip-trusted-${suffix}@example.com`);
      const org = await createAgency(owner.userId, `Agencia IP ${suffix}`, `agencia-ip-${suffix}`);
      await setActiveOrg(baseUrl, owner.cookie, org.id);

      const res = await postAuth(
        "/organization/invite-member",
        {
          email: `ip-trusted-invite-${suffix}@example.com`,
          role: "provider",
          organizationId: org.id,
        },
        { cookie: owner.cookie, forwardedFor: chainOf(clientA) },
      );
      expect(res.status, await res.text()).toBe(200);

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: { route: "/organization/invite-member", phase: "attempt", actorId: owner.userId },
        orderBy: { at: "desc" },
      });
      expect(attempt.ip).toBe(clientA);
    });

    it("Cabecera de proxy no confiable", async () => {
      // Socket fuera de la lista: la cabecera se ignora por completo, aunque
      // repita la dirección del socket.
      expect(
        resolveClientIp({
          socketAddress: otherSocket,
          forwardedFor: chainOf(clientA),
          trustedProxies: ["10.0.0.0/8"],
        }),
      ).toBe(otherSocket);

      // Socket confiable pero cadena incoherente: el último salto no es el
      // socket, así que tampoco se acepta la cabecera.
      expect(
        resolveClientIp({
          socketAddress: trustedSocket,
          forwardedFor: chainOf(clientA).replace(trustedSocket, otherSocket),
          trustedProxies: [trustedSocket],
        }),
      ).toBe(trustedSocket);

      const owner = await userWithTotp(baseUrl, `ip-untrusted-${suffix}@example.com`);
      const org = await createAgency(owner.userId, `Agencia IPU ${suffix}`, `agencia-ipu-${suffix}`);
      await setActiveOrg(baseUrl, owner.cookie, org.id);

      const forged = chainOf(clientA).replace(trustedSocket, otherSocket);
      const res = await postAuth(
        "/organization/invite-member",
        {
          email: `ip-untrusted-invite-${suffix}@example.com`,
          role: "provider",
          organizationId: org.id,
        },
        { cookie: owner.cookie, forwardedFor: forged },
      );
      expect(res.status, await res.text()).toBe(200);

      const attempt = await prisma.authEvent.findFirstOrThrow({
        where: { route: "/organization/invite-member", phase: "attempt", actorId: owner.userId },
        orderBy: { at: "desc" },
      });
      expect(attempt.ip).toBe(trustedSocket);
      expect(attempt.ip).not.toBe(clientA);
    });

    it("Cabeceras de seguridad en la API", async () => {
      const ok = await fetch(`${baseUrl}/api/v1/rates/today`);
      const error = await fetch(`${baseUrl}/api/v1/admin/payments`);
      const limitedIp = "203.0.113.20";
      for (let i = 0; i < 10; i += 1) {
        await postAuth(
          "/sign-in/email",
          { email: `headers-${suffix}@example.com`, password: "PasswordIncorrecta123!" },
          { forwardedFor: chainOf(limitedIp) },
        );
      }
      const limited = await postAuth(
        "/sign-in/email",
        { email: `headers-${suffix}@example.com`, password: "PasswordIncorrecta123!" },
        { forwardedFor: chainOf(limitedIp) },
      );
      expect(limited.status).toBe(429);

      expect(error.status).toBeGreaterThanOrEqual(400);
      for (const response of [ok, error, limited]) {
        expect(response.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      }
    });

    it("CORS con orígenes permitidos", async () => {
      const origin = "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/v1/rates/today`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res.headers.get("access-control-allow-methods") ?? "").toContain("GET");
      expect(res.headers.get("access-control-allow-headers") ?? "").toContain("content-type");
    });

    it("CORS con origen desconocido", async () => {
      const res = await fetch(`${baseUrl}/api/v1/rates/today`, {
        method: "OPTIONS",
        headers: {
          origin: "https://origen-desconocido.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    });

    it("Rate limit por IP real", async () => {
      const email = `rate-${suffix}@example.com`;
      await createUser(email);
      const wrongPassword = "PasswordIncorrecta123!";
      const attempts = 10;

      for (let i = 0; i < attempts; i += 1) {
        const res = await postAuth(
          "/sign-in/email",
          { email, password: wrongPassword },
          { forwardedFor: chainOf(clientA) },
        );
        expect(res.status).toBe(401);
      }

      const limited = await postAuth(
        "/sign-in/email",
        { email, password: wrongPassword },
        { forwardedFor: chainOf(clientA) },
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("content-type")).toContain("application/problem+json");
      const problem = (await limited.json()) as { code?: string; detail?: string };
      expect(problem.code).toBe("RATE_LIMITED");
      expect(problem.detail).not.toContain(clientA);
      expect(problem.detail).not.toContain(clientB);

      // Otra IP real tiene su propio contador: su primer intento no es 429.
      const other = await postAuth(
        "/sign-in/email",
        { email, password: wrongPassword },
        { forwardedFor: chainOf(clientB) },
      );
      expect(other.status).toBe(401);

      // Falsificar la cabecera no hereda ni esquiva el contador de clientA:
      // el último salto no es el socket, así que se contabiliza como el socket.
      const forged = await postAuth(
        "/sign-in/email",
        { email, password: wrongPassword },
        { forwardedFor: chainOf(clientB).replace(trustedSocket, otherSocket) },
      );
      expect(forged.status).toBe(401);
    });
  });
});
