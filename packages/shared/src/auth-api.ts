import type { Locale } from "./locale";

/**
 * Codigo de aplicacion del 403 que exige activar TOTP antes de usar endpoints
 * administrativos (spec auth-access). La API lo emite desde
 * AdminTwoFactorGuard y las UI lo reconocen con isTwoFactorRequired.
 */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

/** Prefijo de las rutas de Better Auth tras el proxy /api de cada frontend. */
export const AUTH_BASE_PATH = "/api/auth";

/** Lo minimo que las UI necesitan del usuario de sesion (Better Auth 1.7). */
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role?: string | string[] | null;
  twoFactorEnabled?: boolean | null;
}

/** Respuesta de GET /api/auth/get-session (sin sesion la API responde null). */
export interface SessionData {
  user: SessionUser;
  session?: { id?: string; [key: string]: unknown } | null;
}

/** Respuesta de POST /api/auth/sign-in/email. */
export interface SignInEmailResult {
  user?: SessionUser;
  /** true cuando el usuario tiene 2FA activo y el login quedo pendiente de verificarlo. */
  twoFactorRedirect?: boolean;
  twoFactorMethods?: string[];
}

/** Respuesta de POST /api/auth/two-factor/enable (method totp). */
export interface EnableTwoFactorResult {
  method?: string;
  /** URI otpauth:// para escanear en la app autenticadora. Solo al activar. */
  totpURI?: string;
  /** Codigos de recuperacion en claro: la API los devuelve UNA sola vez. */
  backupCodes?: string[];
}

/** Respuesta de POST /api/auth/two-factor/verify-totp. */
export interface VerifyTotpResult {
  status?: boolean;
}

/**
 * Error HTTP de la API para las UI: guarda el status y el codigo de aplicacion
 * (p. ej. TWO_FACTOR_REQUIRED) sin perder el mensaje.
 */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

/** true si el cuerpo del sign-in indica que falta verificar el segundo factor. */
export function twoFactorSignInPending(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
  );
}

/**
 * true si el error es el 403 con codigo TWO_FACTOR_REQUIRED que la API devuelve
 * a los roles administrativos sin TOTP activo (spec auth-access). Acepta tanto
 * AuthApiError como el cuerpo del error serializado (status o statusCode).
 */
export function isTwoFactorRequired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  return status === 403 && candidate.code === TWO_FACTOR_REQUIRED;
}

/** Modo en el que arranca la pantalla de segundo factor. */
export type TwoFactorScreenMode = "verify" | "activate" | "done";

/**
 * Decide el modo de la pantalla TOTP a partir de la sesion:
 * - sin sesion: login pendiente del segundo factor -> solo verificar;
 * - sesion sin TOTP: activacion (QR + clave manual);
 * - sesion con TOTP activo: nada que hacer aqui.
 *
 * La entrada es estructural (solo el campo que decide) para tolerar cuerpos
 * incompletos de la red; una SessionData real siempre es asignable.
 */
export function twoFactorScreenMode(
  session: { user?: Partial<SessionUser> | null } | null,
): TwoFactorScreenMode {
  if (!session?.user) return "verify";
  return session.user.twoFactorEnabled ? "done" : "activate";
}

/** Partes relevantes de un URI otpauth:// (RFC 6238 / clave manual). */
export interface OtpauthUri {
  secret: string;
  issuer?: string;
  account?: string;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function queryParam(query: string, name: string): string | null {
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (decode(part.slice(0, eq)) === name) return decode(part.slice(eq + 1));
  }
  return null;
}

/**
 * Parsea un URI otpauth://totp/Emisor:cuenta?secret=...&issuer=... sin
 * depender de la forma exacta en que Better Auth construye el label.
 * Devuelve null si falta el secreto o el scheme no es otpauth.
 */
export function parseOtpauthUri(uri: string): OtpauthUri | null {
  if (typeof uri !== "string" || !uri.startsWith("otpauth://")) return null;
  const rest = uri.slice("otpauth://".length);
  const questionMark = rest.indexOf("?");
  const path = questionMark >= 0 ? rest.slice(0, questionMark) : rest;
  const query = questionMark >= 0 ? rest.slice(questionMark + 1) : "";
  const secret = queryParam(query, "secret");
  if (!secret) return null;

  const slash = path.indexOf("/");
  const label = slash >= 0 ? decode(path.slice(slash + 1)) : "";
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon) : undefined;
  const account = (colon >= 0 ? label.slice(colon + 1) : label) || undefined;
  const issuer = queryParam(query, "issuer") ?? labelIssuer;
  return { secret, issuer, account };
}

/** Solo el secreto base32 del URI (entrada manual de la app autenticadora). */
export function secretFromOtpauthUri(uri: string): string | null {
  return parseOtpauthUri(uri)?.secret ?? null;
}

/**
 * Valida un redirectTo como ruta interna del idioma dado (empieza por
 * /${locale} o es exactamente /${locale}). Rechaza URLs absolutas,
 * protocolo-relativas, backslashes y segmentos "..". Normaliza la barra final.
 * Devuelve null para cualquier cosa que no sea una ruta local segura.
 */
export function safeLocalizedRedirectPath(path: unknown, locale: Locale): string | null {
  if (typeof path !== "string" || path === "") return null;
  const prefix = `/${locale}`;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  if (path.includes("\\") || path.includes("\0")) return null;
  if (/(^|\/)\.\.(\/|$)/.test(path)) return null;
  if (path.length > prefix.length && path.endsWith("/")) return path.slice(0, -1);
  return path;
}
