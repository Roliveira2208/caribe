import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { API_PORT } from "@caribe/shared";

/**
 * Directorio local de los PDF (T-F1-11, spec documents "Almacenamiento y
 * descarga"). Sin variable configurada se usa el directorio temporal del
 * sistema: nunca una ruta dentro del repositorio, que no debe contener PDFs.
 */
export function resolveDocumentsDir(value: string | undefined): string {
  const configured = value?.trim();
  const dir = configured && configured.length > 0 ? configured : resolve(tmpdir(), "caribe-documents");
  return isAbsolute(dir) ? resolve(dir) : resolve(process.cwd(), dir);
}

/** Configuración del único transporte de correo de F1 (spec notifications). */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** SMTP local por defecto (Mailpit): sin host configurado no se envía nada. */
export function resolveSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const port = Number.parseInt((env.SMTP_PORT ?? "").trim(), 10);
  return {
    host: env.SMTP_HOST?.trim() ?? "",
    port: Number.isFinite(port) && port > 0 ? port : 1025,
    user: env.SMTP_USER?.trim() ?? "",
    password: env.SMTP_PASSWORD ?? "",
    from: env.SMTP_FROM?.trim() || "Caribe <no-reply@example.com>",
  };
}

/** Origen de la URL absoluta que codifica el QR del voucher. */
export function resolveWebBaseUrl(value: string | undefined): string {
  const configured = value?.trim();
  const url = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

/** Proxies de confianza (T-F2-2): direcciones o rangos CIDR separados por comas. */
export function resolveTrustedProxies(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Orígenes autorizados para CORS (T-F2-3): lista exacta, sin comodines. */
export function resolveTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Umbral de login compartido por el middleware propio y Better Auth. */
export const loginRateLimit = {
  windowSeconds: 60,
  max: 10,
} as const;

/**
 * Umbrales de las rutas de negocio (T-F2-4, spec security). La ventana es la
 * misma para las cuatro familias; cada familia tiene su propio contador para
 * que una descarga no consuma el cupo de reservas ni una revisión el del alta.
 */
export interface BusinessRateLimits {
  windowSeconds: number;
  bookings: number;
  payments: number;
  paymentReviews: number;
  downloads: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Valores por defecto pensados para una persona, no para un lote: 10 altas que
 * mutan estado por minuto, 20 revisiones de personal y 60 lecturas de PDF.
 * Un valor inválido cae al valor por defecto en lugar de dejar la ruta sin
 * protección.
 */
export function resolveBusinessRateLimits(env: NodeJS.ProcessEnv = process.env): BusinessRateLimits {
  return {
    windowSeconds: positiveInt(env.RATE_LIMIT_WINDOW_SECONDS, 60),
    bookings: positiveInt(env.RATE_LIMIT_BOOKINGS_MAX, 10),
    payments: positiveInt(env.RATE_LIMIT_PAYMENTS_MAX, 10),
    paymentReviews: positiveInt(env.RATE_LIMIT_PAYMENT_REVIEWS_MAX, 20),
    downloads: positiveInt(env.RATE_LIMIT_DOWNLOADS_MAX, 60),
  };
}

export const apiConfig = {
  port: API_PORT,
  basePath: "/api/v1",
  documentsDir: resolveDocumentsDir(process.env.DOCUMENTS_DIR),
  webBaseUrl: resolveWebBaseUrl(process.env.WEB_URL),
  smtp: resolveSmtpConfig(),
} as const;
