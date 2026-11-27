import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { prisma } from "../src/prisma.js";
import {
  addMember,
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E del CSV de pagos (T-F2-25). Monta dos agencias con sesiones reales y
 * pagos por Prisma, y comprueba por HTTP que `format=csv` comparte ruta,
 * filtros, cursor, idioma y alcance con el JSON, sin secretos ni otra agencia.
 */
interface ProblemBody {
  status: number;
  code: string;
}

interface PaymentPage {
  items: Array<{
    id: string;
    amountUsd: string;
    amountVes: string;
    rate: string;
  }>;
  nextCursor: string | null;
}

describe("payments: exportación CSV (T-F2-25)", () => {
  let app: ApiApplication;
  let baseUrl: string;

  const suffix = randomUUID().slice(0, 8);
  const today = todayInCaracas();
  let orgA: string = randomUUID();
  let orgB: string = randomUUID();
  const rateA = randomUUID();
  const rateB = randomUUID();
  const bookingA = randomUUID();
  const bookingB = randomUUID();

  const cardReference = `CVV-123-TARJETA-4111111111111111-token-${suffix}`;
  let adminACookie = "";
  let superCookie = "";
  const userIds: string[] = [];

  async function createPayment(params: {
    tenantId: string;
    bookingId: string;
    rateId: string;
    reportedBy: string;
    method: "ZELLE" | "BINANCE_PAY";
    status: "IN_REVIEW" | "APPROVED";
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
        valueDate: new Date(`${today}T12:00:00Z`),
        reference: params.reference,
        status: params.status,
        reportedBy: params.reportedBy,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        paidAt: null,
        createdAt: new Date(params.createdAt),
      },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const ownerA = await createUser(`owner-pay-csv-a-${suffix}@example.com`);
    userIds.push(ownerA);
    orgA = (await createAgency(ownerA, `Pagos CSV A ${suffix}`, `pagos-csv-a-${suffix}`)).id;

    const adminA = await userWithTotp(baseUrl, `admin-pay-csv-a-${suffix}@example.com`);
    userIds.push(adminA.userId);
    await addMember(orgA, adminA.userId, "admin");
    await setActiveOrg(baseUrl, adminA.cookie, orgA);
    adminACookie = adminA.cookie;

    const ownerB = await createUser(`owner-pay-csv-b-${suffix}@example.com`);
    userIds.push(ownerB);
    orgB = (await createAgency(ownerB, `Pagos CSV B ${suffix}`, `pagos-csv-b-${suffix}`)).id;
    const adminB = await createUser(`admin-pay-csv-b-${suffix}@example.com`);
    userIds.push(adminB);
    await addMember(orgB, adminB, "admin");

    const superAdmin = await userWithTotp(baseUrl, `super-pay-csv-${suffix}@example.com`);
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
          valueDate: new Date(`${today}T12:00:00Z`),
          fetchedAt: new Date(),
          isOverride: false,
          createdBy: ownerA,
        },
      });
    }

    for (const entry of [
      { id: bookingA, tenantId: orgA, userId: adminA.userId },
      { id: bookingB, tenantId: orgB, userId: adminB },
    ]) {
      await prisma.booking.create({
        data: {
          id: entry.id,
          tenantId: entry.tenantId,
          code: generateBookingCode(),
          userId: entry.userId,
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

    await createPayment({
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      reportedBy: adminA.userId,
      method: "ZELLE",
      status: "IN_REVIEW",
      amountUsd: "100.00",
      amountVes: "90000.00",
      createdAt: `${today}T09:00:00-04:00`,
      reference: `ref-a-${suffix}`,
    });
    await createPayment({
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      reportedBy: adminA.userId,
      method: "ZELLE",
      status: "IN_REVIEW",
      amountUsd: "200.00",
      amountVes: "180000.00",
      createdAt: `${today}T10:00:00-04:00`,
      reference: `ref-b-${suffix}`,
    });
    await createPayment({
      tenantId: orgA,
      bookingId: bookingA,
      rateId: rateA,
      reportedBy: adminA.userId,
      method: "BINANCE_PAY",
      status: "APPROVED",
      amountUsd: "50.50",
      amountVes: "45450.00",
      createdAt: `${today}T11:00:00-04:00`,
      reference: `ref-c-${suffix}`,
    });
    await createPayment({
      tenantId: orgB,
      bookingId: bookingB,
      rateId: rateB,
      reportedBy: adminB,
      method: "ZELLE",
      status: "IN_REVIEW",
      amountUsd: "777.77",
      amountVes: "699993.00",
      createdAt: `${today}T12:00:00-04:00`,
      reference: cardReference,
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app?.close();
  });

  function url(path: string): string {
    return `${baseUrl}/api/v1/admin/payments${path}`;
  }

  async function call(path: string, cookie: string): Promise<Response> {
    return fetch(url(path), {
      headers: { origin: authOrigin, ...(cookie ? { cookie } : {}) },
    });
  }

  async function json(path: string, cookie = adminACookie): Promise<PaymentPage> {
    const res = await call(path, cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as PaymentPage;
  }

  async function csv(path: string, cookie = adminACookie): Promise<string> {
    const res = await call(path, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv; charset=utf-8");
    return res.text();
  }

  it("aplica los mismos filtros, límite y cursor que el JSON", async () => {
    const query = "?status=IN_REVIEW&method=ZELLE&limit=1";
    const first = await json(query);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    const firstCsv = await csv(`${query}&format=csv`);
    expect((firstCsv.trim().split(/\r?\n/)[1] ?? "")).toContain(first.items[0]?.id ?? "ausente");
    expect(firstCsv).toContain(
      `${first.items[0]?.amountUsd},${first.items[0]?.amountVes},${first.items[0]?.rate}`,
    );
    expect(firstCsv).not.toContain("BINANCE_PAY");

    const nextQuery = `${query}&cursor=${encodeURIComponent(first.nextCursor ?? "")}`;
    const second = await json(nextQuery);
    const secondCsv = await csv(`${nextQuery}&format=csv`);
    expect(second.items).toHaveLength(1);
    expect(secondCsv).toContain(second.items[0]?.id ?? "ausente");
    expect(secondCsv).not.toContain(first.items[0]?.id ?? "ausente");

    const approved = await csv("?status=APPROVED&format=csv");
    expect(approved).toContain("BINANCE_PAY");
    expect(approved).not.toContain("IN_REVIEW");

    const booking = await csv(`?bookingId=${bookingA}&format=csv`);
    expect(booking).toContain(bookingA);
    expect(booking).not.toContain(bookingB);
  });

  it("no mezcla agencias ni expone tenant, tarjeta o CVV", async () => {
    const own = await csv("?format=csv");
    expect(own).toContain(bookingA);
    expect(own).not.toContain(bookingB);
    expect(own).not.toContain("777.77");
    expect(own).not.toContain(cardReference);

    const platform = await csv("?format=csv", superCookie);
    expect(platform).toContain("777.77");
    expect(platform).not.toContain("tenantId");
    expect(platform).not.toContain("tenant_id");
    expect(platform).not.toContain(orgA);
    expect(platform).not.toContain(orgB);
    expect(platform).not.toContain("4111111111111111");
    expect(platform).not.toContain("CVV");
  });

  it("localiza encabezados con lang y rechaza parámetros no previstos", async () => {
    expect((await csv("?format=csv")).split(/\r?\n/)[0]).toBe(
      "ID,Reserva,Método,Estado,Monto USD,Monto VES,Tasa,ID de tasa,Fecha valor,Reportado por,Revisado por,Revisado el,Pagado el,Creado el",
    );
    expect((await csv("?format=csv&lang=en")).split(/\r?\n/)[0]).toBe(
      "ID,Booking,Method,Status,Amount USD,Amount VES,Rate,Rate ID,Value date,Reported by,Reviewed by,Reviewed at,Paid at,Created at",
    );

    for (const bad of ["format=csv&lang=fr", "format=csv&amountUsd=1"]) {
      const res = await call(`?${bad}`, adminACookie);
      expect(res.status).toBe(422);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(((await res.json()) as ProblemBody).code).toBe("VALIDATION_ERROR");
    }
  });
});
