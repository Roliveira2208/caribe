import { describe, expect, it } from "vitest";
import { reportCsv } from "../src/reports/reports.csv.js";
import type { SalesReport } from "../src/reports/reports.schemas.js";

/**
 * Seguridad del CSV del reporte (T-F2-23, delta reports "Exportación CSV").
 * Una celda que empiece por =, +, - o @ debe abrirse como texto en Excel/Sheets;
 * si no, una cadena controlada por el proveedor del dato se ejecutaría como
 * fórmula al abrir el archivo.
 */
function reportWith(
  method: string,
  status: string,
  amountUsd = "1.00",
  amountVes = "2.00",
): SalesReport {
  return {
    from: "2026-11-01",
    to: "2026-11-30",
    agencyId: null,
    totals: { count: 1, amountUsd, amountVes },
    breakdown: [{ method, status, count: 1, amountUsd, amountVes }],
  };
}

describe("reportes: CSV sin inyección de fórmulas", () => {
  it("prefija con apóstrofo las celdas que empiezan por =, +, - o @", () => {
    const lines = reportCsv(reportWith("=SUM(1+1)", "@cmd", "+1.00", "-2.00"), "es")
      .trim()
      .split(/\r?\n/);

    expect(lines[1]).toBe("'=SUM(1+1),'@cmd,1,'+1.00,'-2.00");
    expect(lines[2]).toBe("TOTAL,,1,'+1.00,'-2.00");
  });

  it("prefija también las fórmulas precedidas por espacios o BOM", () => {
    const csv = reportCsv(
      reportWith("  =SUM(1+1)", "\uFEFF@cmd", "\t+1.00", " \uFEFF-2.00"),
      "es",
    );

    expect(csv.trim().split(/\r?\n/)[1]).toBe(
      "'  =SUM(1+1),'\uFEFF@cmd,1,'\t+1.00,' \uFEFF-2.00",
    );
  });

  it("no añade prefijo a un valor ordinario con espacios iniciales", () => {
    const csv = reportCsv(reportWith("  ZELLE", "APPROVED"), "es");

    expect(csv.trim().split(/\r?\n/)[1]).toBe("  ZELLE,APPROVED,1,1.00,2.00");
  });

  it("mantiene el escape de comillas al prefijar una fórmula", () => {
    const csv = reportCsv(reportWith('=HYPERLINK("http://x","ir")', "APPROVED"), "en");

    expect(csv).toContain('"\'=HYPERLINK(""http://x"",""ir"")",APPROVED,1,1.00,2.00');
  });

  it("no altera los valores ordinarios", () => {
    const csv = reportCsv(reportWith("ZELLE", "APPROVED", "100.00", "90000.00"), "es");

    expect(csv).toContain("ZELLE,APPROVED,1,100.00,90000.00");
    expect(csv).toContain("TOTAL,,1,100.00,90000.00");
  });
});
