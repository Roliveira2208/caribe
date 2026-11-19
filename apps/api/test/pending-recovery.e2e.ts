import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { type ApiApplication, createApp } from "../src/bootstrap.js";
import { PendingRecoveryService } from "../src/jobs/pending-recovery.service.js";
import { TenantService } from "../src/tenant/tenant.service.js";

/**
 * Recuperación de filas PENDING huérfanas (T-F1-12b). Simula la caída entre el
 * commit y el encolado insertando documentos y avisos PENDING directamente en
 * la base, sin llamar a los métodos que encolan. El barrido debe encontrarlos
 * por agencia, re-encolarlos y no tocar filas recientes ni ya terminadas.
 */
describe("barrido de pendientes huérfanos", () => {
  let app: ApiApplication;
  let db: Client;
  let recovery: PendingRecoveryService;
  let tenants: TenantService;

  const suffix = randomUUID().slice(0, 8);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const bookingA = randomUUID();
  const bookingA2 = randomUUID();
  const bookingB = randomUUID();
  const bookingB2 = randomUUID();
  const staleDocA = randomUUID();
  const freshDocA = randomUUID();
  const readyDocB = randomUUID();
  const staleDocB = randomUUID();
  const staleNotificationA = randomUUID();
  const freshNotificationA = randomUUID();
  const sentNotificationB = randomUUID();
  const staleNotificationB = randomUUID();

  const bookingCode = () => `CRB-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const codeA = bookingCode();
  const codeA2 = bookingCode();
  const codeB = bookingCode();
  const codeB2 = bookingCode();
  const now = new Date("2026-11-18T12:00:00.000Z");
  const cutoffMinutes = 5;
  const staleCreated = new Date(now.getTime() - 10 * 60_000);
  const freshCreated = new Date(now.getTime() - 60_000);
  const organizationIds = [orgA, orgB];

  beforeAll(async () => {
    app = await createApp();
    recovery = app.get(PendingRecoveryService);
    tenants = app.get(TenantService);
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    await db.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
      [
        orgA,
        `Pendientes A ${suffix}`,
        `pendientes-a-${suffix}`,
        orgB,
        `Pendientes B ${suffix}`,
        `pendientes-b-${suffix}`,
      ],
    );
    await db.query(
      `INSERT INTO "user" (id, name, email, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()), ($4, $5, $6, now(), now())`,
      [
        userA,
        `Cliente A ${suffix}`,
        `pendientes-a-${suffix}@example.com`,
        userB,
        `Cliente B ${suffix}`,
        `pendientes-b-${suffix}@example.com`,
      ],
    );
    await db.query(
      `INSERT INTO "bookings"
         (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'CONFIRMED', 100.00, $17::jsonb, now() + interval '1 day', now()),
              ($5, $6, $7, $8, 'CONFIRMED', 100.00, $17::jsonb, now() + interval '1 day', now()),
              ($9, $10, $11, $12, 'CONFIRMED', 100.00, $17::jsonb, now() + interval '1 day', now()),
              ($13, $14, $15, $16, 'CONFIRMED', 100.00, $17::jsonb, now() + interval '1 day', now())`,
      [
        bookingA,
        orgA,
        codeA,
        userA,
        bookingB,
        orgB,
        codeB,
        userB,
        bookingA2,
        orgA,
        codeA2,
        userA,
        bookingB2,
        orgB,
        codeB2,
        userB,
        JSON.stringify([
          { fullName: "Ana Pérez", documentType: "CI", documentNumber: "V-12345678" },
        ]),
      ],
    );

    const document = (
      id: string,
      tenantId: string,
      bookingId: string,
      number: number,
      status: "PENDING" | "READY",
      createdAt: Date,
    ) =>
      db.query(
        `INSERT INTO "documents"
           (id, tenant_id, booking_id, type, number, file_url, language, status, created_at)
         VALUES ($1, $2, $3, 'VOUCHER', $4, $5, 'es', $6, $7)`,
        [
          id,
          tenantId,
          bookingId,
          number,
          status === "READY" ? `documents/${randomUUID()}.pdf` : null,
          status,
          // `created_at` es timestamp without time zone y Prisma guarda la
          // pared UTC; con un Date, pg guardaría la hora local (UTC-4).
          createdAt.toISOString(),
        ],
      );

    // Números distintos por agencia y tipo; la caída se simula con filas
    // antiguas que nunca se encolaron. Las recientes y las terminadas se
    // insertan también para comprobar que el barrido las ignora.
    await document(staleDocA, orgA, bookingA, 1, "PENDING", staleCreated);
    await document(freshDocA, orgA, bookingA2, 2, "PENDING", freshCreated);
    await document(staleDocB, orgB, bookingB, 1, "PENDING", staleCreated);
    await document(readyDocB, orgB, bookingB2, 2, "READY", staleCreated);

    const notification = (
      id: string,
      tenantId: string,
      bookingId: string,
      status: "PENDING" | "SENT",
      createdAt: Date,
    ) =>
      db.query(
        `INSERT INTO "notification_logs"
           (id, tenant_id, dedupe_key, template, recipient, locale, status, attempts, created_at, sent_at)
         VALUES ($1, $2, $3, 'BOOKING_CONFIRMED', $4, 'es', $5, 1, $6, $7)`,
        [
          id,
          tenantId,
          `booking.confirmed:${bookingId}:${id}`,
          `pendientes-${suffix}@example.com`,
          status,
          createdAt.toISOString(),
          status === "SENT" ? createdAt.toISOString() : null,
        ],
      );

    await notification(staleNotificationA, orgA, bookingA, "PENDING", staleCreated);
    await notification(freshNotificationA, orgA, bookingA, "PENDING", freshCreated);
    await notification(staleNotificationB, orgB, bookingB, "PENDING", staleCreated);
    await notification(sentNotificationB, orgB, bookingB, "SENT", staleCreated);
  });

  afterAll(async () => {
    const organizations = [orgA, orgB];
    await db.query(`DELETE FROM "documents" WHERE "tenant_id" = ANY($1::text[])`, [organizations]);
    await db.query(`DELETE FROM "notification_logs" WHERE "tenant_id" = ANY($1::text[])`, [
      organizations,
    ]);
    await db.query(`DELETE FROM "bookings" WHERE "tenant_id" = ANY($1::text[])`, [organizations]);
    await db.query(`DELETE FROM "user" WHERE "id" = ANY($1::text[])`, [[userA, userB]]);
    await db.query(`DELETE FROM "organization" WHERE "id" = ANY($1::text[])`, [organizations]);
    await db.end();
    await app.close();
  });

  function enqueuerDouble() {
    const documents: string[] = [];
    const notifications: string[] = [];
    return {
      documents,
      notifications,
      async document(payload: { documentId: string; tenantId: string }) {
        documents.push(`${payload.tenantId}:${payload.documentId}`);
      },
      async notification(payload: { notificationId: string; tenantId: string }) {
        notifications.push(`${payload.tenantId}:${payload.notificationId}`);
      },
    };
  }

  it("re-encola los PENDING antiguos por agencia, sin tocar recientes ni terminados", async () => {
    const enqueuer = enqueuerDouble();

    const summary = await recovery.recoverStalePending(
      enqueuer,
      now,
      organizationIds,
      cutoffMinutes,
    );

    expect(summary).toEqual({ organizations: 2, documents: 2, notifications: 2, failed: 0 });
    expect(enqueuer.documents.sort()).toEqual(
      [`${orgA}:${staleDocA}`, `${orgB}:${staleDocB}`].sort(),
    );
    expect(enqueuer.notifications.sort()).toEqual(
      [`${orgA}:${staleNotificationA}`, `${orgB}:${staleNotificationB}`].sort(),
    );
    expect(enqueuer.documents).not.toContain(`${orgA}:${freshDocA}`);
    expect(enqueuer.documents).not.toContain(`${orgB}:${readyDocB}`);
    expect(enqueuer.notifications).not.toContain(`${orgA}:${freshNotificationA}`);
    expect(enqueuer.notifications).not.toContain(`${orgB}:${sentNotificationB}`);
  });

  it("no re-encola dos veces una fila ya terminada por un barrido posterior", async () => {
    await db.query(`UPDATE "documents" SET status = 'READY' WHERE id = $1`, [staleDocA]);
    await db.query(
      `UPDATE "notification_logs" SET status = 'SENT' WHERE id = $1`,
      [staleNotificationA],
    );
    const enqueuer = enqueuerDouble();

    const summary = await recovery.recoverStalePending(
      enqueuer,
      now,
      organizationIds,
      cutoffMinutes,
    );

    expect(summary.documents).toBe(1);
    expect(summary.notifications).toBe(1);
    expect(enqueuer.documents).toEqual([`${orgB}:${staleDocB}`]);
    expect(enqueuer.notifications).toEqual([`${orgB}:${staleNotificationB}`]);
  });

  it("registra el fallo de una agencia y sigue con las demás", async () => {
    const original = tenants.withTenant.bind(tenants);
    const spy = vi.spyOn(tenants, "withTenant").mockImplementation(async (tenantId, fn) => {
      if (tenantId === orgA) throw new Error("La agencia A está caída");
      return original(tenantId, fn);
    });
    const enqueuer = enqueuerDouble();

    try {
      const summary = await recovery.recoverStalePending(
        enqueuer,
        now,
        organizationIds,
        cutoffMinutes,
      );

      expect(summary).toEqual({ organizations: 2, documents: 1, notifications: 1, failed: 1 });
      expect(enqueuer.documents).toEqual([`${orgB}:${staleDocB}`]);
      expect(enqueuer.notifications).toEqual([`${orgB}:${staleNotificationB}`]);
    } finally {
      spy.mockRestore();
    }
  });
});
