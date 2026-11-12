import { z } from "@caribe/shared";

/**
 * Contrato de los ajustes de la agencia (T-F1-1a, design §2.1).
 *
 * Los defaults son los de negocio: 30 minutos de retencion, cobro automatico
 * y USD. La base de datos los repite (DEFAULT + CHECK) para que valgan
 * tambien fuera de la API.
 */
export const PAYMENT_MODES = ["AUTO", "MANUAL"] as const;

export type PaymentModeValue = (typeof PAYMENT_MODES)[number];

export const TENANT_SETTINGS_DEFAULTS = {
  holdMinutes: 30,
  paymentMode: "AUTO",
  baseCurrency: "USD",
} as const satisfies {
  holdMinutes: number;
  paymentMode: PaymentModeValue;
  baseCurrency: string;
};

/**
 * Cuerpo estricto del PUT (T-F1-0c): PUT parcial, pero al menos un campo.
 * `tenantId` y `updatedAt` son calculados y cualquier clave desconocida
 * responde 422 (Zod estricto). Los campos de contacto aceptan `null` para
 * vaciarlos.
 */
export const updateTenantSettingsSchema = z
  .strictObject({
    holdMinutes: z.number().int().min(5).max(1440).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    baseCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    legalName: z.string().trim().max(200).nullable().optional(),
    rif: z.string().trim().max(50).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.email().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Envía al menos un ajuste",
  });

export type UpdateTenantSettingsBody = z.infer<typeof updateTenantSettingsSchema>;

/** Ajustes efectivos tal como los expone la API (camelCase, fechas ISO). */
export interface TenantSettingsResponse {
  tenantId: string;
  holdMinutes: number;
  paymentMode: PaymentModeValue;
  baseCurrency: string;
  legalName: string | null;
  rif: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  updatedAt: string | null;
}

/** Fila de Prisma que necesita el mapeo (estructural, sin acoplarse al tipo). */
export interface TenantSettingsRow {
  tenantId: string;
  holdMinutes: number;
  paymentMode: PaymentModeValue;
  baseCurrency: string;
  legalName: string | null;
  rif: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  updatedAt: Date;
}

/**
 * Fila -> respuesta. Sin fila devuelve los defaults y `updatedAt` null: GET
 * nunca crea la fila (spec: los ajustes por defecto existen aunque no se
 * hayan guardado).
 */
export function toTenantSettingsResponse(
  row: TenantSettingsRow | null,
  tenantId: string,
): TenantSettingsResponse {
  if (!row) {
    return {
      tenantId,
      ...TENANT_SETTINGS_DEFAULTS,
      legalName: null,
      rif: null,
      address: null,
      phone: null,
      email: null,
      updatedAt: null,
    };
  }
  return {
    tenantId: row.tenantId,
    holdMinutes: row.holdMinutes,
    paymentMode: row.paymentMode,
    baseCurrency: row.baseCurrency,
    legalName: row.legalName,
    rif: row.rif,
    address: row.address,
    phone: row.phone,
    email: row.email,
    updatedAt: row.updatedAt.toISOString(),
  };
}
