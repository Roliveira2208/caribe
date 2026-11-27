import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@caribe/shared";
import {
  getCurrentRate,
  listRateAudits,
  resolveRateAccess,
  setRateOverride,
} from "../src/lib/rates-client";

/**
 * Escenarios `exchange-rates › "Campos calculados del cliente"`,
 * "Ver tasa vigente", "Historial de overrides" y "Tasa global del Super Admin"
 * (T-F2-8/T-F2-9). El cliente del panel solo entrega texto decimal y motivo;
 * la API sigue siendo la autoridad.
 */
const rate = {
  scope: "agency",
  valueDate: "2026-11-25",
  rate: "950.0000",
  source: "MANUAL",
  isOverride: true,
} as const;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function problem(status: number, code: string): Response {
  return json({ status, code, message: "error de prueba" }, { status });
}

describe('exchange-rates › "Ver tasa vigente" (T-F2-8)', () => {
  it("lee la tasa del servidor sin calcular nada en el cliente", async () => {
    const fetchImpl = vi.fn(async () => json(rate));
    await expect(getCurrentRate({ fetchImpl })).resolves.toEqual({ ...rate, pending: null });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/admin/exchange-rates/current", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it('exchange-rates › "Fecha valor futura": conserva el pendiente sin aplicarlo', async () => {
    const pending = { valueDate: "2026-11-27", rate: "940.0000" };
    const fetchImpl = vi.fn(async () => json({ ...rate, pending }));
    await expect(getCurrentRate({ fetchImpl })).resolves.toEqual({ ...rate, pending });
  });

  it("rechaza un pendiente mal formado en vez de inventar una tasa", async () => {
    const fetchImpl = vi.fn(async () => json({ ...rate, pending: { rate: 940 } }));
    await expect(getCurrentRate({ fetchImpl })).rejects.toMatchObject({
      status: 503,
      code: "RATE_UNAVAILABLE",
    });
  });

  it("conserva el código de error de la API para traducirlo en la UI", async () => {
    const fetchImpl = vi.fn(async () => problem(403, "TWO_FACTOR_REQUIRED"));
    await expect(getCurrentRate({ fetchImpl })).rejects.toMatchObject({
      status: 403,
      code: "TWO_FACTOR_REQUIRED",
    });
  });
});

