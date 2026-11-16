import { describe, expect, it } from "vitest";
import {
  isValidRateText,
  parseRateText,
  todayInCaracas,
} from "@caribe/shared";
import { CircuitBreaker } from "../src/rates/circuit-breaker.js";
import { CotizaveProvider } from "../src/rates/cotizave.provider.js";
import { ExchangeRateService } from "../src/rates/exchange-rate.service.js";
import { RateCache } from "../src/rates/rate-cache.js";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import type { TenantService } from "../src/tenant/tenant.service.js";

/**
 * Unitarios de tasas (T-F1-5 y T-F1-5b): validación del texto de la tasa,
 * circuit breaker, caché, proveedor Cotizave y precedencia/respaldo/refresco
 * perezoso del servicio con un proveedor y una transacción falsos. Los
 * escenarios que exigen base de datos y sesiones viven en
 * exchange-rates.e2e.ts.
 */

describe("texto de la tasa", () => {
  it("acepta decimales positivos con hasta 4 decimales", () => {
    for (const value of ["1", "900", "900.0000", "0.0001", "12345678901234.9999"]) {
      expect(isValidRateText(value)).toBe(true);
      expect(parseRateText(value)).toBe(value);
    }
  });

  it("rechaza cero, negativos, texto y más de 4 decimales", () => {
    for (const value of ["0", "0.0000", "-1", "1e3", "900.00001", "abc", "", " 900"]) {
      expect(isValidRateText(value)).toBe(false);
      expect(() => parseRateText(value)).toThrow(RangeError);
    }
  });
});

describe("circuit breaker", () => {
  it("se abre tras 3 fallos y reintenta a los 60 s", () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 60_000, () => now);
    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(false);

    now = 59_999;
    expect(breaker.canRequest()).toBe(false);
    now = 60_000;
    expect(breaker.canRequest()).toBe(true);
  });

  it("un acierto cierra el breaker y reinicia el contador", () => {
    const now = 0;
    const breaker = new CircuitBreaker(2, 60_000, () => now);
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.canRequest()).toBe(true);
  });
});

describe("caché de tasas", () => {
  it("guarda, expira y borra sin Redis", async () => {
    let now = 0;
    const cache = new RateCache(undefined, () => now);
    await cache.set("k", "900.0000", 1_000);
    await expect(cache.get("k")).resolves.toBe("900.0000");

    now = 1_001;
    await expect(cache.get("k")).resolves.toBeNull();
    await cache.close();
  });
});

