import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { todayInCaracas } from "@caribe/shared";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import { createAuditFailureTrigger, type AuditFailureTrigger } from "./audit-failure-trigger.js";
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
 * T-F2-16: las tres acciones sensibles del panel dejan rastro con la agencia
 * correcta. Se ejercitan por HTTP con sesiones reales (TOTP inclusive) y se
 * comprueba la fila de `audit_logs` y el par `attempt`/`result` de Better Auth.
 */
describe("audit: auditoría de las acciones del panel (T-F2-16)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let owner: Client;
  const suffix = randomUUID().slice(0, 8);
  const today = todayInCaracas();

  let orgA: string;
  let adminId: string;
  let adminCookie: string;
  let reporterId: string;
  let memberUserId: string;
  let memberId: string;
  let agencyRateId: string;

  async function call(
    method: string,
    path: string,
    cookie: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie,
        origin: authOrigin,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  }

  const override = (cookie: string, body: Record<string, unknown>) =>
    call("PUT", "/api/v1/admin/exchange-rates/override", cookie, body);
  const review = (
    cookie: string,
    paymentId: string,
    action: "approve" | "reject",
    reason?: string,
  ) =>
    call(
      "PATCH",
      `/api/v1/admin/payments/${paymentId}/${action}`,
      cookie,
      reason ? { reason } : undefined,
    );

  /** Reserva y pago en revisión imputados a la agencia y a la tasa indicadas. */
  async function createPendingPayment(params: {
    tenantId: string;
    reporterId: string;
    rateId: string;
    rate: string;
    amountVes: string;
  }): Promise<{ bookingId: string; paymentId: string }> {
    const bookingId = randomUUID();
    const paymentId = randomUUID();
    await prisma.booking.create({
      data: {
        id: bookingId,
        tenantId: params.tenantId,
        code: generateBookingCode(),
        userId: params.reporterId,
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
    await prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: params.tenantId,
        bookingId,
        method: "PAGO_MOVIL",
        amountUsd: "100.00",
        amountVes: params.amountVes,
        exchangeRateId: params.rateId,
        rate: params.rate,
        valueDate: new Date(today),
        reference: randomUUID().slice(0, 8),
        status: "IN_REVIEW",
        reportedBy: params.reporterId,
      },
    });
    return { bookingId, paymentId };
  }

  async function createAgencyRate(tenantId: string, createdBy: string): Promise<string> {
    const id = randomUUID();
    await prisma.exchangeRate.create({
      data: {
        id,
        tenantId,
        source: "COTIZAVE",
        rate: "900.0000",
        valueDate: new Date(today),
        fetchedAt: new Date(),
        isOverride: false,
        createdBy,
      },
    });
    return id;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    owner = new Client({ connectionString: process.env["DATABASE_URL"] });
    await owner.connect();

    const admin = await userWithTotp(baseUrl, `admin-f2actions-${suffix}@example.com`);
    adminId = admin.userId;
    adminCookie = admin.cookie;
    orgA = (await createAgency(adminId, `F2 Acciones ${suffix}`, `f2actions-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminCookie, orgA);

    const reporterEmail = `reporter-f2actions-${suffix}@example.com`;
    reporterId = await createUser(reporterEmail);
    await addMember(orgA, reporterId, "member");
    const reporterCookie = await signIn(baseUrl, reporterEmail);
    await setActiveOrg(baseUrl, reporterCookie, orgA);

    const targetEmail = `target-f2actions-${suffix}@example.com`;
    memberUserId = await createUser(targetEmail);
    await addMember(orgA, memberUserId, "member");
    memberId = (
      await prisma.member.findFirstOrThrow({ where: { organizationId: orgA, userId: memberUserId } })
    ).id;

    agencyRateId = await createAgencyRate(orgA, adminId);
  });

  afterAll(async () => {
    await app.close();
    await owner.end();
    await prisma.$disconnect();
  });

  it("Auditoría del override de tasa", async () => {
    const frozen = await createPendingPayment({
      tenantId: orgA,
      reporterId,
      rateId: agencyRateId,
      rate: "900.0000",
      amountVes: "90000.00",
    });

    const res = await override(adminCookie, { rate: "950.0000", reason: `Ajuste ${suffix}` });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "exchange-rate.override",
        entity: "exchange-rate",
        entityId: agencyRateId,
        tenantId: orgA,
      },
      orderBy: { at: "desc" },
    });
    expect(audit.actorId).toBe(adminId);
    expect(audit.ip === null || typeof audit.ip === "string").toBe(true);
    expect(audit.at.getTime()).toBeGreaterThan(0);
    expect(audit.before).toMatchObject({ rate: "900.0000" });
    expect(audit.after).toMatchObject({ rate: "950.0000", reason: `Ajuste ${suffix}` });

    // El pago existente conserva el par congelado: el override no lo recalcula.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: frozen.paymentId } });
    expect(payment.exchangeRateId).toBe(agencyRateId);
    expect(payment.amountVes.toFixed(2)).toBe("90000.00");
  });

  it("Auditoría de la revisión de pagos", async () => {
    const { paymentId } = await createPendingPayment({
      tenantId: orgA,
      reporterId,
      rateId: agencyRateId,
      rate: "950.0000",
      amountVes: "95000.00",
    });

    const res = await review(adminCookie, paymentId, "approve");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "APPROVED", reviewedBy: adminId });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "payment.approve", entity: "payment", entityId: paymentId, tenantId: orgA },
      orderBy: { at: "desc" },
    });
    expect(audit.actorId).toBe(adminId);
    expect(audit.before).toMatchObject({ status: "IN_REVIEW" });
    expect(audit.after).toMatchObject({ status: "APPROVED" });
  });

  it("audita también el rechazo de un pago", async () => {
    const { paymentId } = await createPendingPayment({
      tenantId: orgA,
      reporterId,
      rateId: agencyRateId,
      rate: "950.0000",
      amountVes: "95000.00",
    });

    const res = await review(adminCookie, paymentId, "reject", `Rechazo ${suffix}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "REJECTED", reviewedBy: adminId });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "payment.reject", entity: "payment", entityId: paymentId, tenantId: orgA },
      orderBy: { at: "desc" },
    });
    expect(audit.actorId).toBe(adminId);
    expect(audit.before).toMatchObject({ status: "IN_REVIEW" });
    expect(audit.after).toMatchObject({ status: "REJECTED" });
  });

  it("si falla la auditoría se revierte la revisión del pago", async () => {
    // El inyector de fallo exige UUID: esta agencia se siembra por SQL, igual
    // que en payments.e2e.ts, para poder identificar sus filas de auditoría.
    const orgFail = randomUUID();
    await owner.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now())`,
      [orgFail, `F2 Acciones Fallo ${suffix}`, `f2actions-fail-${suffix}`],
    );
    const failAdmin = await userWithTotp(baseUrl, `admin-fail-f2actions-${suffix}@example.com`);
    await addMember(orgFail, failAdmin.userId, "admin");
    await setActiveOrg(baseUrl, failAdmin.cookie, orgFail);
    const failReporterId = await createUser(`report-fail-f2actions-${suffix}@example.com`);
    await addMember(orgFail, failReporterId, "member");
    const rateId = await createAgencyRate(orgFail, failAdmin.userId);
    const { paymentId } = await createPendingPayment({
      tenantId: orgFail,
      reporterId: failReporterId,
      rateId,
      rate: "900.0000",
      amountVes: "90000.00",
    });

    const failure: AuditFailureTrigger = await createAuditFailureTrigger(owner, orgFail);
    try {
      const res = await review(failAdmin.cookie, paymentId, "approve");
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toMatchObject({ code: "INTERNAL_ERROR" });
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).resolves.toMatchObject(
        { status: "IN_REVIEW" },
      );
      expect(
        await prisma.auditLog.count({
          where: { entityId: paymentId, action: "payment.approve", tenantId: orgFail },
        }),
      ).toBe(0);
    } finally {
      await failure.drop();
    }
  });

  it("Auditoría del cambio de rol", async () => {
    const startedAt = new Date(Date.now() - 2_000);
    const res = await call("POST", "/api/auth/organization/update-member-role", adminCookie, {
      memberId,
      role: "agent",
      organizationId: orgA,
    });
    expect(res.status, await res.text()).toBe(200);
    await expect(prisma.member.findUniqueOrThrow({ where: { id: memberId } })).resolves.toMatchObject({
      role: "agent",
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "auth.organization.update-member-role",
        entity: "member",
        entityId: memberId,
        tenantId: orgA,
        actorId: adminId,
        at: { gte: startedAt },
      },
      orderBy: { at: "desc" },
    });
    expect(audit.before).toBeNull();
    expect(audit.after).toMatchObject({ id: memberId, role: "agent" });

    const events = await prisma.authEvent.findMany({
      where: {
        route: "/organization/update-member-role",
        actorId: adminId,
        tenantId: orgA,
        at: { gte: startedAt },
      },
      orderBy: { at: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.phase).sort()).toEqual(["attempt", "result"]);
    expect(events[0]?.correlationId).toBe(events[1]?.correlationId);
    expect(events[1]).toMatchObject({ outcome: "success", errorCode: null, errorStatus: null });
    // Los eventos solo exponen códigos y estados: ni cuerpos ni mensajes internos.
    const serialized = JSON.stringify(events);
    for (const forbidden of ["password", "token", "cookie", "message", "body"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});
