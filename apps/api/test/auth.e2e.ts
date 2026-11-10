import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiApplication, createApp } from "../src/bootstrap.js";
import { auth } from "../src/auth.js";
import { prisma } from "../src/prisma.js";

/**
 * E2E de auth-access (f0-foundations): monta la app real de NestJS con Better
 * Auth y PostgreSQL. Los datos se crean por ejecucion con sufijos unicos para
 * no chocar con corridas anteriores ni depender de limpieza.
 *
 * Usuarios y agencias se dan de alta por la API de servidor de Better Auth
 * (accion de sistema): el registro por HTTP tiene rate limit y, desde la
 * matriz T-F0-6, las agencias solo se crean sin sesion y con userId. El
 * inicio de sesion si va por HTTP para ejercitar la cookie real.
 */
describe("auth-access", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3002";
  const suffix = randomUUID().slice(0, 8);
  const password = "Password123!";

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

    it("PUT /api/v1/products/:id sin cookie responde 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/products/does-not-exist`, {
        method: "PUT",
        headers: { origin },
      });
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
      const userA = await createUser(emailA);
      const userB = await createUser(emailB);

      const cookieA = await signIn(emailA, password);
      const cookieB = await signIn(emailB, password);
      expect(cookieA).toBeTruthy();
      expect(cookieB).toBeTruthy();

      const orgA = await createAgency(userA, `Agencia A ${suffix}`, `agencia-a-${suffix}`);
      const orgB = await createAgency(userB, `Agencia B ${suffix}`, `agencia-b-${suffix}`);

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

  describe("Matriz de permisos (T-F0-6)", () => {
    it("proveedor edita su producto: 200 (permiso product:update; propiedad en F1)", async () => {
      const ownerEmail = `owner-pu-${suffix}@example.com`;
      const providerEmail = `provider-pu-${suffix}@example.com`;
      const org = await createAgency(
        await createUser(ownerEmail),
        `Agencia PU ${suffix}`,
        `agencia-pu-${suffix}`,
      );
      await addMember(org.id, await createUser(providerEmail), "provider");

      const cookie = await signIn(providerEmail, password);
      await setActiveOrg(cookie, org.id);

      const res = await putProduct(cookie, "producto-de-este-proveedor");
      expect(res.status).toBe(200);
    });

    it("agente sin product:update recibe 403", async () => {
      const ownerEmail = `owner-ag-${suffix}@example.com`;
      const agentEmail = `agent-ag-${suffix}@example.com`;
      const org = await createAgency(
        await createUser(ownerEmail),
        `Agencia AG ${suffix}`,
        `agencia-ag-${suffix}`,
      );
      await addMember(org.id, await createUser(agentEmail), "agent");

      const cookie = await signIn(agentEmail, password);
      await setActiveOrg(cookie, org.id);

      const res = await putProduct(cookie, "cualquier-producto");
      expect(res.status).toBe(403);
    });

    it("cliente sin organización recibe 403", async () => {
      const email = `client-pu-${suffix}@example.com`;
      await createUser(email);
      const cookie = await signIn(email, password);

      const res = await putProduct(cookie, "cualquier-producto");
      expect(res.status).toBe(403);
    });

    it("owner invita a un proveedor: 200", async () => {
      const ownerEmail = `owner-in-${suffix}@example.com`;
      const org = await createAgency(
        await createUser(ownerEmail),
        `Agencia IN ${suffix}`,
        `agencia-in-${suffix}`,
      );
      const cookie = await signIn(ownerEmail, password);
      await setActiveOrg(cookie, org.id);

      const res = await inviteMember(cookie, org.id, `invitado-${suffix}@example.com`, "provider");
      expect(res.status).toBe(200);
    });

    it("proveedor no puede invitar: 403", async () => {
      const ownerEmail = `owner-iv-${suffix}@example.com`;
      const providerEmail = `provider-iv-${suffix}@example.com`;
      const org = await createAgency(
        await createUser(ownerEmail),
        `Agencia IV ${suffix}`,
        `agencia-iv-${suffix}`,
      );
      await addMember(org.id, await createUser(providerEmail), "provider");
      const cookie = await signIn(providerEmail, password);
      await setActiveOrg(cookie, org.id);

      const res = await inviteMember(cookie, org.id, `otro-${suffix}@example.com`, "provider");
      expect(res.status).toBe(403);
    });

    it("un usuario no crea agencias por HTTP: 403", async () => {
      const email = `solo-${suffix}@example.com`;
      await createUser(email);
      const cookie = await signIn(email, password);

      const res = await fetch(`${baseUrl}/api/auth/organization/create`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin },
        body: JSON.stringify({ name: `Agencia HTTP ${suffix}`, slug: `agencia-http-${suffix}` }),
      });
      expect(res.status).toBe(403);
    });

    it("un usuario de sistema no accede a endpoints de plataforma: 403", async () => {
      const email = `plano-${suffix}@example.com`;
      await createUser(email);
      const cookie = await signIn(email, password);

      const res = await fetch(`${baseUrl}/api/auth/admin/list-users`, {
        headers: { cookie, origin },
      });
      expect(res.status).toBe(403);
    });
  });

  /**
   * Alta de usuario por la API de servidor: el HTTP de registro limita a 5
   * por minuto por IP y crear datos no es el comportamiento bajo prueba.
   */
  async function createUser(email: string): Promise<string> {
    const { user } = await auth.api.signUpEmail({
      body: { name: `Usuario ${suffix}`, email, password },
    });
    return user.id;
  }

  async function signIn(email: string, userPassword: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: userPassword }),
    });
    if (!res.ok) {
      throw new Error(`sign-in falló: ${await res.text()}`);
    }
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.startsWith("better-auth.session_token"));
    return session?.split(";")[0] ?? "";
  }

  /**
   * Accion de sistema (matriz T-F0-6): sin sesion y con userId es la unica
   * via de alta de agencias con allowUserToCreateOrganization: false.
   */
  async function createAgency(userId: string, name: string, slug: string): Promise<{ id: string }> {
    return auth.api.createOrganization({
      body: { name, slug, userId },
    });
  }

  /**
   * Membresia directa para fijar el rol; el flujo de invitacion se prueba
   * aparte. id y createdAt los genera Better Auth en la capa de aplicacion
   * (el modelo no tiene defaults de BD), asi que aqui se aportan a mano.
   */
  async function addMember(organizationId: string, userId: string, role: string): Promise<void> {
    await prisma.member.create({
      data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
    });
  }

  async function setActiveOrg(cookie: string, organizationId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/auth/organization/set-active`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ organizationId }),
    });
    if (!res.ok) {
      throw new Error(`set-active falló: ${await res.text()}`);
    }
    // El endpoint responde 200 con null cuando no fija nada (cuerpo sin
    // clave reconocida): que falle ruidoso y no silencioso.
    const org = (await res.json()) as { id: string } | null;
    if (!org || org.id !== organizationId) {
      throw new Error("set-active no fijó la organización activa");
    }
  }

  async function putProduct(cookie: string, id: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/products/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({}),
    });
  }

  async function inviteMember(
    cookie: string,
    organizationId: string,
    email: string,
    role: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ email, role, organizationId }),
    });
  }
});
