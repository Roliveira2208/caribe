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
