import {
  AUTH_BASE_PATH,
  AuthApiError,
  type EnableTwoFactorResult,
  type SessionData,
  type SignInEmailResult,
  type VerifyTotpResult,
} from "./auth-api";

/**
 * Cliente de la API de autenticacion con fetch crudo (sin el cliente de
 * Better Auth en el bundle publico). Las rutas son relativas al origen de
 * cada frontend porque web y admin reenvian /api/:path* a la API: la cookie
 * de sesion queda de primera parte y no hace falta CORS.
 *
 * Los tipos son estructurales (sin lib de DOM) para que el paquete compile
 * igual en Node y en el navegador; la fetch global de ambos cumple la forma.
 */

/** Lo que el cliente necesita de una respuesta HTTP. */
export interface AuthResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

/** Init minimo que el cliente envia en cada peticion. */
export interface AuthRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: string;
  cache?: string;
}

/** fetch estructural: la global del navegador la satisface y los tests la mockean. */
export type AuthFetch = (url: string, init: AuthRequestInit) => Promise<AuthResponse>;

/** fetch inyectable para tests; por defecto la global del entorno. */
export interface AuthFetchOptions {
  fetch?: AuthFetch;
}

interface ErrorBody {
  message?: unknown;
  code?: string;
}

async function requestJson(
  path: string,
  init: AuthRequestInit,
  options: AuthFetchOptions,
): Promise<unknown> {
  const globalFetch = (globalThis as unknown as { fetch?: AuthFetch }).fetch;
  const doFetch = options.fetch ?? globalFetch;
  if (!doFetch) throw new Error("Este entorno no expone fetch");
  const response = await doFetch(path, { credentials: "same-origin", ...init });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const errorBody = (typeof body === "object" && body !== null ? body : {}) as ErrorBody;
    const message =
      typeof errorBody.message === "string" && errorBody.message !== ""
        ? errorBody.message
        : response.statusText;
    throw new AuthApiError(response.status, message, errorBody.code);
  }
  return body ?? null;
}

function postJson(path: string, payload: unknown, options: AuthFetchOptions): Promise<unknown> {
  return requestJson(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    options,
  );
}

/** POST /api/auth/sign-in/email. Con 2FA activo devuelve twoFactorRedirect. */
export async function signInEmail(
  email: string,
  password: string,
  options: AuthFetchOptions = {},
): Promise<SignInEmailResult> {
  return postJson(
    `${AUTH_BASE_PATH}/sign-in/email`,
    { email, password },
    options,
  ) as Promise<SignInEmailResult>;
}

/** POST /api/auth/sign-out. */
export async function signOut(options: AuthFetchOptions = {}): Promise<void> {
  await postJson(`${AUTH_BASE_PATH}/sign-out`, {}, options);
}

/** GET /api/auth/get-session; null cuando no hay sesion. */
export async function getSession(options: AuthFetchOptions = {}): Promise<SessionData | null> {
  const body = await requestJson(
    `${AUTH_BASE_PATH}/get-session`,
    { method: "GET", cache: "no-store" },
    options,
  );
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as { user?: unknown };
  return candidate.user && typeof candidate.user === "object" ? (body as SessionData) : null;
}

/** POST /api/auth/two-factor/enable (exige sesion y contrasena). */
export async function enableTwoFactor(
  password: string,
  options: AuthFetchOptions = {},
): Promise<EnableTwoFactorResult> {
  return postJson(
    `${AUTH_BASE_PATH}/two-factor/enable`,
    { password },
    options,
  ) as Promise<EnableTwoFactorResult>;
}

/** POST /api/auth/two-factor/verify-totp (activacion o login pendiente). */
export async function verifyTotp(
  code: string,
  options: AuthFetchOptions = {},
): Promise<VerifyTotpResult> {
  return postJson(
    `${AUTH_BASE_PATH}/two-factor/verify-totp`,
    { code },
    options,
  ) as Promise<VerifyTotpResult>;
}

/** POST /api/auth/two-factor/generate-backup-codes (exige contrasena). */
export async function generateBackupCodes(
  password: string,
  options: AuthFetchOptions = {},
): Promise<string[]> {
  const body = await postJson(
    `${AUTH_BASE_PATH}/two-factor/generate-backup-codes`,
    { password },
    options,
  );
  return (body as { backupCodes?: string[] }).backupCodes ?? [];
}

/**
 * GET same-origin a cualquier endpoint de la API a traves del proxy /api de la
 * app. Lanza AuthApiError (status + codigo de aplicacion) para que la UI pueda
 * distinguir 401, 403 TWO_FACTOR_REQUIRED y otros 403.
 */
export async function fetchJson(path: string, options: AuthFetchOptions = {}): Promise<unknown> {
  return requestJson(path, { method: "GET", cache: "no-store" }, options);
}
