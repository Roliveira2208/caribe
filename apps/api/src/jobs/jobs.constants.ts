/**
 * Nombres, calendarios y arranque de los trabajos en segundo plano (T-F1-8,
 * design §3.3).
 *
 * Los identificadores son estables: `upsertJobScheduler` los usa como clave,
 * así que cambiarlos crearía un planificador nuevo en lugar de actualizar el
 * existente.
 */
export const JOBS_QUEUE_NAME = "caribe-jobs";

/** Expiración de retenciones vencidas (spec booking "Vencimiento de la retención"). */
export const EXPIRE_BOOKINGS_JOB = "bookings.expire";

/** Refresco de la tasa BCV global (spec exchange-rates "Fuente disponible"). */
export const REFRESH_RATE_JOB = "exchange-rate.refresh";

/** Cada minuto: la retención se mide en minutos y la spec pide ese ritmo. */
export const EXPIRE_BOOKINGS_SCHEDULE = "* * * * *";

/**
 * Una vez al día a medianoche de Caracas. La fecha valor de la tasa es la del
 * día calendario venezolano, así que el corte natural es esa medianoche y no
 * la UTC.
 */
export const REFRESH_RATE_SCHEDULE = "0 0 * * *";
export const RATE_TIMEZONE = "America/Caracas";

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
