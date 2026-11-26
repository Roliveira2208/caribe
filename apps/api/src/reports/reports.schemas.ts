import { z } from "@caribe/shared";

/**
 * Contrato de `GET /admin/reports/sales` (T-F2-23, delta de reports).
 *
 * El esquema es estricto: el CSV se pide con `format=csv` en la MISMA ruta y un
 * parámetro desconocido responde 422. No hay límite ni paginación en el MVP, de
 modo que `limit`/`cursor` no existen en este contrato. `lang=es|en` elige los
 encabezados del CSV; sin preferencia explícita se usa `es`.
 */
export const salesReportQuerySchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    // Better Auth genera IDs de organización opacos (no UUID): se valida que
    // sea un identificador no vacío, sin imponer un formato inexistente.
    agencyId: z.string().min(1).max(128).optional(),
    format: z.enum(["json", "csv"]).optional(),
    lang: z.enum(["es", "en"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "to debe ser mayor o igual que from",
      });
    }
  });

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

/** Fila del desglose: método y estado de la máquina de pagos de `payments`. */
export interface SalesReportRow {
  method: string;
  status: string;
  count: number;
  amountUsd: string;
  amountVes: string;
}

export interface SalesReport {
  from: string;
  to: string;
  agencyId: string | null;
  totals: { count: number; amountUsd: string; amountVes: string };
  breakdown: SalesReportRow[];
}