describe('exchange-rates › "Campos calculados del cliente" (T-F2-8)', () => {
  it("solo envía rate, reason y valueDate como texto", async () => {
    const fetchImpl = vi.fn(async () => json(rate));
    await setRateOverride(
      { rate: "950.0000", reason: "BCV no publicó", valueDate: "2026-11-25" },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/admin/exchange-rates/override", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rate: "950.0000",
        reason: "BCV no publicó",
        valueDate: "2026-11-25",
      }),
    });
  });

  it("fija la tasa global con la ruta de plataforma", async () => {
    const fetchImpl = vi.fn(async () => json({ ...rate, scope: "platform" }));
    await setRateOverride({ rate: "920.0000", reason: "Contingencia" }, {
      fetchImpl,
      platform: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/admin/exchange-rates/global-override",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it.each(["amountUsd", "amountVes", "amount_ves", "exchange_rate_id", "calculatedRate"])(
    "rechaza el campo calculado %s antes de fetch",
    async (field) => {
      const fetchImpl = vi.fn(async () => json(rate));
      const body = { rate: "950.0000", reason: "BCV no publicó", [field]: "1234" };
      await expect(setRateOverride(body, { fetchImpl })).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("rechaza tasas que no son texto decimal y motivos vacíos", async () => {
    const fetchImpl = vi.fn(async () => json(rate));
    await expect(
      setRateOverride({ rate: 950, reason: "BCV no publicó" } as unknown as {
        rate: string;
        reason: string;
      }, { fetchImpl }),
    ).rejects.toBeInstanceOf(AuthApiError);
    await expect(
      setRateOverride({ rate: "950.0000", reason: "   " }, { fetchImpl }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no oculta un 404 de la API", async () => {
    const fetchImpl = vi.fn(async () => problem(404, "NOT_FOUND"));
    await expect(
      setRateOverride({ rate: "950.0000", reason: "BCV no publicó" }, { fetchImpl }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe('exchange-rates › "Historial de overrides" (T-F2-9)', () => {
  it("toma el historial de audit_logs y no expone tenantId", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        items: [
          {
            id: "audit-1",
            tenantId: "otro-tenant",
            action: "exchange-rate.override",
            entity: "exchange-rate",
            entityId: "rate-1",
            actorId: "user-1",
            ip: "127.0.0.1",
            at: "2026-11-25T10:00:00.000Z",
            before: { rate: "900.0000", source: "COTIZAVE" },
            after: { rate: "950.0000", source: "MANUAL", reason: "BCV no publicó" },
          },
          {
            id: "audit-2",
            action: "booking.created",
            entity: "booking",
            entityId: "booking-1",
            actorId: "user-2",
            at: "2026-11-25T11:00:00.000Z",
            before: null,
            after: null,
          },
        ],
      }),
    );

    const rows = await listRateAudits({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/admin/audit-logs?action=exchange-rate.override&limit=100",
      { credentials: "same-origin", cache: "no-store" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "audit-1",
      actorId: "user-1",
      before: { rate: "900.0000" },
      after: { rate: "950.0000", reason: "BCV no publicó" },
    });
    expect(rows[0]).not.toHaveProperty("tenantId");
  });

  it("ordena el historial por fecha valor, no por el orden de auditoría", async () => {
    const audit = (id: string, valueDate: string, at: string) => ({
      id,
      action: "exchange-rate.override",
      entityId: `rate-${id}`,
      actorId: "user-1",
      at,
      before: { rate: "900.0000", valueDate },
      after: { rate: "950.0000", valueDate, reason: "Ajuste" },
    });
    const fetchImpl = vi.fn(async () =>
      json({
        items: [
          audit("audit-old", "2026-11-20", "2026-11-25T12:00:00.000Z"),
          audit("audit-new", "2026-11-25", "2026-11-21T08:00:00.000Z"),
          audit("audit-mid", "2026-11-22", "2026-11-23T09:00:00.000Z"),
        ],
      }),
    );

    const rows = await listRateAudits({ fetchImpl });
    expect(rows.map((row) => row.id)).toEqual(["audit-new", "audit-mid", "audit-old"]);
  });

  it("un 403 deja el historial vacío, sin filas residuales", async () => {
    const fetchImpl = vi.fn(async () => problem(403, "FORBIDDEN"));
    await expect(listRateAudits({ fetchImpl })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("matriz de acceso del panel de tasas (T-F2-8/T-F2-9)", () => {
  it("owner y admin escriben y consultan el historial; agente y proveedor solo leen", () => {
    expect(resolveRateAccess({ mode: "agency", role: "owner" })).toEqual({
      visible: true,
      canOverride: true,
      canViewHistory: true,
      mode: "agency",
    });
    expect(resolveRateAccess({ mode: "agency", role: "admin" })).toMatchObject({
      canOverride: true,
      canViewHistory: true,
    });
    for (const role of ["agent", "provider"]) {
      expect(resolveRateAccess({ mode: "agency", role })).toMatchObject({
        visible: true,
        canOverride: false,
        canViewHistory: false,
      });
    }
  });

  it("member y roles desconocidos no ven ni resumen: fallo cerrado", () => {
    for (const role of ["member", "viewer", "", null]) {
      expect(resolveRateAccess({ mode: "agency", role })).toEqual({
        visible: false,
        canOverride: false,
        canViewHistory: false,
        mode: "agency",
      });
    }
  });

  it("el Super Admin en modo plataforma fija solo la tasa global", () => {
    expect(resolveRateAccess({ mode: "platform", role: "super_admin" })).toEqual({
      visible: true,
      canOverride: true,
      canViewHistory: false,
      mode: "platform",
    });
  });
});
