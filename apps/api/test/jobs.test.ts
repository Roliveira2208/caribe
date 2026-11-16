import { describe, expect, it, vi } from "vitest";
import {
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  jobsEnabled,
} from "../src/jobs/jobs.constants.js";
import {
  createJobProcessor,
  registerSchedules,
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

  it("despacha el trabajo por nombre y falla cerrado con uno desconocido", async () => {
    const expireBookings = vi.fn(async () => ({ expired: 2 }));
    const process = createJobProcessor({ expireBookings });

    await expect(process({ name: EXPIRE_BOOKINGS_JOB })).resolves.toEqual({ expired: 2 });
    expect(expireBookings).toHaveBeenCalledTimes(1);

    await expect(process({ name: "exchange-rate.refresh" })).rejects.toThrow(
      "Trabajo desconocido: exchange-rate.refresh",
    );
    await expect(process({ name: "otro.trabajo" })).rejects.toThrow(
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
