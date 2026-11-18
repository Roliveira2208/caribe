import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_JOB_ATTEMPTS,
  DOCUMENT_JOB_BACKOFF,
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  RENDER_DOCUMENT_JOB,
  jobsEnabled,
} from "../src/jobs/jobs.constants.js";
import {
  createJobProcessor,
  enqueueDocumentRender,
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
  it("programa solo la expiración cada minuto", async () => {
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
    ]);
    expect(EXPIRE_BOOKINGS_SCHEDULE).toBe("* * * * *");
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

  it("despacha el trabajo por nombre y falla cerrado con uno desconocido", async () => {
    const expireBookings = vi.fn(async () => ({ expired: 2 }));
    const renderDocument = vi.fn(async () => ({ status: "READY" }));
    const process = createJobProcessor({ expireBookings, renderDocument });

    await expect(process({ name: EXPIRE_BOOKINGS_JOB, data: {} })).resolves.toEqual({
      expired: 2,
    });
    expect(expireBookings).toHaveBeenCalledTimes(1);

    const payload = {
      documentId: "4f3c1a52-8b7d-4c10-9f2e-6a5b4d3c2e1f",
      tenantId: "tenant-1",
    };
    await expect(process({ name: RENDER_DOCUMENT_JOB, data: payload })).resolves.toEqual({
      status: "READY",
    });
    expect(renderDocument).toHaveBeenCalledWith(payload);

    await expect(process({ name: "exchange-rate.refresh", data: {} })).rejects.toThrow(
      "Trabajo desconocido: exchange-rate.refresh",
    );
    await expect(process({ name: "otro.trabajo", data: {} })).rejects.toThrow(
      "Trabajo desconocido: otro.trabajo",
    );
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
