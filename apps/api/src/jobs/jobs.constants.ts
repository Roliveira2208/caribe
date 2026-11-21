import type { WorkerOptions } from "bullmq";
import { z } from "@caribe/shared";

/**
 * Nombres, calendarios y arranque de los trabajos en segundo plano (T-F1-8,
 * design §3.3).
 *
 * Los identificadores son estables: `upsertJobScheduler` los usa como clave,
 * así que cambiarlos crearía un planificador nuevo en lugar de actualizar el
 * existente. La tasa no tiene trabajo propio desde T-F1-5b: se refresca de
 * forma perezosa al crear una sesión y antes de crear un pago.
 */
export const JOBS_QUEUE_NAME = "caribe-jobs";

/** Expiración de retenciones vencidas (spec booking "Vencimiento de la retención"). */
export const EXPIRE_BOOKINGS_JOB = "bookings.expire";

/** Cada minuto: la retención se mide en minutos y la spec pide ese ritmo. */
export const EXPIRE_BOOKINGS_SCHEDULE = "* * * * *";

/**
 * Barrido de filas `PENDING` huérfanas (T-F1-12b): si el proceso cae entre el
 * commit que reservó un documento o aviso y el encolado, la fila nunca se
 * procesa. Una pasada por agencia la re-encola pasados N minutos.
 */
export const RECOVER_PENDING_JOB = "jobs.recover-pending";

/** Igual que la expiración: la tolerancia se mide en minutos. */
export const RECOVER_PENDING_SCHEDULE = "* * * * *";

/** Umbral por defecto; se puede subir con `PENDING_RECOVERY_MINUTES`. */
export const DEFAULT_PENDING_RECOVERY_MINUTES = 5;

/** Entero positivo, o el valor por defecto si la variable no es válida. */
export function pendingRecoveryMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["PENDING_RECOVERY_MINUTES"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_PENDING_RECOVERY_MINUTES;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PENDING_RECOVERY_MINUTES;
}

/**
 * Renderizado de documentos (T-F1-11d, spec documents "Reintentos
 * automáticos"). Es un trabajo por evento: se encola al confirmar la reserva o
 * aprobar el pago, no tiene planificador propio.
 */
export const RENDER_DOCUMENT_JOB = "documents.render";

/** 3 intentos en total: el primero más 2 reintentos. */
export const DOCUMENT_JOB_ATTEMPTS = 3;

/** Espera creciente entre intentos, en milisegundos. */
export const DOCUMENT_JOB_DELAYS = [1000, 2000] as const;

/** Backoff exponencial equivalente para BullMQ. */
export const DOCUMENT_JOB_BACKOFF = { type: "exponential", delay: 1000 } as const;

/** Cuerpo del trabajo: sin PII, solo identificadores. Se valida al despachar. */
export const renderDocumentPayloadSchema = z.strictObject({
  documentId: z.uuid(),
  tenantId: z.string().min(1),
});

export type RenderDocumentPayload = z.infer<typeof renderDocumentPayloadSchema>;

/**
 * Correo de confirmación de reserva (T-F1-12, spec notifications "Correo
 * encolado"). El trabajo se encola tras confirmar la reserva; los 3 intentos y
 * la espera creciente los aplica `NotificationService`, no BullMQ, para que un
 * mismo evento no pueda enviarse nueve veces.
 */
export const SEND_NOTIFICATION_JOB = "notifications.send";

/** 3 intentos en total: el primero más 2 reintentos. */
export const NOTIFICATION_JOB_ATTEMPTS = 3;

/** Espera creciente entre intentos, en milisegundos. */
export const NOTIFICATION_JOB_DELAYS = [1000, 2000] as const;

/** Cuerpo del trabajo: sin PII, solo identificadores. Se valida al despachar. */
export const notificationPayloadSchema = z.strictObject({
  notificationId: z.uuid(),
  tenantId: z.string().min(1),
});

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

/**
 * BullMQ solo arranca con `REDIS_URL` configurado y fuera de las pruebas.
 *
 * Los e2e comparten PostgreSQL y no levantan Redis; con el planificador
 * apagado en `NODE_ENV=test` las suites no dependen de un servidor que no
 * existe. En producción sin `REDIS_URL` la API sigue sirviendo y los trabajos
 * se ejecutan a mano (o se reintentan al configurar Redis).
 */
export function jobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REDIS_URL) && env.NODE_ENV !== "test";
}

/**
 * Opciones del worker (fix de los errores de lock de `bookings.expire`).
 *
 * La expiración recorre todas las agencias en una sola pasada: con 2404 tenants
 * tarda ~15 s y el lock por defecto de BullMQ es 30 s. Cualquier pausa del
 * entorno (suspensión del equipo, breakpoint, blip de Redis) impedía renovar,
 * el job pasaba a stalled y el intento antiguo terminaba con `Missing lock ...
 * moveToFinished`. Se da holgura de 4x sobre el peor caso medido y se iguala
 * `stalledInterval` al lock para no robar un job que sigue corriendo.
 */
export const WORKER_LOCK_DURATION_MS = 120_000;
export const WORKER_STALLED_INTERVAL_MS = 120_000;
export const WORKER_CONCURRENCY = 1;

/**
 * Nota operativa de 2026-11-21 (segundo incidente): el barrido `jobs.recover-pending`
 * también sufrió `Missing lock ... moveToFinished` en ~3 % de 391 pasadas. El lock
 * se pierde por pausas transitorias del entorno (suspensión, breakpoint, blip de
 * Redis) y BullMQ lo reencola; el intento antiguo intenta cerrarlo después y avisa.
 * BullMQ renueva cada `lockRenewTime / 2`: con el valor por defecto son 30 s, así
 * que una pausa larga dentro de esa ventana basta para perder el lock. Se baja a
 * 5 s para acortar la ventana sin cambiar la detección de crashes (el lock sigue
 * siendo de 120 s). Los jobs terminados se acotan para que Redis no crezca sin
 * límite; no se consulta su historial.
 */
export const WORKER_LOCK_RENEW_TIME_MS = 10_000;
export const WORKER_KEEP_COMPLETED = { age: 3600, count: 1000 } as const;
export const WORKER_KEEP_FAILED = { age: 86400 } as const;

export function workerOptions(): Pick<
  WorkerOptions,
  | "lockDuration"
  | "stalledInterval"
  | "concurrency"
  | "lockRenewTime"
  | "removeOnComplete"
  | "removeOnFail"
> {
  return {
    lockDuration: WORKER_LOCK_DURATION_MS,
    stalledInterval: WORKER_STALLED_INTERVAL_MS,
    concurrency: WORKER_CONCURRENCY,
    lockRenewTime: WORKER_LOCK_RENEW_TIME_MS,
    removeOnComplete: WORKER_KEEP_COMPLETED,
    removeOnFail: WORKER_KEEP_FAILED,
  };
}

/**
 * Errores transitorios de lock de BullMQ. Se registran en WARN: el job se
 * recupera solo (la expiración es idempotente) y no son fallos del processor.
 */
export function isTransientLockError(message: string): boolean {
  return (
    message.includes("could not renew lock") ||
    message.includes("Missing lock for job") ||
    message.includes("lockRenewalFailed")
  );
}
