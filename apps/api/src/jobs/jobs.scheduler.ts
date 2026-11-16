import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { BookingExpirationService } from "./booking-expiration.service.js";
import {
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  JOBS_QUEUE_NAME,
  jobsEnabled,
} from "./jobs.constants.js";

/** Lo mínimo que el planificador necesita de la cola (doble en pruebas). */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz?: string },
    template: {
      name: string;
      opts?: {
        attempts?: number;
        backoff?: { type: "exponential"; delay: number };
      };
    },
  ): Promise<unknown>;
}

/** Cuerpo de cada trabajo, inyectable para probar el despacho sin Redis. */
export interface JobHandlers {
  expireBookings(): Promise<unknown>;
}

/**
 * Registra los planificadores en la cola. Se separa de la clase para poder
 * comprobar patrones y plantillas con una cola falsa.
 */
export async function registerSchedules(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(
    EXPIRE_BOOKINGS_JOB,
    { pattern: EXPIRE_BOOKINGS_SCHEDULE },
    { name: EXPIRE_BOOKINGS_JOB },
  );
}

/** Despacha por nombre de trabajo; un nombre desconocido falla cerrado. */
export function createJobProcessor(
  handlers: JobHandlers,
): (job: Pick<Job, "name">) => Promise<unknown> {
  return async (job) => {
    switch (job.name) {
      case EXPIRE_BOOKINGS_JOB:
        return handlers.expireBookings();
      default:
        throw new Error(`Trabajo desconocido: ${job.name}`);
    }
  };
}

/**
 * Planificador BullMQ (T-F1-8, design §3.3).
 *
 * Arranca solo con `REDIS_URL` y fuera de `NODE_ENV=test`. La cola y el worker
 * usan conexiones propias (el worker necesita una conexión bloqueante). El
 * registro de los planificadores no bloquea el arranque de la API: si Redis
 * tarda en responder, los comandos quedan en la cola offline de ioredis y se
 * envían al conectar.
 */
@Injectable()
export class JobsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsScheduler.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly expiration: BookingExpirationService) {}

  onModuleInit(): void {
    if (!jobsEnabled()) {
      this.logger.log("BullMQ deshabilitado: sin REDIS_URL o en pruebas.");
      return;
    }
    this.start(process.env.REDIS_URL as string);
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    await worker?.close();
    await queue?.close();
  }

  private start(url: string): void {
    const connection = { url, maxRetriesPerRequest: null };

    const queue = new Queue(JOBS_QUEUE_NAME, { connection });
    const worker = new Worker(
      JOBS_QUEUE_NAME,
      createJobProcessor({
        expireBookings: () => this.expiration.expireDueBookings(),
      }),
      { connection },
    );

    // Sin oyentes de "error", un fallo de conexión de ioredis se propaga como
    // excepción no capturada y tumba el proceso.
    queue.on("error", (error) => {
      this.logger.error(`Error de la cola ${JOBS_QUEUE_NAME}: ${error.message}`);
    });
    worker.on("error", (error) => {
      this.logger.error(`Error del worker ${JOBS_QUEUE_NAME}: ${error.message}`);
    });
    worker.on("failed", (job, error) => {
      this.logger.error(
        `El trabajo ${job?.name ?? "desconocido"} falló: ${error.message}`,
      );
    });

    this.queue = queue;
    this.worker = worker;

    void registerSchedules(queue)
      .then(() => this.logger.log(`BullMQ activo en la cola ${JOBS_QUEUE_NAME}.`))
      .catch((error: unknown) => {
        this.logger.error(
          `No se pudieron registrar los planificadores: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
      });
  }
}
