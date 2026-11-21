import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_JOB_ATTEMPTS,
  DOCUMENT_JOB_BACKOFF,
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_DELAYS,
  RECOVER_PENDING_JOB,
  RECOVER_PENDING_SCHEDULE,
  RENDER_DOCUMENT_JOB,
  SEND_NOTIFICATION_JOB,
  WORKER_CONCURRENCY,
  WORKER_KEEP_COMPLETED,
  WORKER_KEEP_FAILED,
  WORKER_LOCK_DURATION_MS,
  WORKER_LOCK_RENEW_TIME_MS,
  WORKER_STALLED_INTERVAL_MS,
  isTransientLockError,
  jobsEnabled,
  pendingRecoveryMinutes,
  workerOptions,
} from "../src/jobs/jobs.constants.js";
import {
  createJobProcessor,
  enqueueDocumentRender,
  enqueueNotification,
  registerSchedules,
  type JobQueue,
  type SchedulerQueue,
} from "../src/jobs/jobs.scheduler.js";

/**
 * Unitarios del planificador de T-F1-8: calendario, despacho por nombre y
 * arranque. No tocan Redis ni PostgreSQL. Desde T-F1-5b la tasa no tiene
 * trabajo programado: solo se expira la retención.
 */
describe("jobs", () => {
  it("programa la expiración y el barrido de pendientes cada minuto", async () => {
    const calls: Array<Parameters<SchedulerQueue["upsertJobScheduler"]>> = [];
    const queue: SchedulerQueue = {
      async upsertJobScheduler(id, repeat, template) {
        calls.push([id, repeat, template]);
        return undefined;
      },
    };

    await registerSchedules(queue);

    expect(calls).toEqual([
      [
        EXPIRE_BOOKINGS_JOB,
        { pattern: EXPIRE_BOOKINGS_SCHEDULE },
        { name: EXPIRE_BOOKINGS_JOB },
      ],
      [
        RECOVER_PENDING_JOB,
        { pattern: RECOVER_PENDING_SCHEDULE },
        { name: RECOVER_PENDING_JOB },
      ],
    ]);
    expect(EXPIRE_BOOKINGS_SCHEDULE).toBe("* * * * *");
    expect(RECOVER_PENDING_SCHEDULE).toBe("* * * * *");
  });

  it("lee el umbral del barrido desde el entorno con 5 minutos por defecto", () => {
    expect(pendingRecoveryMinutes({})).toBe(5);
    expect(pendingRecoveryMinutes({ PENDING_RECOVERY_MINUTES: "15" })).toBe(15);
    expect(pendingRecoveryMinutes({ PENDING_RECOVERY_MINUTES: "0" })).toBe(5);
    expect(pendingRecoveryMinutes({ PENDING_RECOVERY_MINUTES: "no-es-numero" })).toBe(5);
  });

  it("el render de documentos es por evento, con 3 intentos y espera exponencial", async () => {
    expect(RENDER_DOCUMENT_JOB).toBe("documents.render");
    expect(DOCUMENT_JOB_ATTEMPTS).toBe(3);
    expect(DOCUMENT_JOB_BACKOFF).toEqual({ type: "exponential", delay: 1000 });

    const calls: Array<Parameters<JobQueue["add"]>> = [];
    const queue: JobQueue = {
      async add(name, data, opts) {
        calls.push([name, data, opts]);
        return undefined;
      },
    };
    const payload = {
      documentId: "4f3c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f",
      tenantId: "tenant-1",
    };
    await enqueueDocumentRender(queue, payload);
    expect(calls).toEqual([
      [
        RENDER_DOCUMENT_JOB,
        payload,
        { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
      ],
    ]);
  });

  it("el correo es por evento, con 3 intentos y espera creciente en el servicio", async () => {
    expect(SEND_NOTIFICATION_JOB).toBe("notifications.send");
    expect(NOTIFICATION_JOB_ATTEMPTS).toBe(3);
    expect(NOTIFICATION_JOB_DELAYS).toEqual([1000, 2000]);

    const calls: Array<Parameters<JobQueue["add"]>> = [];
    const queue: JobQueue = {
      async add(name, data, opts) {
        calls.push([name, data, opts]);
        return undefined;
      },
    };
    const payload = {
      notificationId: "4f3c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f",
      tenantId: "tenant-1",
    };
    await enqueueNotification(queue, payload);
    expect(calls).toEqual([[SEND_NOTIFICATION_JOB, payload, undefined]]);
  });

  it("despacha el trabajo por nombre y falla cerrado con uno desconocido", async () => {
    const expireBookings = vi.fn(async () => ({ expired: 2 }));
    const renderDocument = vi.fn(async () => ({ status: "READY" }));
    const sendNotification = vi.fn(async () => ({ status: "SENT" }));
    const recoverPending = vi.fn(async () => ({
      organizations: 2,
      documents: 1,
      notifications: 1,
      failed: 0,
    }));
    const process = createJobProcessor({
      expireBookings,
      renderDocument,
      sendNotification,
      recoverPending,
    });

    await expect(process({ name: EXPIRE_BOOKINGS_JOB, data: {} })).resolves.toEqual({
      expired: 2,
    });
    expect(expireBookings).toHaveBeenCalledTimes(1);

    await expect(process({ name: RECOVER_PENDING_JOB, data: {} })).resolves.toEqual({
      organizations: 2,
      documents: 1,
      notifications: 1,
      failed: 0,
    });
    expect(recoverPending).toHaveBeenCalledTimes(1);

    const payload = {
      documentId: "4f3c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f",
      tenantId: "tenant-1",
    };
    await expect(process({ name: RENDER_DOCUMENT_JOB, data: payload })).resolves.toEqual({
      status: "READY",
    });
    expect(renderDocument).toHaveBeenCalledWith(payload);

    const notificationPayload = {
      notificationId: "9a1c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f",
      tenantId: "tenant-1",
    };
    await expect(
      process({ name: SEND_NOTIFICATION_JOB, data: notificationPayload }),
    ).resolves.toEqual({ status: "SENT" });
    expect(sendNotification).toHaveBeenCalledWith(notificationPayload);

    await expect(process({ name: "exchange-rate.refresh", data: {} })).rejects.toThrow(
      "Trabajo desconocido: exchange-rate.refresh",
    );
    await expect(process({ name: "otro.trabajo", data: {} })).rejects.toThrow(
      "Trabajo desconocido: otro.trabajo",
    );
  });

  it("usa un lock con holgura, renovación frecuente y un solo trabajo en vuelo", () => {
    expect(workerOptions()).toEqual({
      lockDuration: WORKER_LOCK_DURATION_MS,
      stalledInterval: WORKER_STALLED_INTERVAL_MS,
      concurrency: WORKER_CONCURRENCY,
      lockRenewTime: WORKER_LOCK_RENEW_TIME_MS,
      removeOnComplete: WORKER_KEEP_COMPLETED,
      removeOnFail: WORKER_KEEP_FAILED,
    });
    expect(WORKER_LOCK_DURATION_MS).toBeGreaterThanOrEqual(WORKER_STALLED_INTERVAL_MS);
    expect(WORKER_LOCK_DURATION_MS).toBeGreaterThan(30_000);
    // BullMQ renueva cada lockRenewTime / 2: 5 s frente a 120 s de lock.
    expect(WORKER_LOCK_RENEW_TIME_MS * 2).toBeLessThanOrEqual(WORKER_LOCK_DURATION_MS / 4);
    expect(WORKER_CONCURRENCY).toBe(1);
    expect(WORKER_KEEP_COMPLETED.count).toBeGreaterThan(0);
    expect(WORKER_KEEP_FAILED.age).toBeGreaterThan(WORKER_KEEP_COMPLETED.age);
  });

  it("clasifica los errores de lock como transitorios y los fallos reales no", () => {
    expect(isTransientLockError("could not renew lock for job repeat:bookings.expire:123")).toBe(
      true,
    );
    expect(isTransientLockError("Missing lock for job repeat:bookings.expire:123. moveToFinished")).toBe(
      true,
    );
    expect(
      isTransientLockError(
        "Missing lock for job repeat:jobs.recover-pending:1795293120000. moveToFinished",
      ),
    ).toBe(true);
    expect(isTransientLockError("lockRenewalFailed")).toBe(true);
    expect(isTransientLockError("Trabajo desconocido: otro.trabajo")).toBe(false);
    expect(isTransientLockError("ECONNREFUSED")).toBe(false);
  });

  it("solo habilita BullMQ con REDIS_URL y fuera de las pruebas", () => {
    expect(jobsEnabled({ REDIS_URL: "redis://localhost:6380" } as NodeJS.ProcessEnv)).toBe(true);
    expect(jobsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      jobsEnabled({
        REDIS_URL: "redis://localhost:6380",
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      jobsEnabled({ REDIS_URL: "", NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
