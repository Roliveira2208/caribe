import { AuthApiError, isValidRateText } from "@caribe/shared";

/**
 * Cliente del panel de tasas (T-F2-8/T-F2-9). La API es la autoridad: aquí
 * solo se envían texto decimal y motivo, se conservan los códigos de problema
 * y se decide qué controles se muestran según el rol resuelto en servidor.
 */
export type RateAccessMode = "agency" | "platform";

export interface PendingRateView {
  valueDate: string;
  rate: string;
}

export interface ExchangeRateView {
  scope: RateAccessMode;
  valueDate: string;
  rate: string;
  source: string;
  isOverride: boolean;
  /** Primer override con fecha valor futura; nunca sustituye a la vigente. */
  pending?: PendingRateView | null;
}

/** Fila del historial: sin `tenantId`, sin secretos y sin campos calculados. */
export interface RateAudit {
  id: string;
  action: string;
  entityId: string;
  actorId: string | null;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface RateOverrideInput {
  rate: string;
  reason: string;
  valueDate?: string;
  /** Se admite para detectar campos calculados y rechazarlos antes de `fetch`. */
  [key: string]: unknown;
}

export interface RatesApiOptions {
  fetchImpl?: typeof globalThis.fetch;
  /** true para fijar la tasa global de plataforma en lugar de la de la agencia. */
  platform?: boolean;
}

export interface RateAccess {
  visible: boolean;
  canOverride: boolean;
  canViewHistory: boolean;
  mode: RateAccessMode;
}

interface RateAccessInput {
  mode: RateAccessMode;
  role: string | null | undefined;
}

const OVERRIDE_FIELDS = ["rate", "reason", "valueDate"] as const;
const RATE_AUDIT_ACTION = "exchange-rate.override";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** GET /api/v1/admin/exchange-rates/current: el texto decimal llega de la API. */
export async function getCurrentRate(
  options: RatesApiOptions = {},
): Promise<ExchangeRateView> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/v1/admin/exchange-rates/current", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json().catch(() => null);
  if (
    !isRecord(body) ||
    typeof body["rate"] !== "string" ||
    typeof body["valueDate"] !== "string" ||
    typeof body["source"] !== "string" ||
    typeof body["isOverride"] !== "boolean" ||
    (body["scope"] !== "agency" && body["scope"] !== "platform")
  ) {
    throw new AuthApiError(503, "Respuesta de tasa no válida.", "RATE_UNAVAILABLE");
  }
  return {
    scope: body["scope"],
    valueDate: body["valueDate"],
    rate: body["rate"],
    source: body["source"],
    isOverride: body["isOverride"],
    pending: readPending(body["pending"]),
  };
}

/** Un `pending` mal formado invalida la respuesta: no se inventa una tasa. */
function readPending(value: unknown): PendingRateView | null {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    typeof value["valueDate"] !== "string" ||
    typeof value["rate"] !== "string"
  ) {
    throw new AuthApiError(503, "Respuesta de tasa no válida.", "RATE_UNAVAILABLE");
  }
  return { valueDate: value["valueDate"], rate: value["rate"] };
}

/**
 * Valida el cuerpo en el cliente para no enviar montos calculados ni basura.
 * La API vuelve a validarlo con un esquema estricto.
 */
function validateOverride(body: RateOverrideInput): void {
  if (typeof body.rate !== "string" || !isValidRateText(body.rate)) {
    throw new AuthApiError(422, "La tasa debe ser un decimal positivo.", "VALIDATION_ERROR");
  }
  if (typeof body.reason !== "string" || body.reason.trim() === "" || body.reason.length > 200) {
    throw new AuthApiError(422, "El motivo es obligatorio.", "VALIDATION_ERROR");
  }
  if (body.valueDate !== undefined && (typeof body.valueDate !== "string" || body.valueDate === "")) {
    throw new AuthApiError(422, "La fecha valor no es válida.", "VALIDATION_ERROR");
  }
  const extra = Object.keys(body).find((key) => !OVERRIDE_FIELDS.includes(key as (typeof OVERRIDE_FIELDS)[number]));
  if (extra !== undefined) {
    throw new AuthApiError(422, "El cuerpo contiene campos no permitidos.", "VALIDATION_ERROR");
  }
}

/**
 * PUT /override o /global-override. El cuerpo se construye campo por campo:
 * nunca se reenvía el objeto recibido, aunque pase la validación local.
 */
export async function setRateOverride(
  body: RateOverrideInput,
  options: RatesApiOptions = {},
): Promise<ExchangeRateView> {
  validateOverride(body);
  const payload: { rate: string; reason: string; valueDate?: string } = {
    rate: body.rate,
    reason: body.reason.trim(),
  };
  if (body.valueDate !== undefined) payload.valueDate = body.valueDate;

  const path = options.platform
    ? "/api/v1/admin/exchange-rates/global-override"
    : "/api/v1/admin/exchange-rates/override";
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(path, {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json().catch(() => null)) as ExchangeRateView;
}

/**
 * HISTORIAL desde `GET /admin/audit-logs` (sin endpoint nuevo). El filtro de
 * acción viaja al servidor para no sobreleer auditoría de otros dominios; la
 * API limita el alcance a la agencia activa. El visor no expone `tenantId`.
 */
export async function listRateAudits(options: RatesApiOptions = {}): Promise<RateAudit[]> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(
    `/api/v1/admin/audit-logs?action=${encodeURIComponent(RATE_AUDIT_ACTION)}&limit=100`,
    {
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json().catch(() => null);
  const items = isRecord(body) && Array.isArray(body["items"]) ? body["items"] : [];

  const rows = items.flatMap((entry): RateAudit[] => {
    if (!isRecord(entry) || entry["action"] !== RATE_AUDIT_ACTION) return [];
    if (
      typeof entry["id"] !== "string" ||
      typeof entry["entityId"] !== "string" ||
      typeof entry["at"] !== "string"
    ) {
      return [];
    }
    const actorId = typeof entry["actorId"] === "string" ? entry["actorId"] : null;
    const before = isRecord(entry["before"]) ? entry["before"] : null;
    const after = isRecord(entry["after"]) ? entry["after"] : null;
    return [{ id: entry["id"], action: RATE_AUDIT_ACTION, entityId: entry["entityId"], actorId, at: entry["at"], before, after }];
  });

  // La spec del historial pide orden por fecha valor (la API ordena por `at`).
  return rows.sort((left, right) => {
    const byValueDate = valueDateOf(right).localeCompare(valueDateOf(left));
    return byValueDate !== 0 ? byValueDate : right.at.localeCompare(left.at);
  });
}

function valueDateOf(row: RateAudit): string {
  const date = row.after?.["valueDate"] ?? row.before?.["valueDate"];
  return typeof date === "string" ? date : "";
}

/**
 * Matriz de la UI: fallo cerrado. owner/admin escriben y ven el historial;
 * agent/provider solo leen la tasa; Super Admin en modo plataforma fija la
 * global sin ver historial de agencias.
 */
export function resolveRateAccess({ mode, role }: RateAccessInput): RateAccess {
  const hidden: RateAccess = {
    visible: false,
    canOverride: false,
    canViewHistory: false,
    mode,
  };
  if (mode === "platform") {
    return role === "super_admin"
      ? { visible: true, canOverride: true, canViewHistory: false, mode }
      : hidden;
  }
  if (role === "owner" || role === "admin") {
    return { visible: true, canOverride: true, canViewHistory: true, mode };
  }
  if (role === "agent" || role === "provider") {
    return { visible: true, canOverride: false, canViewHistory: false, mode };
  }
  return hidden;
}
