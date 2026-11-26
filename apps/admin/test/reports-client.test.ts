import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@caribe/shared";
import {
  downloadSalesReportCsv,
  getSalesReport,
  listReportAgencies,
  resolveReportsAccess,
  type SalesReport,
  type SalesReportFilters,
} from "../src/lib/reports-client";

/**
 * Escenarios `reports` (T-F2-23) desde el panel: el cliente solo envía filtros
 * permitidos a la ruta ya aprobada, conserva los importes que calcula la API y
 * pide el CSV por la MISMA ruta. No calcula totales ni construye secretos.
 */
const filters: SalesReportFilters = {
  from: "2026-11-01",
  to: "2026-11-25",
};

const report: SalesReport = {
  from: filters.from,
  to: filters.to,
  agencyId: null,
  totals: { count: 2, amountUsd: "120.50", amountVes: "108450.00" },
  breakdown: [
    {
      method: "ZELLE",
      status: "APPROVED",
      count: 1,
      amountUsd: "100.00",
      amountVes: "90000.00",
    },
    {
      method: "BINANCE_PAY",
      status: "IN_REVIEW",
      count: 1,
      amountUsd: "20.50",
      amountVes: "18450.00",
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problem(status: number, code: string): Response {
  return json({ status, code, message: "error de prueba" }, status);
}

function fetchSpy(response: Response): typeof globalThis.fetch {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

function urlOf(fetchImpl: typeof globalThis.fetch): string {
  return String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
}

function queryOf(fetchImpl: typeof globalThis.fetch): URLSearchParams {
  return new URLSearchParams(urlOf(fetchImpl).split("?")[1] ?? "");
}

describe('reports › "Reporte por rango de fechas" (T-F2-23)', () => {
  it("pide JSON a la ruta aprobada con solo los filtros permitidos", async () => {
    const fetchImpl = fetchSpy(json(report));
    await expect(getSalesReport(filters, { fetchImpl })).resolves.toEqual(report);

    expect(urlOf(fetchImpl).startsWith("/api/v1/admin/reports/sales?")).toBe(true);
    const query = queryOf(fetchImpl);
    expect([...query.keys()].sort()).toEqual(["from", "to"]);
    expect(query.get("from")).toBe(filters.from);
    expect(query.get("to")).toBe(filters.to);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("envía agencyId solo cuando se elige una agencia y rechaza uno vacío", async () => {
    const withAgency = fetchSpy(json(report));
    await getSalesReport({ ...filters, agencyId: "org-123" }, { fetchImpl: withAgency });
    expect(queryOf(withAgency).get("agencyId")).toBe("org-123");

    const withoutAgency = fetchSpy(json(report));
    await getSalesReport(filters, { fetchImpl: withoutAgency });
    expect([...queryOf(withoutAgency).keys()].sort()).toEqual(["from", "to"]);

    const empty = fetchSpy(json(report));
    await expect(
      getSalesReport({ ...filters, agencyId: "" }, { fetchImpl: empty }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(empty).not.toHaveBeenCalled();
  });

  it("rechaza localmente rangos inválidos y campos inventados sin llamar a la API", async () => {
    const fetchImpl = fetchSpy(json(report));
    for (const bad of [
      { ...filters, from: "2026-13-99" },
      { from: filters.to, to: filters.from },
      { ...filters, amountUsd: "1.00" },
      { ...filters, limit: 1 },
    ]) {
      await expect(getSalesReport(bad, { fetchImpl })).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("conserva los importes como texto del servidor y descarta campos extraños", async () => {
    const fetchImpl = fetchSpy(
      json({
        ...report,
        tenantId: "otro-tenant",
        secret: "no-debe-pasar",
        totals: { ...report.totals, currentRate: "2000.0000" },
      }),
    );
    const parsed = await getSalesReport(filters, { fetchImpl });
    expect(parsed).toEqual(report);
    expect(parsed).not.toHaveProperty("tenantId");
    expect(parsed.totals).not.toHaveProperty("currentRate");
  });

  it("no oculta un error de la API", async () => {
    const fetchImpl = fetchSpy(problem(403, "FORBIDDEN"));
    await expect(getSalesReport(filters, { fetchImpl })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

describe('reports › "Alcance por rol" (T-F2-23)', () => {
  it("solo abre el panel a owner/admin de agencia y a Super Admin en plataforma", () => {
    expect(resolveReportsAccess("platform", null)).toMatchObject({
      visible: true,
      canRead: true,
      canSelectAgency: true,
      scope: "platform",
    });
    for (const role of ["owner", "admin"]) {
      expect(resolveReportsAccess("agency", role)).toMatchObject({
        visible: true,
        canRead: true,
        canSelectAgency: false,
        scope: "agency",
      });
    }
    for (const role of ["agent", "provider", "member", null]) {
      expect(resolveReportsAccess("agency", role)).toMatchObject({
        visible: false,
        canRead: false,
        canSelectAgency: false,
        scope: "agency",
      });
    }
  });

  it("toma las agencias del selector de la ruta de plataforma, no de las membresías", async () => {
    const fetchImpl = fetchSpy(
      json([{ id: "org-1", name: "Agencia Sol", slug: "agencia-sol" }]),
    );
    await expect(listReportAgencies({ fetchImpl })).resolves.toEqual([
      { id: "org-1", name: "Agencia Sol", slug: "agencia-sol" },
    ]);
    expect(urlOf(fetchImpl)).toBe("/api/v1/admin/organizations");
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("no deja pasar una respuesta que no sea un listado de agencias", async () => {
    const fetchImpl = fetchSpy(json({ organizations: [{ id: "org-1", name: "Agencia Sol" }] }));
    await expect(listReportAgencies({ fetchImpl })).resolves.toEqual([]);
  });
});

describe('reports › "Exportación CSV del reporte" (T-F2-23)', () => {
  it.each(["es", "en"] as const)("pide el CSV por la misma ruta con lang=%s", async (locale) => {
    const response = new Response("Método,Estado,Recuento,Suma USD,Suma VES\r\n", {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8" },
    });
    const fetchImpl = fetchSpy(response);
    const blob = await downloadSalesReportCsv(
      { ...filters, agencyId: "org-123" },
      locale,
      { fetchImpl },
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(urlOf(fetchImpl).startsWith("/api/v1/admin/reports/sales?")).toBe(true);
    const query = queryOf(fetchImpl);
    expect([...query.keys()].sort()).toEqual(["agencyId", "format", "from", "lang", "to"]);
    expect(query.get("format")).toBe("csv");
    expect(query.get("lang")).toBe(locale);
    expect(query.get("from")).toBe(filters.from);
    expect(query.get("to")).toBe(filters.to);
    expect(query.get("agencyId")).toBe("org-123");
    expect(query.has("limit")).toBe(false);
    expect(query.has("cursor")).toBe(false);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("rechaza un CSV inválido sin entregar un archivo vacío", async () => {
    const fetchImpl = fetchSpy(problem(422, "VALIDATION_ERROR"));
    await expect(downloadSalesReportCsv(filters, "es", { fetchImpl })).rejects.toBeInstanceOf(
      AuthApiError,
    );
  });
});
