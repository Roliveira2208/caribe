import { describe, expect, it, vi } from "vitest";
import {
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  RATE_TIMEZONE,
  REFRESH_RATE_JOB,
  REFRESH_RATE_SCHEDULE,
  jobsEnabled,
} from "../src/jobs/jobs.constants.js";
import {
  createJobProcessor,
  registerSchedules,
  type SchedulerQueue,
} from "../src/jobs/jobs.scheduler.js";

/**
 * Unitarios del planificador de T-F1-8: calendarios, zona horaria, plantilla
 * de reintentos y despacho por nombre. No tocan Redis ni PostgreSQL.
 */
describe("jobs", () => {
  it("programa la expiración cada minuto y la tasa a medianoche de Caracas", async () => {
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
        REFRESH_RATE_JOB,
        { pattern: REFRESH_RATE_SCHEDULE, tz: RATE_TIMEZONE },
        {
          name: REFRESH_RATE_JOB,
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 60_000 },
          },
        },
      ],
    ]);
    expect(EXPIRE_BOOKINGS_SCHEDULE).toBe("* * * * *");
    expect(REFRESH_RATE_SCHEDULE).toBe("0 0 * * *");
    expect(RATE_TIMEZONE).toBe("America/Caracas");
  });

  it("despacha el trabajo por nombre y falla cerrado con uno desconocido", async () => {
    const expireBookings = vi.fn(async () => ({ expired: 2 }));
    const refreshRate = vi.fn(async () => ({ rate: "900.0000" }));
    const process = createJobProcessor({ expireBookings, refreshRate });

    await expect(process({ name: EXPIRE_BOOKINGS_JOB })).resolves.toEqual({ expired: 2 });
    expect(expireBookings).toHaveBeenCalledTimes(1);
    expect(refreshRate).not.toHaveBeenCalled();

    await expect(process({ name: REFRESH_RATE_JOB })).resolves.toEqual({ rate: "900.0000" });
    expect(refreshRate).toHaveBeenCalledTimes(1);

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
