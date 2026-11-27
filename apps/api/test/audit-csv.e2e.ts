import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * E2E del CSV de auditoría (T-F2-25). Filas de dos agencias y de plataforma
 * montadas por Prisma, con payloads que contienen secretos, y sesiones reales
 * para comprobar filtros, cursor, alcance, idioma y columnas permitidas.
 */
interface AuditLogPage {
  items: Array<{ id: string; before: unknown; after: unknown }>;
  nextCursor: string | null;
}

describe("audit: exportación CSV (T-F2-25)", () => {
  let app: ApiApplication;
  let baseUrl: string;

  const suffix = randomUUID().slice(0, 8);
  let orgA: string = randomUUID();
  let orgB: string = randomUUID();
  const idA1 = randomUUID();
  const idA2 = randomUUID();
  const idA3 = randomUUID();
  const idB = randomUUID();
  const idPlatform = randomUUID();
  const idFormula = randomUUID();
  const formulaAction = "=SUM(1+1)";

  let adminAId = "";
  let adminACookie = "";
  let agentACookie = "";
  let superCookie = "";
  const userIds: string[] = [];

  const baseTime = Date.now();
  const from = new Date(baseTime - 60 * 60_000).toISOString();
  const to = new Date(baseTime + 60 * 60_000).toISOString();

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const ownerA = await createUser(`owner-audit-csv-a-${suffix}@example.com`);
    userIds.push(ownerA);
    orgA = (await createAgency(ownerA, `Auditoría CSV A ${suffix}`, `audit-csv-a-${suffix}`)).id;

    const adminA = await userWithTotp(baseUrl, `admin-audit-csv-a-${suffix}@example.com`);
    userIds.push(adminA.userId);
    adminAId = adminA.userId;
    await addMember(orgA, adminAId, "admin");
    await setActiveOrg(baseUrl, adminA.cookie, orgA);
    adminACookie = adminA.cookie;

    const agentEmail = `agent-audit-csv-a-${suffix}@example.com`;
    const agentId = await createUser(agentEmail);
    userIds.push(agentId);
    await addMember(orgA, agentId, "agent");
    agentACookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, agentACookie, orgA);

    const ownerB = await createUser(`owner-audit-csv-b-${suffix}@example.com`);
    userIds.push(ownerB);
    orgB = (await createAgency(ownerB, `Auditoría CSV B ${suffix}`, `audit-csv-b-${suffix}`)).id;

    const superAdmin = await userWithTotp(baseUrl, `super-audit-csv-${suffix}@example.com`);
    userIds.push(superAdmin.userId);
    await prisma.user.update({
      where: { id: superAdmin.userId },
      data: { role: "super_admin" },
    });
    superCookie = superAdmin.cookie;

    const secret = `token-${suffix}`;
    await prisma.auditLog.createMany({
      data: [
        {
          id: idA1,
          tenantId: orgA,
          actorId: adminAId,
          action: "csv.test.review",
          entity: "payment",
          entityId: `a-1-${suffix}`,
          before: { status: "IN_REVIEW", password: "Password123!" },
          after: { status: "APPROVED", token: secret, internalMessage: "stack trace" },
          ip: "127.0.0.1",
          at: new Date(baseTime - 5 * 60_000),
        },
        {
          id: idA2,
          tenantId: orgA,
          actorId: adminAId,
          action: "csv.test.review",
          entity: "payment",
          entityId: `a-2-${suffix}`,
          before: { status: "PENDING_PAYMENT" },
          after: { status: "CONFIRMED" },
          ip: null,
          at: new Date(baseTime - 10 * 60_000),
        },
        {
          id: idA3,
          tenantId: orgA,
          actorId: adminAId,
          action: "csv.test.review",
          entity: "payment",
          entityId: `a-3-${suffix}`,
          before: { status: "REJECTED" },
          after: { status: "REFUNDED" },
          ip: "127.0.0.2",
          at: new Date(baseTime - 15 * 60_000),
        },
        {
          id: idFormula,
          tenantId: orgA,
          actorId: adminAId,
          action: formulaAction,
          entity: "payment",
          entityId: `formula-${suffix}`,
          at: new Date(baseTime - 20 * 60_000),
        },
        {
          id: idB,
          tenantId: orgB,
          actorId: randomUUID(),
          action: "csv.test.review",
          entity: "payment",
          entityId: `b-${suffix}`,
          before: { status: "IN_REVIEW", password: "Password123!" },
          after: { status: "REJECTED", token: secret },
          at: new Date(baseTime - 25 * 60_000),
        },
        {
          id: idPlatform,
          tenantId: null,
          actorId: null,
          action: "csv.test.platform",
          entity: "organization",
          entityId: `platform-${suffix}`,
          at: new Date(baseTime - 30 * 60_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app?.close();
  });

  function url(path: string): string {
    return `${baseUrl}/api/v1/admin/audit-logs${path}`;
  }

  async function call(path: string, cookie: string): Promise<Response> {
    return fetch(url(path), {
      headers: { origin: authOrigin, ...(cookie ? { cookie } : {}) },
    });
  }

  async function json(path: string, cookie = adminACookie): Promise<AuditLogPage> {
    const res = await call(path, cookie);
    if (res.status !== 200) {
      throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as AuditLogPage;
  }

  async function csv(path: string, cookie = adminACookie): Promise<string> {
    const res = await call(path, cookie);
    if (res.status !== 200) {
      throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
    }
    expect(res.headers.get("content-type")).toContain("text/csv; charset=utf-8");
    return res.text();
  }

  it("aplica los mismos filtros, límite y cursor que el JSON", async () => {
    const query = `?action=csv.test.review&entity=payment&actor=${adminAId}&from=${from}&to=${to}&limit=2`;
    const first = await json(query);
    expect(first.items.map((item) => item.id)).toEqual([idA1, idA2]);
    expect(first.nextCursor).toBeTruthy();

    const firstCsv = await csv(`${query}&format=csv`);
    expect(firstCsv).toContain(idA1);
    expect(firstCsv).toContain(idA2);
    expect(firstCsv).not.toContain(idA3);

    const nextQuery = `${query}&cursor=${encodeURIComponent(first.nextCursor ?? "")}`;
    const second = await json(nextQuery);
    const secondCsv = await csv(`${nextQuery}&format=csv`);
    expect(second.items.map((item) => item.id)).toEqual([idA3]);
    expect(secondCsv).toContain(idA3);
    expect(secondCsv).not.toContain(idA1);
  });

  it("respeta el alcance por rol y la aislación entre agencias", async () => {
    const own = await csv("?format=csv");
    expect(own).toContain(idA1);
    expect(own).toContain(idFormula);
    expect(own).not.toContain(idB);
    expect(own).not.toContain(idPlatform);
    expect(own).not.toContain(orgB);

    const platform = await csv("?format=csv", superCookie);
    expect(platform).toContain(idB);
    expect(platform).toContain(idPlatform);
    expect(platform).toContain(idA1);

    const agent = await call("?format=csv", agentACookie);
    expect(agent.status).toBe(403);
    expect(agent.headers.get("content-type")).not.toContain("text/csv");
  });

  it("localiza encabezados y estados, sin secretos ni mensajes internos", async () => {
    const query = `?action=csv.test.review&entity=payment&actor=${adminAId}&from=${from}&to=${to}`;
    const es = await csv(`${query}&format=csv`);
    expect(es.split(/\r?\n/)[0]).toBe(
      "ID,Fecha,Actor,Acción,Entidad,ID de entidad,Estado anterior,Estado nuevo,IP",
    );
    expect(es).toContain("En revisión,Aprobado");
    expect(es).toContain("Pago pendiente,Confirmada");

    const en = await csv(`${query}&format=csv&lang=en`);
    expect(en.split(/\r?\n/)[0]).toBe(
      "ID,Date,Actor,Action,Entity,Entity ID,Previous status,New status,IP",
    );
    expect(en).toContain("Under review,Approved");
    expect(en).toContain("Pending payment,Confirmed");

    for (const body of [es, en, await csv("?format=csv", superCookie)]) {
      expect(body).not.toContain("tenantId");
      expect(body).not.toContain("tenant_id");
      expect(body).not.toContain(orgA);
      expect(body).not.toContain(orgB);
      expect(body).not.toContain("Password123!");
      expect(body).not.toContain(`token-${suffix}`);
      expect(body).not.toContain("stack trace");
      expect(body).not.toContain("internalMessage");
    }
  });

  it("escapa fórmulas en las celdas controladas por el dato", async () => {
    const body = await csv(
      `?action=${encodeURIComponent(formulaAction)}&format=csv&lang=en`,
    );

    expect(body).toContain("'=SUM(1+1)");
  });
});
