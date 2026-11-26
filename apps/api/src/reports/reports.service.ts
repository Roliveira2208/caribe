import { Injectable } from "@nestjs/common";
import { formatAmount, type DecimalValue } from "@caribe/shared";
import { addDays } from "../catalog/catalog.schemas.js";
import type { Prisma } from "../generated/prisma/client.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { ReportActor } from "./reports.guard.js";
import type { SalesReport, SalesReportQuery, SalesReportRow } from "./reports.schemas.js";

/**
 * Reporte de ventas (T-F2-23, specs/reports). Las sumas corren en SQL con
 * DECIMAL dentro del contexto RLS elegido por el actor; el servicio nunca
 * multiplica montos ni usa la tasa vigente. `createdAt` es la fecha del pago
 * usada por el rango, y Caracas es UTC-4 todo el año.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenant: TenantService) {}

  async sales(actor: ReportActor, query: SalesReportQuery): Promise<SalesReport> {
    const agencyId = actor.isPlatform ? (query.agencyId ?? null) : actor.tenantId;
    // Un admin que pide otra agencia no recibe ni siquiera un indicador de que
    // exista: el criterio es el mismo de no revelación de tenant-isolation.
    if (!actor.isPlatform && query.agencyId !== undefined && query.agencyId !== actor.tenantId) {
      return emptyReport(query);
    }

    const gte = new Date(`${query.from}T00:00:00-04:00`);
    const lt = new Date(`${addDays(query.to, 1)}T00:00:00-04:00`);
    const rows = agencyId
      ? await this.tenant.withTenant(agencyId, (tx) => this.group(tx, gte, lt, agencyId))
      : await this.tenant.withPlatform((tx) => this.group(tx, gte, lt, null));

    const breakdown: SalesReportRow[] = rows.map((row) => ({
      method: row.method,
      status: row.status,
      count: row._count._all,
      amountUsd: amountFromCents(centsOf(row._sum.amountUsd)),
      amountVes: amountFromCents(centsOf(row._sum.amountVes)),
    }));

    return {
      from: query.from,
      to: query.to,
      agencyId: query.agencyId ?? null,
      totals: {
        count: breakdown.reduce((total, row) => total + row.count, 0),
        amountUsd: amountFromCents(
          breakdown.reduce((total, row) => total + centsOf(row.amountUsd), 0n),
        ),
        amountVes: amountFromCents(
          breakdown.reduce((total, row) => total + centsOf(row.amountVes), 0n),
        ),
      },
      breakdown,
    };
  }

  private group(tx: Prisma.TransactionClient, gte: Date, lt: Date, tenantId: string | null) {
    return tx.payment.groupBy({
      by: ["method", "status"],
      where: {
        createdAt: { gte, lt },
        ...(tenantId ? { tenantId } : {}),
      },
      _count: { _all: true },
      _sum: { amountUsd: true, amountVes: true },
      orderBy: [{ method: "asc" }, { status: "asc" }],
    });
  }
}

function emptyReport(query: SalesReportQuery): SalesReport {
  return {
    from: query.from,
    to: query.to,
    agencyId: query.agencyId ?? null,
    totals: { count: 0, amountUsd: "0.00", amountVes: "0.00" },
    breakdown: [],
  };
}

/** Centavos exactos como `bigint`: nunca se pasa por `number`. */
function centsOf(value: DecimalValue | null): bigint {
  if (value === null) return 0n;
  const [whole = "0", fraction = "00"] = formatAmount(value).split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

function amountFromCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
