import { describe, expect, it } from "vitest";
import { paymentsCsv } from "../src/payments/payments.csv.js";
import type { PaymentPage, PaymentResponse } from "../src/payments/payments.schemas.js";

/**
 * Serializador puro del CSV de pagos (T-F2-25). No arranca la app: comprueba
 * que el archivo solo contiene columnas permitidas, montos/tasa como cadenas
 * del servidor y celdas protegidas contra inyección de fórmulas.
 */
function paymentWith(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    method: "ZELLE",
    status: "IN_REVIEW",
    amountUsd: "100.00",
    amountVes: "90000.00",
    rate: "900.0000",
    exchangeRateId: "33333333-3333-4333-8333-333333333333",
    valueDate: "2026-11-26",
    reference: "referencia-del-cliente",
    reportedBy: "44444444-4444-4444-8444-444444444444",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    paidAt: null,
    createdAt: "2026-11-26T12:00:00.000Z",
    ...overrides,
  };
}

function pageWith(...items: PaymentResponse[]): PaymentPage {
  return { items, nextCursor: null };
}

describe("payments: CSV sin secretos ni fórmulas", () => {
  it("usa encabezados en español y montos y tasa como cadenas del servidor", () => {
    const csv = paymentsCsv(pageWith(paymentWith()), "es");
    const lines = csv.trim().split(/\r?\n/);

    expect(lines[0]).toBe(
      "ID,Reserva,Método,Estado,Monto USD,Monto VES,Tasa,ID de tasa,Fecha valor,Reportado por,Revisado por,Revisado el,Pagado el,Creado el",
    );
    expect(lines[1]).toBe(
      "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222,ZELLE,IN_REVIEW,100.00,90000.00,900.0000,33333333-3333-4333-8333-333333333333,2026-11-26,44444444-4444-4444-8444-444444444444,,,,2026-11-26T12:00:00.000Z",
    );
  });

  it("usa encabezados en inglés con lang=en", () => {
    const csv = paymentsCsv(pageWith(paymentWith()), "en");

    expect(csv.split(/\r?\n/)[0]).toBe(
      "ID,Booking,Method,Status,Amount USD,Amount VES,Rate,Rate ID,Value date,Reported by,Reviewed by,Reviewed at,Paid at,Created at",
    );
  });

  it("no incluye tenant, referencia libre, motivo ni datos de tarjeta", () => {
    const csv = paymentsCsv(
      pageWith(
        paymentWith({
          reference: "CVV-123 4111111111111111 token-secreto",
          rejectionReason: "mensaje interno del proveedor",
        }),
      ),
      "es",
    );

    expect(csv).not.toContain("tenantId");
    expect(csv).not.toContain("tenant_id");
    expect(csv).not.toContain("CVV");
    expect(csv).not.toContain("4111111111111111");
    expect(csv).not.toContain("token-secreto");
    expect(csv).not.toContain("mensaje interno");
    expect(csv).not.toContain("referencia-del-cliente");
  });

  it("prefija con apóstrofo las celdas que empiezan por =, +, - o @", () => {
    const csv = paymentsCsv(
      pageWith(
        paymentWith({
          id: "=SUM(1+1)",
          bookingId: "@cmd",
          reportedBy: "+1.00",
          reviewedBy: "-2.00",
        }),
      ),
      "es",
    );

    expect(csv.split(/\r?\n/)[1]).toContain("'=SUM(1+1),'@cmd,");
    expect(csv.split(/\r?\n/)[1]).toContain(",'+1.00,'-2.00,");
  });

  it("mantiene el escape de comillas al prefijar una fórmula", () => {
    const csv = paymentsCsv(
      pageWith(paymentWith({ reportedBy: '=HYPERLINK("http://x","ir")' })),
      "en",
    );

    expect(csv).toContain('"\'=HYPERLINK(""http://x"",""ir"")"');
  });

  it("no inventa filas cuando la página está vacía", () => {
    const csv = paymentsCsv(pageWith(), "es");

    expect(csv.split(/\r?\n/)).toHaveLength(2);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
