import {
  cancellationRulesSchema,
  type CancellationRules,
  type DecimalValue,
} from "@caribe/shared";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Política de cancelación (T-F1-10, specs/booking "Cancelación" y
 * specs/payments "Reembolso").
 *
 * La regla `hours_before` se cuenta desde las 15:00 de America/Caracas del
 * día de check-in (dueño, 2026-11-16). Venezuela es UTC-4 sin horario de
 * verano, así que el instante del check-in es las 19:00Z de ese día.
 *
 * El porcentaje se toma del `policy_snapshot` congelado en la línea de la
 * reserva, nunca de la política actual del producto. La primera regla (el
 * snapshot va de más a menos horas) cuyo umbral ya se cumple decide; sin
 * reglas o con el check-in pasado no hay reembolso.
 */

/** Hora local de check-in que ancla las reglas `hours_before`. */
export const CHECK_IN_HOUR = 15;

/** Desfase fijo de America/Caracas respecto de UTC (sin DST). */
const CARACAS_OFFSET = "-04:00";

/** Regla de cancelación tal como vive en el `policy_snapshot`. */
export type CancellationRule = CancellationRules[number];

/** Snapshot de política congelado en `booking_items.policy_snapshot`. */
export interface PolicySnapshot {
  policyId: string | null;
  name: string | null;
  rules: CancellationRule[];
}

/** Instante del check-in: las 15:00 de Caracas del día indicado. */
export function checkInInstant(checkIn: string): Date {
  return new Date(`${checkIn}T${String(CHECK_IN_HOUR).padStart(2, "0")}:00:00.000${CARACAS_OFFSET}`);
}

/** Horas (fraccionarias) que faltan para el check-in; negativas si ya pasó. */
export function hoursUntilCheckIn(checkIn: string, now: Date): number {
  return (checkInInstant(checkIn).getTime() - now.getTime()) / 3_600_000;
}

/**
 * Porcentaje de reembolso según el snapshot. La primera regla con
 * `hoursUntilCheckIn >= hours_before` gana; sin reglas o check-in pasado, 0.
 */
export function refundPercentage(
  rules: readonly CancellationRule[],
  checkIn: string,
  now: Date,
): number {
  const hours = hoursUntilCheckIn(checkIn, now);
  if (hours < 0) return 0;
  const parsed = cancellationRulesSchema.safeParse(rules);
  if (!parsed.success) return 0;
  for (const rule of parsed.data) {
    if (hours >= rule.hours_before) return rule.percentage;
  }
  return 0;
}

/**
 * Montos del reembolso: USD redondeado a 2 decimales y VES calculado desde el
 * USD reembolsado con la tasa congelada del pago (no el VES original por
 * porcentaje), ambos con ROUND_HALF_UP.
 */
export function refundAmounts(
  amountUsd: DecimalValue,
  percentage: number,
  rate: DecimalValue,
): { amountUsd: string; amountVes: string } {
  const usd = new Prisma.Decimal(amountUsd.toString())
    .times(percentage)
    .div(100)
    .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  const ves = new Prisma.Decimal(usd)
    .times(new Prisma.Decimal(rate.toString()))
    .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  return { amountUsd: usd, amountVes: ves };
}

/**
 * Lee un `policy_snapshot` JSONB de forma defensiva. La base ya validó las
 * reglas al crear la reserva; un valor corrupto se trata como sin política
 * (0 %) en lugar de reembolsar de más.
 */
export function parsePolicySnapshot(value: unknown): PolicySnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { policyId: null, name: null, rules: [] };
  }
  const record = value as Record<string, unknown>;
  const rules = cancellationRulesSchema.safeParse(record["rules"]);
  return {
    policyId: typeof record["policyId"] === "string" ? record["policyId"] : null,
    name: typeof record["name"] === "string" ? record["name"] : null,
    rules: rules.success ? rules.data : [],
  };
}
