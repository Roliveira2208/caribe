import { AuthApiError, PAYMENT_METHODS } from "@caribe/shared";

/** Métodos y estados que el panel puede filtrar (spec payments). */
export const PAYMENT_FILTER_STATUSES = ["IN_REVIEW", "APPROVED", "REJECTED"] as const;
export const PAYMENT_FILTER_METHODS = PAYMENT_METHODS;

export type PaymentFilterStatus = (typeof PAYMENT_FILTER_STATUSES)[number] | "ALL";
export type PaymentFilterMethod = (typeof PAYMENT_FILTER_METHODS)[number] | "ALL";
export type PaymentReviewAction = "approve" | "reject";

/** Representación del pago que devuelve la API (montos como cadenas, design §7). */
export interface AdminPayment {
  id: string;
  bookingId: string;
  method: string;
  status: string;
  amountUsd: string;
  amountVes: string;
  rate: string;
  /** Par congelado por la API; la UI solo lo muestra como texto. */
  exchangeRateId: string;
  valueDate: string;
  reference: string | null;
  reportedBy: string;
  reviewedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

/** Matriz de lectura y revisión resuelta en el servidor (spec payments). */
export interface PaymentPanelAccess {
  canRead: boolean;
  canReview: boolean;
  scope: "agency" | "platform";
}

/**
 * La UI refleja la matriz de la API; la autoridad sigue siendo el servidor.
 * `agent` lee sin revisar; `provider` y `member` no leen; el Super Admin lee en
 * modo plataforma sin acciones de revisión.
 */
export function resolvePaymentPanelAccess(
  status: "ready" | "platform",
  role: string | null,
): PaymentPanelAccess {
  if (status === "platform") {
    return { canRead: true, canReview: false, scope: "platform" };
  }
  if (role === "owner" || role === "admin") {
    return { canRead: true, canReview: true, scope: "agency" };
  }
  if (role === "agent") {
    return { canRead: true, canReview: false, scope: "agency" };
  }
  return { canRead: false, canReview: false, scope: "agency" };
}

export interface AdminPaymentPage {
  items: AdminPayment[];
  nextCursor: string | null;
}

export interface PaymentFilters {
  status: PaymentFilterStatus;
  method: PaymentFilterMethod;
  /** Cursor opaco devuelto por la API; nunca se construye en el cliente. */
  cursor?: string | null;
}

export interface PaymentsApiOptions {
  /** fetch inyectable en pruebas; por defecto el del navegador. */
  fetchImpl?: typeof globalThis.fetch;
}

/** El motivo del rechazo es obligatorio y acota el cuerpo que acepta la API. */
export function validRejectionReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= 500;
}

/** Convierte una respuesta HTTP fallida en el error tipado que ya entiende la UI. */
async function readError(response: Response): Promise<AuthApiError> {
  const body = (await response.json().catch(() => null)) as
    | { message?: unknown; code?: unknown }
    | null;
  const message =
    typeof body?.message === "string" && body.message !== ""
      ? body.message
      : response.statusText;
  const code = typeof body?.code === "string" ? body.code : undefined;
  return new AuthApiError(response.status, message, code);
}

function parsePage(body: unknown): AdminPaymentPage {
  if (typeof body !== "object" || body === null) return { items: [], nextCursor: null };
  const candidate = body as { items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is AdminPayment => {
        if (typeof item !== "object" || item === null) return false;
        const row = item as Record<string, unknown>;
        return (
          typeof row["id"] === "string" &&
          typeof row["bookingId"] === "string" &&
          typeof row["status"] === "string" &&
          typeof row["amountUsd"] === "string" &&
          typeof row["amountVes"] === "string" &&
          typeof row["rate"] === "string" &&
          typeof row["exchangeRateId"] === "string" &&
          typeof row["valueDate"] === "string"
        );
      })
    : [];
  return {
    items,
    nextCursor: typeof candidate.nextCursor === "string" ? candidate.nextCursor : null,
  };
}

/** GET /api/v1/admin/payments con los filtros disponibles en el panel. */
export async function listAdminPayments(
  filters: PaymentFilters,
  options: PaymentsApiOptions = {},
): Promise<AdminPaymentPage> {
  const query = new URLSearchParams();
  if (filters.status !== "ALL") query.set("status", filters.status);
  if (filters.method !== "ALL") query.set("method", filters.method);
  if (filters.cursor) query.set("cursor", filters.cursor);
  const suffix = query.toString();
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/payments${suffix ? `?${suffix}` : ""}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return parsePage(await response.json().catch(() => null));
}

/** PATCH /api/v1/admin/payments/:id/(approve|reject). El motivo solo va en el rechazo. */
export async function reviewAdminPayment(
  paymentId: string,
  action: PaymentReviewAction,
  reason: string,
  options: PaymentsApiOptions = {},
): Promise<void> {
  if (action === "reject" && !validRejectionReason(reason)) {
    throw new AuthApiError(422, "Se requiere un motivo de rechazo.", "VALIDATION_ERROR");
  }
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/payments/${encodeURIComponent(paymentId)}/${action}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(action === "reject" ? { body: JSON.stringify({ reason: reason.trim() }) } : {}),
  });
  if (!response.ok) throw await readError(response);
}
