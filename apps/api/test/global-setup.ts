import { resetTestDatabase } from "./test-db.js";

/**
 * Limpieza global de `caribe_test`: se ejecuta una vez antes de todos los
 * archivos y otra al terminar. Cada e2e además limpia sus propias filas por
 * agencia; esto garantiza que ninguna corrida herede datos de la anterior.
 */
export async function setup(): Promise<void> {
  await resetTestDatabase();
}

export async function teardown(): Promise<void> {
  await resetTestDatabase();
}