describe("proveedor Cotizave", () => {
  function response(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  it("elige ve-bcv, envía la clave en X-API-Key y usa effective_date", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const provider = new CotizaveProvider({
      url: "https://cotizave.test/v2/fx/VE/rates",
      apiKey: "ctz_live_secreta",
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenHeaders = init?.headers as Record<string, string>;
        return response({
          rates: [
            { id: "ve-usd", mid: 1.1 },
            { id: "ve-bcv", mid: 900.5, effective_date: "2026-11-14" },
          ],
        });
      },
    });

    await expect(provider.getRate("2026-11-15")).resolves.toEqual({
      rate: "900.5",
      valueDate: "2026-11-14",
    });
    expect(seenHeaders["x-api-key"]).toBe("ctz_live_secreta");
    expect(seenUrl).not.toContain("ctz_live_secreta");
  });

  it("usa updated_at en Caracas si falta effective_date", async () => {
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      fetchImpl: async () =>
        response({
          rates: [
            {
              id: "ve-bcv",
              mid: "900.0000",
              updated_at: "2026-11-14T23:00:00-04:00",
            },
          ],
        }),
    });

    await expect(provider.getRate("2026-11-15")).resolves.toEqual({
      rate: "900.0000",
      valueDate: "2026-11-14",
    });
  });

  it("usa la fecha pedida si la fuente no informa fecha valor", async () => {
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      fetchImpl: async () => response({ rates: [{ id: "ve-bcv", mid: 900 }] }),
    });

    await expect(provider.getRate("2026-11-15")).resolves.toEqual({
      rate: "900",
      valueDate: "2026-11-15",
    });
  });

  it("reintenta una vez y acepta el segundo intento", async () => {
    let calls = 0;
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      retries: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("red caída");
        return response({ rates: [{ id: "ve-bcv", mid: "900.0000" }] });
      },
    });

    await expect(provider.getRate("2026-11-14")).resolves.toEqual({
      rate: "900.0000",
      valueDate: "2026-11-14",
    });
    expect(calls).toBe(2);
  });

  it("trata una tasa inválida como fallo del proveedor", async () => {
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      retries: 0,
      fetchImpl: async () => response({ rates: [{ id: "ve-bcv", mid: 0 }] }),
    });
    await expect(provider.getRate("2026-11-14")).rejects.toThrow(RangeError);
  });

  it("sin COTIZAVE_API_KEY falla sin llamar al proveedor", async () => {
    let calls = 0;
    const provider = new CotizaveProvider({
      apiKey: "",
      fetchImpl: async () => {
        calls += 1;
        return response({ rates: [] });
      },
    });
    await expect(provider.getRate("2026-11-14")).rejects.toThrow(/COTIZAVE_API_KEY/);
    expect(calls).toBe(0);
  });

  it("corta las llamadas mientras el breaker está abierto", async () => {
    let now = 0;
    let calls = 0;
    const breaker = new CircuitBreaker(3, 60_000, () => now);
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      retries: 0,
      breaker,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("red caída");
      },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(provider.getRate("2026-11-14")).rejects.toThrow("red caída");
    }
    await expect(provider.getRate("2026-11-14")).rejects.toThrow(/circuit breaker/);
    expect(calls).toBe(3);

    now = 60_001;
    await expect(provider.getRate("2026-11-14")).rejects.toThrow("red caída");
    expect(calls).toBe(4);
  });

  it("respeta el timeout de 5 s por intento", async () => {
    const provider = new CotizaveProvider({
      apiKey: "ctz_live_secreta",
      timeoutMs: 10,
      retries: 0,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
        }),
    });
    await expect(provider.getRate("2026-11-14")).rejects.toThrow("abortado");
  });
});

// ---------------------------------------------------------------------------
// Servicio con proveedor y transacción falsos
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  tenantId: string | null;
  source: string;
  rate: string;
  valueDate: Date;
  fetchedAt: Date;
  isOverride: boolean;
  reason: string | null;
}

function fakeTx(rows: FakeRow[]) {
  const executed: unknown[] = [];
  const fetchedToday = rows.some(
    (row) => todayInCaracas(row.fetchedAt) === todayInCaracas(),
  );
  const tx = {
    exchangeRate: {
      findFirst: async (args: {
        where: { tenantId: string | null; valueDate?: { lte?: Date } };
        orderBy: { valueDate: "desc" };
      }) => {
        const { where } = args;
        let candidates = rows.filter((row) =>
          where.tenantId === null ? row.tenantId === null : row.tenantId === where.tenantId,
        );
        const lte = where.valueDate?.lte;
        if (lte) {
          candidates = candidates.filter((row) => row.valueDate.getTime() <= lte.getTime());
        }
        candidates.sort((a, b) => b.valueDate.getTime() - a.valueDate.getTime());
        return candidates[0] ?? null;
      },
      findUniqueOrThrow: async (args: { where: { id: string } }) => {
        const row = rows.find((item) => item.id === args.where.id);
        if (!row) throw new Error("fila inexistente");
        return row;
      },
    },
    $executeRaw: async (query: unknown) => {
      executed.push(query);
      return 1;
    },
    $queryRaw: async () => (fetchedToday ? [{ id: "consultada-hoy" }] : []),
  };
  return { tx, executed };
}

function fakeTenantService(tx: unknown): TenantService {
  return {
    withTenant: (_tenantId: string, fn: (value: unknown) => unknown) => fn(tx),
    withPlatform: (fn: (value: unknown) => unknown) => fn(tx),
    withPublic: (fn: (value: unknown) => unknown) => fn(tx),
    withRatesGlobal: (fn: (value: unknown) => unknown) => fn(tx),
  } as unknown as TenantService;
}

function rowAt(id: string, date: string, rate: string, tenantId: string | null = null): FakeRow {
  return {
    id,
    tenantId,
    source: tenantId ? "MANUAL" : "COTIZAVE",
    rate,
    valueDate: new Date(`${date}T00:00:00.000Z`),
    fetchedAt: new Date(`${date}T12:00:00.000Z`),
    isOverride: tenantId !== null,
    reason: tenantId ? "Ajuste" : null,
  };
}

