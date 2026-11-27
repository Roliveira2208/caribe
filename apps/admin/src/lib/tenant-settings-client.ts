import { AuthApiError, type PaymentModeValue } from "@caribe/shared";

/** Respuesta mínima del endpoint de ajustes que consume la cabecera. */
export interface TenantSettingsSummary {
  paymentMode: PaymentModeValue;
}

export interface TenantSettingsClientOptions {
  cookieHeader?: string;
  /** Origen de la app, exigido por Better Auth. */
  origin?: string;
  /** API directa en server components; por defecto la del entorno. */
  apiUrl?: string;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * `GET /api/v1/admin/tenant-settings` con la sesión del servidor. La UI no
 * inventa el modo: si la API deniega o no hay agencia, no se muestra bandera.
 */
export async function getTenantSettings(
  options: TenantSettingsClientOptions = {},
): Promise<TenantSettingsSummary> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const apiUrl = options.apiUrl ?? process.env["API_URL"] ?? "http://localhost:3002";
  const origin = options.origin ?? process.env["ADMIN_URL"] ?? "http://localhost:3001";
  const response = await doFetch(`${apiUrl}/api/v1/admin/tenant-settings`, {
    headers: {
      ...(options.cookieHeader ? { cookie: options.cookieHeader } : {}),
      origin,
    },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new AuthApiError(response.status, "No se pudieron cargar los ajustes de la agencia");
  }
  const body = (await response.json().catch(() => null)) as { paymentMode?: unknown } | null;
  if (body?.paymentMode !== "AUTO" && body?.paymentMode !== "MANUAL") {
    throw new AuthApiError(502, "Respuesta de ajustes inválida");
  }
  return { paymentMode: body.paymentMode };
}
