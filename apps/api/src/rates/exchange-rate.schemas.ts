import { isValidRateText, todayInCaracas, z } from "@caribe/shared";

/**
 * Contrato de tasas (T-F1-5, spec exchange-rates "Ajuste manual").
 *
 * El cuerpo del override es estricto y la tasa entra como texto decimal: el
 * servicio nunca acepta un `number` del cliente. El motivo es obligatorio y la
 * fecha valor, si se envía, no puede estar en el pasado (zona America/Caracas).
 */

/** Tasa con hasta 14 enteros y 1–4 decimales, mayor que cero. */
export const rateTextSchema = z
  .string()
  .trim()
  .refine(isValidRateText, {
    message: "La tasa debe ser un decimal mayor que cero con hasta 4 decimales",
  });

export const overrideRateSchema = z
  .strictObject({
    rate: rateTextSchema,
    valueDate: z.iso.date().optional(),
    reason: z.string().trim().min(1).max(200),
  })
  .superRefine((value, ctx) => {
    if (value.valueDate !== undefined && value.valueDate < todayInCaracas()) {
      ctx.addIssue({
        code: "custom",
        path: ["valueDate"],
        message: "La fecha valor no puede estar en el pasado",
      });
    }
  });

export type OverrideRateBody = z.infer<typeof overrideRateSchema>;

/** Ámbito de la tasa leída: agencia concreta o plataforma (global). */
export type RateScope = "agency" | "platform";

/** Tasa vigente serializada: fecha `YYYY-MM-DD` y tasa con 4 decimales. */
export interface ExchangeRateView {
  scope: RateScope;
  valueDate: string;
  rate: string;
  source: string;
  isOverride: boolean;
}

/**
 * Lectura pública de la tasa global vigente (change
 * public-rate-and-price-filters). Solo expone lo que la web necesita para
 * mostrar USD y su equivalente VES con fecha valor; nunca el ámbito, la
 * procedencia ni un override de agencia.
 */
export interface TodayRateView {
  available: boolean;
  rate: string | null;
  valueDate: string | null;
}