const failingProvider = {
  getRate: async () => {
    throw new Error("fuente caída");
  },
};

describe("servicio de tasas", () => {
  it("aplica la precedencia override de agencia > global y respeta la tenencia", async () => {
    const today = todayInCaracas();
    const rows = [
      rowAt("global", today, "900.0000"),
      rowAt("agency-a", today, "950.0000", "org-a"),
    ];
    const { tx } = fakeTx(rows);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      failingProvider,
      new RateCache(undefined),
    );

    await expect(
      service.currentRate({ tenantId: "org-a", userId: "user-a", isPlatform: false }),
    ).resolves.toMatchObject({ scope: "agency", rate: "950.0000" });
    await expect(
      service.currentRate({ tenantId: "org-b", userId: "user-b", isPlatform: false }),
    ).resolves.toMatchObject({ scope: "agency", rate: "900.0000" });
    await expect(service.globalRate(today)).resolves.toMatchObject({
      scope: "platform",
      rate: "900.0000",
    });
    await expect(service.agencyRate("org-a", today)).resolves.toMatchObject({
      rate: "950.0000",
    });
  });

  it("usa la última fecha <= la pedida y falla con 503 si no hay ninguna", async () => {
    const today = todayInCaracas();
    const yesterday = shiftDate(today, -1);
    const rows = [rowAt("global", yesterday, "890.0000")];
    const { tx } = fakeTx(rows);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      failingProvider,
      new RateCache(undefined),
    );

    await expect(service.globalRate(today)).resolves.toMatchObject({
      valueDate: yesterday,
      rate: "890.0000",
    });
    await expect(service.globalRate(shiftDate(today, -2))).rejects.toMatchObject({
      code: "RATE_UNAVAILABLE",
    });
  });

  it("sin ninguna fila y fuente caída responde RATE_UNAVAILABLE", async () => {
    const { tx } = fakeTx([]);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      failingProvider,
      new RateCache(undefined),
    );

    // El refresco no propaga el fallo del proveedor: la resolución posterior
    // es la que decide el 503.
    await expect(service.ensureTodayRate()).resolves.toBeUndefined();
    const error = await service.globalRate(todayInCaracas()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiProblemException);
    expect((error as ApiProblemException).code).toBe("RATE_UNAVAILABLE");
  });

  it("no llama al proveedor si ya hay una fila consultada hoy", async () => {
    const today = todayInCaracas();
    let calls = 0;
    const provider = {
      getRate: async () => {
        calls += 1;
        return { rate: "910.0000", valueDate: today };
      },
    };
    const { tx, executed } = fakeTx([rowAt("global", today, "900.0000")]);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      provider,
      new RateCache(undefined),
    );

    await service.ensureTodayRate();
    await service.ensureTodayRate();
    expect(calls).toBe(0);
    expect(executed.length).toBe(0);
  });

  it("consulta una sola vez y guarda la fila global de Cotizave", async () => {
    const today = todayInCaracas();
    let calls = 0;
    const provider = {
      getRate: async () => {
        calls += 1;
        return { rate: "910.0000", valueDate: today };
      },
    };
    const { tx, executed } = fakeTx([rowAt("global", shiftDate(today, -1), "900.0000")]);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      provider,
      new RateCache(undefined),
    );

    await Promise.all([service.ensureTodayRate(), service.ensureTodayRate()]);
    expect(calls).toBe(1);
    expect(executed.length).toBe(1);
    const sql = executed[0] as { strings: readonly string[] };
    expect(sql.strings.join("?")).toContain("'COTIZAVE'");
    expect(sql.strings.join("?")).toContain("AT TIME ZONE 'UTC'");
  });

  it("un fallo del proveedor conserva el respaldo y no escribe", async () => {
    const today = todayInCaracas();
    const yesterday = shiftDate(today, -1);
    const { tx, executed } = fakeTx([rowAt("global", yesterday, "890.0000")]);
    const service = new ExchangeRateService(
      fakeTenantService(tx),
      failingProvider,
      new RateCache(undefined),
    );

    await expect(service.ensureTodayRate()).resolves.toBeUndefined();
    expect(executed.length).toBe(0);
    await expect(service.globalRate(today)).resolves.toMatchObject({
      valueDate: yesterday,
      rate: "890.0000",
    });
  });
});

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
