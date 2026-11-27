import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { addDays } from "../src/catalog/catalog.schemas.js";
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
 * E2E del reporte de ventas (T-F2-23, delta de reports). Monta dos agencias con
 * sesiones reales de Better Auth y pagos con fechas, métodos y estados distintos
 * por Prisma (fixture), y ejercita por HTTP el rango inclusivo, los totales
 * congelados, el desglose, la matriz de roles y el CSV de la misma ruta.
 */
interface ProblemBody {
  status: number;
  code: string;
  detail: string;
  errors?: Array<{ path: string; message: string }>;
}

interface ReportRow {
  method: string;
  status: string;
  count: number;
  amountUsd: string;
  amountVes: string;
}

interface SalesReport {
  from: string;
  to: string;
  agencyId: string | null;
  totals: { count: number; amountUsd: string; amountVes: string };
  breakdown: ReportRow[];
}

describe("reports (reporte de ventas del panel)", () => {
  let app: ApiApplication;
  let baseUrl: string;

  const suffix = randomUUID().slice(0, 8);
  const from = addDays(todayInCaracas(), -5);
  const to = todayInCaracas();
  const range = `from=${from}&to=${to}`;

  let orgA: string = randomUUID();
  let orgB: string = randomUUID();
  const rateA = randomUUID();
  const rateB = randomUUID();
  const rateCurrent = randomUUID();
  const bookingA = randomUUID();
  const bookingB = randomUUID();

  const userIds: string[] = [];
  let adminACookie = "";
  let ownerACookie = "";
  let agencyAdminCookie = "";
  let agentACookie = "";
  let providerACookie = "";
  let memberACookie = "";
  let adminBCookie = "";
  let superCookie = "";

  async function createPayment(params: {
    tenantId: string;
    bookingId: string;
    rateId: string;
    reporterId: string;
    method: "PAGO_MOVIL" | "ZELLE" | "BINANCE_PAY";
    status: "APPROVED" | "IN_REVIEW" | "REJECTED";
    amountUsd: string;
    amountVes: string;
    createdAt: string;
    reference: string;
  }): Promise<void> {
    await prisma.payment.create({
      data: {
        id: randomUUID(),
        tenantId: params.tenantId,
        bookingId: params.bookingId,
        method: params.method,
        amountUsd: params.amountUsd,
        amountVes: params.amountVes,
        exchangeRateId: params.rateId,
        rate: "900.0000",
        valueDate: new Date(`${to}T12:00:00Z`),
        reference: `${params.reference}-${randomUUID().slice(0, 8)}`,
        status: params.status,
        reportedBy: params.reporterId,
        reviewedBy: params.status === "IN_REVIEW" ? null : params.reporterId,
        reviewedAt: params.status === "IN_REVIEW" ? null : new Date(params.createdAt),
        rejectionReason: params.status === "REJECTED" ? "Motivo de prueba" : null,
        paidAt: params.status === "APPROVED" ? new Date(params.createdAt) : null,
        createdAt: new Date(params.createdAt),
      },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const adminA = await userWithTotp(baseUrl, `admin-reports-a-${suffix}@example.com`);
    userIds.push(adminA.userId);
    orgA = (await createAgency(adminA.userId, `Reportes A ${suffix}`, `reportes-a-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminA.cookie, orgA);
    adminACookie = adminA.cookie;

    const ownerA = await userWithTotp(baseUrl, `owner-reports-a-${suffix}@example.com`);
    userIds.push(ownerA.userId);
    await addMember(orgA, ownerA.userId, "owner");
    await setActiveOrg(baseUrl, ownerA.cookie, orgA);
    ownerACookie = ownerA.cookie;

    // Admin de agencia, sin rol de plataforma: según la spec aprobada lee su
    // propio reporte, igual que el owner, pero no el de otra agencia.
    const agencyAdmin = await userWithTotp(baseUrl, `admin-member-reports-${suffix}@example.com`);
    userIds.push(agencyAdmin.userId);
    await addMember(orgA, agencyAdmin.userId, "admin");
    await setActiveOrg(baseUrl, agencyAdmin.cookie, orgA);
    agencyAdminCookie = agencyAdmin.cookie;

    for (const [role, label] of [
      ["agent", "agente"],
      ["provider", "proveedor"],
      ["member", "miembro"],
    ] as const) {
      const email = `${label}-reports-${suffix}@example.com`;
      const id = await createUser(email);
      userIds.push(id);
      await addMember(orgA, id, role);
      const cookie = await signIn(baseUrl, email);
      await setActiveOrg(baseUrl, cookie, orgA);
      if (role === "agent") agentACookie = cookie;
      if (role === "provider") providerACookie = cookie;
      if (role === "member") memberACookie = cookie;
    }

    const adminB = await userWithTotp(baseUrl, `admin-reports-b-${suffix}@example.com`);
    userIds.push(adminB.userId);
    orgB = (await createAgency(adminB.userId, `Reportes B ${suffix}`, `reportes-b-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminB.cookie, orgB);
    adminBCookie = adminB.cookie;

    const superAdmin = await userWithTotp(baseUrl, `super-reports-${suffix}@example.com`);
    userIds.push(superAdmin.userId);
    await prisma.user.update({
      where: { id: superAdmin.userId },
      data: { role: "super_admin" },
    });
    superCookie = superAdmin.cookie;

    for (const entry of [
      { id: rateA, tenantId: orgA },
      { id: rateB, tenantId: orgB },
    ]) {
      await prisma.exchangeRate.create({
        data: {
          id: entry.id,
          tenantId: entry.tenantId,
          source: "COTIZAVE",
          rate: "900.0000",
          valueDate: new Date(`${to}T12:00:00Z`),
          fetchedAt: new Date(),
          isOverride: false,
          createdBy: adminA.userId,
        },
      });
    }
    // Tasa vigente distinta: si el reporte la usara, los VES cambiarían.
    await prisma.exchangeRate.create({
      data: {
        id: rateCurrent,
        tenantId: null,
        source: "BCV",
        rate: "2000.0000",
        valueDate: new Date(`${to}T12:00:00Z`),
        fetchedAt: new Date(),
        isOverride: false,
      },
    });

    for (const entry of [
      { id: bookingA, tenantId: orgA, reporterId: adminA.userId },
      { id: bookingB, tenantId: orgB, reporterId: adminB.userId },
    ]) {
      await prisma.booking.create({
        data: {
          id: entry.id,
          tenantId: entry.tenantId,
          code: generateBookingCode(),
          userId: entry.reporterId,
          status: "PENDING_PAYMENT",
          totalUsd: "100.00",
          travelers: [
            {
              fullName: "Ana Pérez",
              documentType: "V",
              documentNumber: "12345678",
              phone: "+584141234567",
              email: "ana@example.com",
            },
          ],
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
    }

    const common = { reporterId: adminA.userId, reference: "sin-datos-de-tarjeta" };
    await createPayment({
      ...common,
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      method: "ZELLE",
      status: "APPROVED",
      amountUsd: "100.00",
      amountVes: "90000.00",
      createdAt: `${from}T00:00:00-04:00`,
    });
    await createPayment({
      ...common,
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      method: "BINANCE_PAY",
      status: "IN_REVIEW",
      amountUsd: "50.50",
      amountVes: "45450.00",
      createdAt: `${to}T23:59:59-04:00`,
    });
    await createPayment({
      ...common,
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      method: "PAGO_MOVIL",
      status: "REJECTED",
      amountUsd: "20.00",
      amountVes: "18000.00",
      createdAt: `${addDays(from, 2)}T12:00:00-04:00`,
    });
    await createPayment({
      ...common,
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      method: "ZELLE",
      status: "APPROVED",
      amountUsd: "999.00",
      amountVes: "899100.00",
      createdAt: `${addDays(from, -1)}T12:00:00-04:00`,
    });
    await createPayment({
      tenantId: orgB,
      bookingId: bookingB,
      rateId: rateB,
      reporterId: adminB.userId,
      reference: "CVV-123-TARJETA-4111111111111111-token-secreto",
      method: "ZELLE",
      status: "APPROVED",
      amountUsd: "200.00",
      amountVes: "180000.00",
      createdAt: `${addDays(from, 3)}T12:00:00-04:00`,
    });
  });

  afterAll(async () => {
    if (orgA && orgB) {
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await prisma.exchangeRate.deleteMany({ where: { id: rateCurrent } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app?.close();
  });

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  async function call(path: string, cookie = ""): Promise<Response> {
    return fetch(url(`/admin/reports/sales${path}`), {
      headers: { origin: authOrigin, ...(cookie ? { cookie } : {}) },
    });
  }

  async function expectProblem(
    res: Response,
    status: number,
    code: string,
  ): Promise<ProblemBody> {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as ProblemBody;
    expect(body).toMatchObject({ status, code });
    return body;
  }

  async function report(path: string, cookie = adminACookie): Promise<SalesReport> {
    const res = await call(path, cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as SalesReport;
  }

  it("filtra por rango inclusivo de fechas de pago y por agencia permitida", async () => {
    const own = await report(`?${range}`);
    expect(own).toMatchObject({ from, to, agencyId: null });
    expect(own.totals.count).toBe(3);

    const foreign = await report(`?${range}&agencyId=${orgB}`);
    expect(foreign).toMatchObject({ from, to, agencyId: orgB });
    expect(foreign.totals).toEqual({ count: 0, amountUsd: "0.00", amountVes: "0.00" });
    expect(foreign.breakdown).toEqual([]);

    const oneDay = await report(`?from=${to}&to=${to}`);
    expect(oneDay.totals.count).toBe(1);

    const inverted = await call(`?from=${to}&to=${from}`, adminACookie);
    await expectProblem(inverted, 422, "VALIDATION_ERROR");
    const invalid = await call("?from=2026-13-99&to=2026-11-25", adminACookie);
    const problem = await expectProblem(invalid, 422, "VALIDATION_ERROR");
    expect(problem.errors?.some((issue) => issue.path === "from")).toBe(true);
    const unknown = await call(`?${range}&totalUsd=1`, adminACookie);
    await expectProblem(unknown, 422, "VALIDATION_ERROR");
  });

  it("calcula totales DECIMAL de todos los estados sin usar la tasa vigente", async () => {
    const own = await report(`?${range}`);
    expect(own.totals).toEqual({ count: 3, amountUsd: "170.50", amountVes: "153450.00" });

    // Otras suites crean pagos en el mismo rango: el modo plataforma se
    // comprueba con filtros exactos por agencia y con una vista sin filtrar
    // que incluye ambas, no con totales globales que dependan del orden.
    const platformA = await report(`?${range}&agencyId=${orgA}`, superCookie);
    expect(platformA.totals).toEqual(own.totals);
    const platformB = await report(`?${range}&agencyId=${orgB}`, superCookie);
    expect(platformB.totals).toEqual({ count: 1, amountUsd: "200.00", amountVes: "180000.00" });
    const platform = await report(`?${range}`, superCookie);
    expect(platform.totals.count).toBeGreaterThanOrEqual(4);
  });

  it("desglosa por método y estado sin filas inventarias", async () => {
    const own = await report(`?${range}`);
    // El orden sigue el de los enum de PostgreSQL (PAGO_MOVIL, ZELLE,
    // BINANCE_PAY), no el alfabético: es estable y no requiere ordenar en JS.
    expect(own.breakdown).toEqual([
      {
        method: "PAGO_MOVIL",
        status: "REJECTED",
        count: 1,
        amountUsd: "20.00",
        amountVes: "18000.00",
      },
      {
        method: "ZELLE",
        status: "APPROVED",
        count: 1,
        amountUsd: "100.00",
        amountVes: "90000.00",
      },
      {
        method: "BINANCE_PAY",
        status: "IN_REVIEW",
        count: 1,
        amountUsd: "50.50",
        amountVes: "45450.00",
      },
    ]);

    const empty = await report(`?from=2020-01-01&to=2020-01-02`);
    expect(empty.totals).toEqual({ count: 0, amountUsd: "0.00", amountVes: "0.00" });
    expect(empty.breakdown).toEqual([]);
  });

  it("aplica la matriz de roles y el modo plataforma sin escribir nada", async () => {
    await expectProblem(await call(`?${range}`, ""), 401, "UNAUTHENTICATED");
    for (const cookie of [agentACookie, providerACookie, memberACookie]) {
      const res = await call(`?${range}`, cookie);
      const body = await expectProblem(res, 403, "FORBIDDEN");
      expect(body).not.toHaveProperty("totals");
    }
    const owner = await report(`?${range}`, ownerACookie);
    expect(owner.totals.count).toBe(3);
    const agencyAdmin = await report(`?${range}`, agencyAdminCookie);
    expect(agencyAdmin.totals).toEqual({ count: 3, amountUsd: "170.50", amountVes: "153450.00" });
    const agencyAdminForeign = await report(`?${range}&agencyId=${orgB}`, agencyAdminCookie);
    expect(agencyAdminForeign.totals).toEqual({ count: 0, amountUsd: "0.00", amountVes: "0.00" });
    const adminB = await report(`?${range}`, adminBCookie);
    expect(adminB.totals).toEqual({ count: 1, amountUsd: "200.00", amountVes: "180000.00" });

    const superAll = await report(`?${range}`, superCookie);
    expect(superAll.totals.count).toBeGreaterThanOrEqual(4);
    const superA = await report(`?${range}&agencyId=${orgA}`, superCookie);
    expect(superA.totals).toEqual({ count: 3, amountUsd: "170.50", amountVes: "153450.00" });
    const superB = await report(`?${range}&agencyId=${orgB}`, superCookie);
    expect(superB.totals.amountUsd).toBe("200.00");
    const missing = await report(`?${range}&agencyId=${randomUUID()}`, superCookie);
    expect(missing.totals.count).toBe(0);
  });

  it("devuelve el mismo 401/403 en CSV que en JSON sin sesión o con rol sin permiso", async () => {
    // El delta reports exige que format=csv comparta validaciones y alcance:
    // el guard corre antes de elegir el formato de respuesta.
    const jsonNoSession = await call(`?${range}`, "");
    const csvNoSession = await call(`?${range}&format=csv`, "");
    expect(csvNoSession.status).toBe(jsonNoSession.status);
    await expectProblem(csvNoSession, 401, "UNAUTHENTICATED");

    for (const cookie of [agentACookie, providerACookie, memberACookie]) {
      const json = await call(`?${range}`, cookie);
      const csv = await call(`?${range}&format=csv`, cookie);
      expect(csv.status).toBe(json.status);
      const body = await expectProblem(csv, 403, "FORBIDDEN");
      expect(body).not.toHaveProperty("totals");
    }
  });

  it("sirve el CSV por la misma ruta con los mismos filtros, idioma y alcance", async () => {
    const es = await call(`?${range}&format=csv`, adminACookie);
    expect(es.status).toBe(200);
    expect(es.headers.get("content-type")).toContain("text/csv");
    const lines = (await es.text()).trim().split(/\r?\n/);
    expect(lines[0]).toBe("Método,Estado,Recuento,Suma USD,Suma VES");
    expect(lines).toContain("ZELLE,APPROVED,1,100.00,90000.00");
    expect(lines.at(-1)).toBe("TOTAL,,3,170.50,153450.00");
    const csv = lines.join("\n");
    expect(csv).not.toContain("CVV");
    expect(csv).not.toContain("4111111111111111");
    expect(csv).not.toContain("token-secreto");

    const en = await call(`?${range}&format=csv&lang=en`, adminACookie);
    expect(en.status).toBe(200);
    expect((await en.text()).split(/\r?\n/)[0]).toBe("Method,Status,Count,Sum USD,Sum VES");

    const foreign = await call(`?${range}&format=csv&agencyId=${orgB}`, adminACookie);
    expect((await foreign.text()).trim()).toBe("Método,Estado,Recuento,Suma USD,Suma VES");

    const superCsv = await call(`?${range}&format=csv&agencyId=${orgB}`, superCookie);
    expect((await superCsv.text())).toContain("200.00,180000.00");

    // Sin límite ni paginación: el contrato rechaza un parámetro inventado.
    await expectProblem(await call(`?${range}&format=csv&limit=1`, adminACookie), 422, "VALIDATION_ERROR");
  });
});
