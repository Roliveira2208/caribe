import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REDACTED } from "../src/audit/audit-sanitize.js";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
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
 * Escenarios obligatorios del delta `audit` de f2-admin-rates (T-F2-15):
 * filtros y cursor, alcance por agencia, modo plataforma, roles sin permiso y
 * respuesta sin secretos. El visor reutiliza los endpoints existentes.
 */
describe("audit: visor con filtros y cursor (T-F2-15)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);
  const action = "f2.audit.cursor";
  const entity = "TestEntity";
  const baseAt = new Date("2026-11-20T12:00:00.000Z");

  let orgA: string;
  let orgB: string;
  let actorId: string;
  let adminCookie: string;
  let agentCookie: string;
  let memberCookie: string;
  let superCookie: string;
  const expectedIds: string[] = [];

  function at(minutes: number): Date {
    return new Date(baseAt.getTime() + minutes * 60_000);
  }

  async function get(path: string, cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1${path}`, {
      headers: { cookie, origin: authOrigin },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const ownerA = await createUser(`owner-f2audit-a-${suffix}@example.com`);
    orgA = (await createAgency(ownerA, `F2 Auditoría A ${suffix}`, `f2audit-a-${suffix}`)).id;
    const admin = await userWithTotp(baseUrl, `admin-f2audit-a-${suffix}@example.com`);
    actorId = admin.userId;
    await addMember(orgA, actorId, "admin");
    adminCookie = admin.cookie;
    await setActiveOrg(baseUrl, adminCookie, orgA);

    const agentId = await createUser(`agent-f2audit-a-${suffix}@example.com`);
    await addMember(orgA, agentId, "agent");
    agentCookie = await signIn(baseUrl, `agent-f2audit-a-${suffix}@example.com`);
    await setActiveOrg(baseUrl, agentCookie, orgA);

    const memberId = await createUser(`member-f2audit-a-${suffix}@example.com`);
    await addMember(orgA, memberId, "member");
    memberCookie = await signIn(baseUrl, `member-f2audit-a-${suffix}@example.com`);
    await setActiveOrg(baseUrl, memberCookie, orgA);

    const ownerB = await createUser(`owner-f2audit-b-${suffix}@example.com`);
    orgB = (await createAgency(ownerB, `F2 Auditoría B ${suffix}`, `f2audit-b-${suffix}`)).id;

    const superAdmin = await userWithTotp(baseUrl, `super-f2audit-${suffix}@example.com`);
    await prisma.user.update({
      where: { id: superAdmin.userId },
      data: { role: "super_admin" },
    });
    superCookie = superAdmin.cookie;

    // Cinco filas de la agencia A: dos comparten `at` para comprobar el
    // desempate por id del cursor keyset. El resto son ruido de otros filtros
    // y de otros ámbitos.
    for (let index = 0; index < 5; index += 1) {
      const id = randomUUID();
      expectedIds.push(id);
      await prisma.auditLog.create({
        data: {
          id,
          tenantId: orgA,
          actorId,
          action,
          entity,
          entityId: `f2-a-${index}-${suffix}`,
          at: at(index === 4 ? 3 : index),
        },
      });
    }
    await prisma.auditLog.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: orgA,
          actorId,
          action: "otro.action",
          entity,
          entityId: `otro-${suffix}`,
          at: at(4),
        },
        {
          id: randomUUID(),
          tenantId: orgB,
          actorId,
          action,
          entity,
          entityId: `f2-b-${suffix}`,
          at: at(5),
        },
        {
          id: randomUUID(),
          tenantId: null,
          actorId: null,
          action,
          entity,
          entityId: `f2-platform-${suffix}`,
          at: at(6),
        },
        {
          id: randomUUID(),
          tenantId: orgA,
          actorId,
          action,
          entity,
          entityId: `f2-secret-${suffix}`,
          at: at(7),
          after: { password: "super-secreto", rate: "950.0000" },
        },
      ],
    });
    expectedIds.push(
      ...(
        await prisma.auditLog.findMany({
          where: { entityId: `f2-secret-${suffix}` },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("filtra por acción, entidad, actor y rango y recorre el cursor sin duplicados ni huecos", async () => {
    const query =
      `?action=${action}&entity=${entity}&actor=${actorId}` +
      `&from=${encodeURIComponent(at(-1).toISOString())}` +
      `&to=${encodeURIComponent(at(8).toISOString())}&limit=2`;
    const first = await get(`/admin/audit-logs${query}`, adminCookie);
    expect(first.status).toBe(200);
    const pageOne = (await first.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(pageOne.items).toHaveLength(2);
    expect(typeof pageOne.nextCursor).toBe("string");

    const seen = [...pageOne.items.map((row) => row.id)];
    let cursor = pageOne.nextCursor as string;
    let pages = 1;
    while (cursor) {
      const res = await get(`/admin/audit-logs${query}&cursor=${encodeURIComponent(cursor)}`, adminCookie);
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? "";
      pages += 1;
      expect(pages).toBeLessThan(10);
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...expectedIds].sort());
  });

  it("rechaza claves desconocidas, parámetros repetidos y un cursor ilegible", async () => {
    for (const path of [
      `/admin/audit-logs?${action}=1`,
      `/admin/audit-logs?action=${action}&action=otro.action`,
      "/admin/audit-logs?cursor=no-es-un-cursor",
    ]) {
      const res = await get(path, adminCookie);
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("el admin de agencia ve solo su tenant; agente y member reciben 403", async () => {
    const admin = await get("/admin/audit-logs", adminCookie);
    expect(admin.status).toBe(200);
    const { items } = (await admin.json()) as { items: Array<{ tenantId: string | null }> };
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((row) => row.tenantId === orgA)).toBe(true);
    expect(items.some((row) => row.tenantId === orgB || row.tenantId === null)).toBe(false);

    for (const cookie of [agentCookie, memberCookie]) {
      const res = await get("/admin/audit-logs", cookie);
      expect(res.status).toBe(403);
    }
  });

  it("el Super Admin lee plataforma y todas las agencias en modo lectura", async () => {
    const res = await get(
      `/admin/audit-logs?action=${action}&entity=${entity}&limit=100`,
      superCookie,
    );
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as {
      items: Array<{ tenantId: string | null; entityId: string }>;
    };
    expect(items.some((row) => row.tenantId === null)).toBe(true);
    expect(items.some((row) => row.tenantId === orgA)).toBe(true);
    expect(items.some((row) => row.tenantId === orgB)).toBe(true);
    expect(items.some((row) => row.entityId === `f2-platform-${suffix}`)).toBe(true);
    expect(items.some((row) => row.entityId === `f2-b-${suffix}`)).toBe(true);
  });

  it("no expone secretos aunque la fila los contuviera antes de redactarse", async () => {
    const res = await get(`/admin/audit-logs?action=${action}&limit=100`, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const secret = body.items.find((row) => row["entityId"] === `f2-secret-${suffix}`);
    expect(secret).toBeDefined();
    expect(secret?.["after"]).toMatchObject({ password: REDACTED, rate: "950.0000" });
    const forbidden = ["password", "token", "cookie", "body", "message"];
    expect(
      body.items.some((row) => forbidden.some((key) => Object.keys(row).includes(key))),
    ).toBe(false);
    expect(Object.keys(secret ?? {}).sort()).toEqual(
      ["action", "actorId", "after", "at", "before", "entity", "entityId", "id", "ip", "tenantId"].sort(),
    );
  });
});
