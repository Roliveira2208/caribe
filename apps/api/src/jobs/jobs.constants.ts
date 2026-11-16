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
