import { z } from "zod";

/**
 * Esquemas compartidos del catálogo (T-F1-1b, delta de catalog y design §2.2).
 *
 * El catálogo de F1 vende tipos de habitación de un hotel: cada producto lleva
 * `hotel_key` y `room_type`, y los atributos del hotel se repiten en cada tipo.
 * Estos esquemas son la única definición de validación: la API los consume
 * desde `@caribe/shared` y la base refuerza los mismos límites con CHECK y
 * triggers.
 */

const DATE_ONLY_MS = 24 * 60 * 60 * 1000;

/** Fecha calendario en la zona de Venezuela (YYYY-MM-DD). */
export function todayInCaracas(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Días desde epoch de una fecha YYYY-MM-DD, sin depender de la zona local. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DATE_ONLY_MS);
}

/**
 * URL absoluta `https` de un dominio permitido. Se rechazan credenciales
 * embebidas, otros esquemas, rutas relativas y hosts fuera de la lista.
 */
function imageUrlSchema(allowedImageHosts: readonly string[]) {
  const allowed = new Set(
    allowedImageHosts
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  );

  return z.string().superRefine((value, ctx) => {
    // Sin `URL` global: el paquete se compila con lib ES2023 y también corre
    // en el navegador. El host se extrae del authority y se valida aparte.
    const match = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);
    if (!match) {
      ctx.addIssue({ code: "custom", message: "La imagen debe ser una URL absoluta https" });
      return;
    }
    const authority = match[1] ?? "";
    if (authority.includes("@")) {
      ctx.addIssue({ code: "custom", message: "La URL de la imagen no admite credenciales" });
      return;
    }
    const hostname = authority.replace(/:\d+$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith(".") || hostname.endsWith(".")) {
      ctx.addIssue({ code: "custom", message: "El host de la imagen no es válido" });
      return;
    }
    if (!allowed.has(hostname)) {
      ctx.addIssue({ code: "custom", message: "El dominio de la imagen no está permitido" });
    }
  });
}

/**
 * Atributos de hotel. `stars`, `amenities` e `images` describen el hotel y se
 * repiten en cada tipo de habitación; `maxGuests` es la ocupación del tipo.
 * Estricto: una clave desconocida invalida el producto (422).
 */
export function hotelAttributesSchema(allowedImageHosts: readonly string[]) {
  return z.strictObject({
    stars: z.int().min(1).max(5),
    maxGuests: z.int().min(1).max(20),
    amenities: z.array(z.string().min(1).max(64)).max(30).default([]),
    images: z.array(imageUrlSchema(allowedImageHosts)).max(10).default([]),
  });
}

export type HotelAttributes = z.infer<ReturnType<typeof hotelAttributesSchema>>;

/**
 * Reglas de cancelación: de 1 a 10, con horas enteras no negativas
 * estrictamente descendentes y porcentajes enteros 0–100. El orden va de la
 * regla más generosa (más horas antes) a la más estricta.
 */
export const cancellationRulesSchema = z
  .array(
    z.strictObject({
      hours_before: z.int().min(0),
      percentage: z.int().min(0).max(100),
    }),
  )
  .min(1)
  .max(10)
  .superRefine((rules, ctx) => {
    for (let index = 1; index < rules.length; index += 1) {
      const previous = rules[index - 1];
      const current = rules[index];
      if (previous && current && current.hours_before >= previous.hours_before) {
        ctx.addIssue({
          code: "custom",
          path: [index, "hours_before"],
          message: "Las horas deben ser estrictamente descendentes",
        });
      }
    }
  });

export type CancellationRules = z.infer<typeof cancellationRulesSchema>;

/**
 * Rango de estancia `[checkIn, checkOut)` en fechas calendario de Caracas:
 * `checkOut > checkIn`, sin fechas pasadas y con un máximo de 30 noches. La
 * noche de salida no se ocupa.
 */
export function stayRangeSchema(options: { today?: string } = {}) {
  return z
    .strictObject({
      checkIn: z.iso.date(),
      checkOut: z.iso.date(),
    })
    .superRefine((range, ctx) => {
      const today = options.today ?? todayInCaracas();
      const checkIn = dayNumber(range.checkIn);
      const checkOut = dayNumber(range.checkOut);
      if (checkOut <= checkIn) {
        ctx.addIssue({
          code: "custom",
          path: ["checkOut"],
          message: "checkOut debe ser posterior a checkIn",
        });
        return;
      }
      if (checkIn < dayNumber(today)) {
        ctx.addIssue({
          code: "custom",
          path: ["checkIn"],
          message: "La fecha de entrada no puede ser pasada",
        });
      }
      if (checkOut - checkIn > 30) {
        ctx.addIssue({
          code: "custom",
          path: ["checkOut"],
          message: "La estancia no puede superar 30 noches",
        });
      }
    });
}

export type StayRange = z.infer<ReturnType<typeof stayRangeSchema>>;
