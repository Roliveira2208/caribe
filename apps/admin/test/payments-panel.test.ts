import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de pagos (T-F2-11) sobre el código fuente: filtros y
 * cursor resueltos en el servidor, par congelado como texto, matriz de roles y
 * mensajes es/en.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function messages(locale: "es" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

function paymentsMessages(locale: "es" | "en"): Record<string, unknown> {
  const namespace = messages(locale)["payments"];
  return namespace && typeof namespace === "object"
    ? (namespace as Record<string, unknown>)
    : {};
}

const panel = read("src/components/payments-panel.tsx");
const page = read("src/app/[locale]/admin/payments/page.tsx");

const paymentKeys = [
  "title",
  "description",
  "statusLabel",
  "methodLabel",
  "all",
  "colPayment",
  "colBooking",
  "colCustomer",
  "colMethod",
  "colAmountUsd",
  "colAmountVes",
  "colRateId",
  "colValueDate",
  "colStatus",
  "colActions",
  "previousPage",
  "nextPage",
  "page",
  "loadingMore",
  "readOnly",
  "selfReview",
  "empty",
  "forbidden",
  "listForbidden",
  "genericError",
];

describe("panel de pagos (T-F2-11)", () => {
  it("pide cada página al servidor con el cursor y no pagina en el cliente", () => {
    expect(panel).toContain("listAdminPayments({ status, method, cursor");
    expect(panel).toContain("nextCursor");
    expect(panel).toContain("pagination={false}");
    expect(panel).toContain('t("previousPage")');
    expect(panel).toContain('t("nextPage")');
  });

  it("muestra el par congelado como texto, sin inputs ni recálculo", () => {
    expect(panel).toContain("row.exchangeRateId");
    expect(panel).toContain("row.valueDate");
    expect(panel).not.toContain('type="number"');
    expect(panel).not.toContain("Number(row.amountUsd)");
    expect(panel).not.toContain("Number(row.amountVes)");
  });

  it("deshabilita la revisión cuando el rol resuelto es de solo lectura", () => {
    expect(panel).toContain("access.canReview");
    expect(panel).toContain('t("readOnly")');
  });

  it("deshabilita la revisión del propio pago y muestra el mensaje es/en", () => {
    expect(panel).toContain("canReviewPayment(access, row.reportedBy, userId)");
    expect(panel).toContain('t("selfReview")');
  });

  it("recarga tras cualquier conflicto de revisión y lleva a activar el segundo factor", () => {
    expect(panel).toContain("isReviewConflict(cause)");
    expect(panel).toContain("setReload");
    expect(panel).toContain("isTwoFactorRequired(cause)");
    expect(panel).toContain("/two-factor");
  });

  it("resuelve la matriz y la identidad en el servidor antes de renderizar", () => {
    expect(page).toContain("resolvePaymentPanelAccess");
    expect(page).toContain("loadActiveMemberRole");
    expect(page).toContain("loadSessionUser");
    expect(page).toContain("userId={userId}");
    expect(page).toContain('t("listForbidden")');
  });

  it.each(paymentKeys)("tiene el texto es/en %s", (key) => {
    expect(paymentsMessages("es")[key]).toBeTruthy();
    expect(paymentsMessages("en")[key]).toBeTruthy();
  });
});
