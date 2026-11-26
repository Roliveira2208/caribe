import { AuthApiError } from "@caribe/shared";

/**
 * Cliente del reporte de ventas del panel (T-F2-23, delta de reports). Solo
 * habla con `GET /admin/reports/sales`: construye query strings con claves
 * permitidas, conserva los importes que calcula la API y pide el CSV por la
 * MISMA ruta. Aquí no se suma, no se multiplica y no se adivina ningún total.
 */

export type ReportsMode = "agency" | "platform";
export type ReportLocale = "es" | "en";

export interface SalesReportFilters {
  from: string;
  to: string;
  agencyId?: string;
}

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

export interface ReportsPanelAccess {
  visible: boolean;
  canRead: boolean;
  canSelectAgency: boolean;
  scope: ReportsMode;
}

export interface ReportAgencyOption {
  id: string;
  name: string;
  slug: string;
}

export interface ReportsApiOptions {
  fetchImpl?: typeof globalThis.fetch;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_FIELDS = ["from", "to", "agencyId"] as const;

function validationError(field: string): AuthApiError {
  return new AuthApiError(422, `Solicitud no válida: ${field}`, "VALIDATION_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATE_ONLY.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function validateFilters(filters: SalesReportFilters): void {
  const candidate = filters as unknown as Record<string, unknown>;
  const extra = Object.keys(candidate).find(
    (field) => !FILTER_FIELDS.includes(field as (typeof FILTER_FIELDS)[number]),
  );
  if (extra !== undefined) throw validationError(extra);
  if (!isDate(candidate["from"])) throw validationError("from");
  if (!isDate(candidate["to"])) throw validationError("to");
  if (candidate["from"] > candidate["to"]) throw validationError("to");
  if (
    candidate["agencyId"] !== undefined &&
    (typeof candidate["agencyId"] !== "string" ||
      candidate["agencyId"] === "" ||
      candidate["agencyId"].length > 128)
  ) {
    throw validationError("agencyId");
  }
}

function queryString(filters: SalesReportFilters, extra: Record<string, string> = {}): string {
  validateFilters(filters);
  const query = new URLSearchParams();
  query.set("from", filters.from);
  query.set("to", filters.to);
  if (filters.agencyId) query.set("agencyId", filters.agencyId);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return query.toString();
}

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

function decimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^-?\d+\.\d{2}$/.test(value)) {
    throw new AuthApiError(503, `Respuesta de reporte no válida: ${field}`, "REPORT_UNAVAILABLE");
  }
  return value;
}

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AuthApiError(503, `Respuesta de reporte no válida: ${field}`, "REPORT_UNAVAILABLE");
  }
  return value;
}

function parseReport(body: unknown): SalesReport {
  if (
    !isRecord(body) ||
    !isDate(body["from"]) ||
    !isDate(body["to"]) ||
    (body["agencyId"] !== null && typeof body["agencyId"] !== "string") ||
    !isRecord(body["totals"]) ||
    !Array.isArray(body["breakdown"])
  ) {
    throw new AuthApiError(503, "Respuesta de reporte no válida.", "REPORT_UNAVAILABLE");
  }

  const totals = body["totals"];
  return {
    from: body["from"],
    to: body["to"],
    agencyId: body["agencyId"] as string | null,
    totals: {
      count: count(totals["count"], "totals.count"),
      amountUsd: decimal(totals["amountUsd"], "totals.amountUsd"),
      amountVes: decimal(totals["amountVes"], "totals.amountVes"),
    },
    breakdown: body["breakdown"].map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry["method"] !== "string" ||
        typeof entry["status"] !== "string"
      ) {
        throw new AuthApiError(503, "Respuesta de reporte no válida.", "REPORT_UNAVAILABLE");
      }
      return {
        method: entry["method"],
        status: entry["status"],
        count: count(entry["count"], "breakdown.count"),
        amountUsd: decimal(entry["amountUsd"], "breakdown.amountUsd"),
        amountVes: decimal(entry["amountVes"], "breakdown.amountVes"),
      };
    }),
  };
}

/** `GET /admin/reports/sales` en JSON: totales y desglose llegan calculados. */
export async function getSalesReport(
  filters: SalesReportFilters,
  options: ReportsApiOptions = {},
): Promise<SalesReport> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/reports/sales?${queryString(filters)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return parseReport(await response.json().catch(() => null));
}

/**
 * CSV por la misma ruta, con los MISMOS filtros y `lang` del idioma activo.
 * No hay `limit` ni `cursor`: el MVP no pagina la exportación.
 */
export async function downloadSalesReportCsv(
  filters: SalesReportFilters,
  locale: ReportLocale,
  options: ReportsApiOptions = {},
): Promise<Blob> {
  const query = queryString(filters, { format: "csv", lang: locale });
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/reports/sales?${query}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return response.blob();
}

/** Matriz de la UI, fallo cerrado. La API sigue siendo la autoridad. */
export function resolveReportsAccess(
  mode: ReportsMode,
  role: string | null | undefined,
): ReportsPanelAccess {
  if (mode === "platform") {
    return { visible: true, canRead: true, canSelectAgency: true, scope: "platform" };
  }
  if (role === "owner" || role === "admin") {
    return { visible: true, canRead: true, canSelectAgency: false, scope: "agency" };
  }
  return { visible: false, canRead: false, canSelectAgency: false, scope: "agency" };
}

/**
 * Agencias del selector del Super Admin (delta de auth-access). La ruta de
 * plataforma devuelve todas, a diferencia de `/api/auth/organization/list`,
 * que solo ve membresías. Se acepta solo el par id/nombre/slug.
 */
export async function listReportAgencies(
  options: ReportsApiOptions = {},
): Promise<ReportAgencyOption[]> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/v1/admin/organizations", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry): ReportAgencyOption[] => {
    if (
      !isRecord(entry) ||
      typeof entry["id"] !== "string" ||
      entry["id"] === "" ||
      typeof entry["name"] !== "string" ||
      entry["name"] === "" ||
      typeof entry["slug"] !== "string" ||
      entry["slug"] === ""
    ) {
      return [];
    }
    return [{ id: entry["id"], name: entry["name"], slug: entry["slug"] }];
  });
}
