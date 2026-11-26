import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import { authOrigin, createAgency, userWithTotp } from "./auth-helpers.js";

/**
 * E2E del listado de agencias para el filtro de reportes (T-F2-23, delta de
 * auth-access). El Super Admin sin membresías ve TODAS las agencias; un rol de
 * agencia recibe 403 y no obtiene opciones.
 */
interface AgencyOption {
  id: string;
  name: string;
  slug: string;
}

describe("auth-access › listado de agencias para el filtro de reportes", () => {
  let app: ApiApplication;
  let baseUrl: string;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let superCookie = "";
  let ownerCookie = "";

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const owner = await userWithTotp(baseUrl, `owner-org-list-${suffix}@example.com`);
    userIds.push(owner.userId);
    const agencyA = await createAgency(
      owner.userId,
      `Agencia A ${suffix}`,
      `agencia-a-${suffix}`,
    );
    orgIds.push(agencyA.id);
    ownerCookie = owner.cookie;

    const otherOwner = await userWithTotp(baseUrl, `owner-org-list-b-${suffix}@example.com`);
    userIds.push(otherOwner.userId);
    const agencyB = await createAgency(
      otherOwner.userId,
      `Agencia B ${suffix}`,
      `agencia-b-${suffix}`,
    );
    orgIds.push(agencyB.id);

    const platform = await userWithTotp(baseUrl, `super-org-list-${suffix}@example.com`);
    userIds.push(platform.userId);
    await prisma.user.update({
      where: { id: platform.userId },
      data: { role: "super_admin" },
    });
    superCookie = platform.cookie;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app?.close();
  });

  async function call(cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/organizations`, {
      headers: { origin: authOrigin, cookie },
    });
  }

  it("devuelve todas las agencias al Super Admin sin memberships ni opciones ajenas", async () => {
    const response = await call(superCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as AgencyOption[];
    expect(body).toEqual(
      expect.arrayContaining([
        { id: orgIds[0], name: `Agencia A ${suffix}`, slug: `agencia-a-${suffix}` },
        { id: orgIds[1], name: `Agencia B ${suffix}`, slug: `agencia-b-${suffix}` },
      ]),
    );
    for (const agency of body) {
      expect(Object.keys(agency).sort()).toEqual(["id", "name", "slug"]);
    }
    expect(body.findIndex((agency) => agency.id === orgIds[0])).toBeLessThan(
      body.findIndex((agency) => agency.id === orgIds[1]),
    );

    const forbidden = await call(ownerCookie);
    expect(forbidden.status).toBe(403);
  });
});
