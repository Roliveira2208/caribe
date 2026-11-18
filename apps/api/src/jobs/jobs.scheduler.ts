import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { DocumentRenderingService } from "../documents/document-rendering.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { BookingExpirationService } from "./booking-expiration.service.js";
import {
  DOCUMENT_JOB_ATTEMPTS,
  DOCUMENT_JOB_BACKOFF,
  EXPIRE_BOOKINGS_JOB,
  EXPIRE_BOOKINGS_SCHEDULE,
  JOBS_QUEUE_NAME,
  RENDER_DOCUMENT_JOB,
  SEND_NOTIFICATION_JOB,
  jobsEnabled,
  notificationPayloadSchema,
  renderDocumentPayloadSchema,
  type NotificationPayload,
  type RenderDocumentPayload,
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

/** Cola mínima para encolar el correo de confirmación. */
export interface NotificationQueue {
  add(name: string, data: unknown): Promise<unknown>;
}

/** Cola mínima para encolar el render con sus opciones de reintento. */
export interface JobQueue {
  add(
    name: string,
    data: unknown,
    opts?: {
      attempts?: number;
      backoff?: { type: "exponential"; delay: number };
    },
  ): Promise<unknown>;
}

/**
 * Encola un render con 3 intentos y espera exponencial, tal como exige la spec
 * "Reintentos automáticos". El cuerpo solo lleva identificadores, nunca PII.
 */
export async function enqueueDocumentRender(
  queue: JobQueue,
  payload: RenderDocumentPayload,
): Promise<void> {
  await queue.add(RENDER_DOCUMENT_JOB, payload, {
    attempts: DOCUMENT_JOB_ATTEMPTS,
    backoff: DOCUMENT_JOB_BACKOFF,
  });
}

/** Cuerpo de cada trabajo, inyectable para probar el despacho sin Redis. */
export interface JobHandlers {
  expireBookings(): Promise<unknown>;
  renderDocument(payload: RenderDocumentPayload): Promise<unknown>;
  sendNotification(payload: NotificationPayload): Promise<unknown>;
}

/** Encola el correo. El servicio hará los 3 intentos con espera creciente. */
export async function enqueueNotification(
  queue: NotificationQueue,
  payload: NotificationPayload,
): Promise<void> {
  await queue.add(SEND_NOTIFICATION_JOB, payload);
}

/** Trabajo despachable: BullMQ entrega `data`, las pruebas lo simulan. */
export interface DispatchableJob {
  name: string;
  data?: unknown;
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
): (job: DispatchableJob) => Promise<unknown> {
  return async (job) => {
    switch (job.name) {
      case EXPIRE_BOOKINGS_JOB:
        return handlers.expireBookings();
      case RENDER_DOCUMENT_JOB:
        return handlers.renderDocument(renderDocumentPayloadSchema.parse(job.data));
      case SEND_NOTIFICATION_JOB:
        return handlers.sendNotification(notificationPayloadSchema.parse(job.data));
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

  constructor(
    private readonly expiration: BookingExpirationService,
    private readonly rendering: DocumentRenderingService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    if (!jobsEnabled()) {
      this.logger.log("BullMQ deshabilitado: sin REDIS_URL o en pruebas.");
      return;
    }
    this.start(process.env.REDIS_URL as string);
  }

  /**
   * Encola el render desde la aprobación del pago. Sin Redis el documento
   * queda `PENDING` y se reintenta al configurar la cola (F1 no tiene reintento
   * manual desde la web; queda para F2).
   */
  async enqueueDocumentRender(payload: RenderDocumentPayload): Promise<void> {
    if (!this.queue) {
      this.logger.warn(
        `BullMQ deshabilitado: el documento ${payload.documentId} queda PENDING hasta configurar REDIS_URL.`,
      );
      return;
    }
    await enqueueDocumentRender(this.queue, payload);
  }

  /**
   * Encola el aviso tras el commit de la reserva. Sin Redis la fila queda
   * `PENDING` y el correo no se envía; F1 no tiene reintento manual (F2).
   */
  async enqueueNotification(payload: NotificationPayload): Promise<void> {
    if (!this.queue) {
      this.logger.warn(
        `BullMQ deshabilitado: el aviso ${payload.notificationId} queda PENDING hasta configurar REDIS_URL.`,
      );
      return;
    }
    await enqueueNotification(this.queue, payload);
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
        renderDocument: (payload) =>
          this.rendering.renderWithRetries(payload.documentId, payload.tenantId),
        sendNotification: (payload) =>
          this.notifications.sendWithRetries(payload.notificationId, payload.tenantId),
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
