import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../errors/zod-validation.pipe.js";
import { ActiveMembershipGuard } from "../tenant/active-membership.guard.js";
import { reportCsv } from "./reports.csv.js";
import { reportActorOf, ReportsGuard, type ReportsRequest } from "./reports.guard.js";
import { reportLocale } from "./reports.messages.js";
import { ReportsService } from "./reports.service.js";
import {
  salesReportQuerySchema,
  type SalesReport,
  type SalesReportQuery,
} from "./reports.schemas.js";

/** Lo mínimo de la respuesta Express que usa este handler. */
interface SalesResponse {
  type(value: string): SalesResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}

/**
 * Reporte de ventas del panel (T-F2-23). Una sola ruta de lectura bajo /admin:
 * el guard global exige sesión y TOTP, `ActiveMembershipGuard` valida la
 * membresía activa y `ReportsGuard` limita el alcance por rol. `format=csv`
 * entrega el MISMO reporte ya filtrado, sin nueva ruta ni lógica de filtros.
 */
@Controller("admin/reports")
@UseGuards(ActiveMembershipGuard, ReportsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("sales")
  async sales(
    @Req() request: ReportsRequest,
    @Query(new ZodValidationPipe(salesReportQuerySchema)) query: SalesReportQuery,
    @Res() response: SalesResponse,
  ): Promise<void> {
    const report: SalesReport = await this.reportsService.sales(reportActorOf(request), query);
    if (query.format === "csv") {
      response.type("text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", 'attachment; filename="sales-report.csv"');
      response.send(reportCsv(report, reportLocale(query.lang)));
      return;
    }
    response.json(report);
  }
}
