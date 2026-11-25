import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@caribe/shared";
import { getCurrentRate, resolveRateAccess, setRateOverride } from "../src/lib/rates-client";

/**
 * Escenarios `exchange-rates › "Campos calculados del cliente"` y
 * "Ver tasa vigente" (T-F2-8). El cliente del panel solo entrega texto decimal
 * y motivo; la API sigue siendo la autoridad.
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
    await expect(getCurrentRate({ fetchImpl })).resolves.toEqual(rate);
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/admin/exchange-rates/current", {
      credentials: "same-origin",
      cache: "no-store",
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
