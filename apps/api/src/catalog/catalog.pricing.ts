import type { DecimalValue } from "@caribe/shared";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Equivalente informativo en VES de un monto USD (T-F1-6, design §5 y §6).
 *
 * La tasa entra como texto DECIMAL(18,4) y la multiplicación se hace con
 * `Prisma.Decimal` (decimal.js), nunca con `number`: el redondeo es
 * `ROUND_HALF_UP` a 2 decimales. Sin tasa global el catálogo solo muestra USD
 * y el campo VES queda `null`.
 */
export function vesAmount(usd: DecimalValue, rate: string | null): string | null {
  if (rate === null) return null;
  return new Prisma.Decimal(usd.toString())
    .times(rate)
    .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
}
