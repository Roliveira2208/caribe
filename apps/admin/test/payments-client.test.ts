import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@caribe/shared";
import {
  canReviewPayment,
  isReviewConflict,
  listAdminPayments,
  resolvePaymentPanelAccess,
  reviewAdminPayment,
  validRejectionReason,
} from "../src/lib/payments-client";

function fetchJson(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const page = {
  items: [
    {
      id: "pay-1",
      bookingId: "book-1",
      method: "PAGO_MOVIL",
      status: "IN_REVIEW",
      amountUsd: "240.00",
      amountVes: "8640.00",
      rate: "36.0000",
      exchangeRateId: "rate-1",
      valueDate: "2026-11-25",
      reference: "123456",
      reportedBy: "user-2",
      reviewedBy: null,
      rejectionReason: null,
      createdAt: "2026-11-22T10:00:00.000Z",
    },
  ],
  nextCursor: null,
};

describe("cliente de pagos del admin", () => {
  it("filtra por estado y método en la lista", async () => {
    const fetchImpl = fetchJson(page);
    await listAdminPayments({ status: "IN_REVIEW", method: "PAGO_MOVIL" }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/admin/payments?status=IN_REVIEW&method=PAGO_MOVIL", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("no envía filtros cuando están en todos", async () => {
    const fetchImpl = fetchJson(page);
    const result = await listAdminPayments({ status: "ALL", method: "ALL" }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/admin/payments", expect.any(Object));
    expect(result.items).toHaveLength(1);
  });

  it("pide la página siguiente con el cursor del servidor", async () => {
    const fetchImpl = fetchJson({ ...page, nextCursor: "cursor-2" });
    const result = await listAdminPayments(
      { status: "APPROVED", method: "ALL", cursor: "cursor-1" },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/admin/payments?status=APPROVED&cursor=cursor-1",
      expect.any(Object),
    );
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("conserva el par congelado como texto del servidor", async () => {
    const fetchImpl = fetchJson(page);
    const result = await listAdminPayments({ status: "ALL", method: "ALL" }, { fetchImpl });
    expect(result.items[0]).toMatchObject({
      amountUsd: "240.00",
      amountVes: "8640.00",
      rate: "36.0000",
      exchangeRateId: "rate-1",
      valueDate: "2026-11-25",
    });
  });

  it("descarta filas mal formadas de la respuesta", async () => {
    const fetchImpl = fetchJson({ items: [page.items[0], { id: "incompleta" }], nextCursor: "c" });
    const result = await listAdminPayments({ status: "ALL", method: "ALL" }, { fetchImpl });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("c");
  });

  it("aprueba sin cuerpo y rechaza con el motivo recortado", async () => {
    const fetchImpl = fetchJson({});
    await reviewAdminPayment("pay-1", "approve", "", { fetchImpl });
    await reviewAdminPayment("pay/1", "reject", "  Referencia no coincide  ", { fetchImpl });

    const calls = vi.mocked(fetchImpl).mock.calls;
    expect(calls[0]?.[0]).toBe("/api/v1/admin/payments/pay-1/approve");
    expect(calls[0]?.[1]?.method).toBe("PATCH");
    expect(calls[0]?.[1]?.body).toBeUndefined();
    expect(calls[1]?.[0]).toBe("/api/v1/admin/payments/pay%2F1/reject");
    expect(calls[1]?.[1]?.body).toBe(JSON.stringify({ reason: "Referencia no coincide" }));
  });

  it("exige motivo antes de llamar a la API", async () => {
    const fetchImpl = fetchJson({});
    await expect(reviewAdminPayment("pay-1", "reject", "   ", { fetchImpl })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(validRejectionReason("motivo")).toBe(true);
    expect(validRejectionReason("x".repeat(501))).toBe(false);
  });

  it("conserva el código de aplicación del error", async () => {
    const fetchImpl = fetchJson(
      { message: "Otro revisor llegó antes", code: "PAYMENT_ALREADY_REVIEWED" },
      409,
    );
    await expect(
      reviewAdminPayment("pay-1", "approve", "", { fetchImpl }),
    ).rejects.toBeInstanceOf(AuthApiError);
    await expect(
      reviewAdminPayment("pay-1", "approve", "", { fetchImpl }),
    ).rejects.toMatchObject({ status: 409, code: "PAYMENT_ALREADY_REVIEWED" });
  });
});

describe("matriz de pagos en el panel", () => {
  it("owner y admin leen y revisan", () => {
    for (const role of ["owner", "admin"]) {
      expect(resolvePaymentPanelAccess("ready", role)).toEqual({
        canRead: true,
        canReview: true,
        scope: "agency",
      });
    }
  });

  it("agent lee pero no revisa; provider y member no leen", () => {
    expect(resolvePaymentPanelAccess("ready", "agent")).toEqual({
      canRead: true,
      canReview: false,
      scope: "agency",
    });
    for (const role of ["provider", "member", "desconocido", null]) {
      expect(resolvePaymentPanelAccess("ready", role).canRead).toBe(false);
    }
  });

  it("el Super Admin lee en modo plataforma sin acciones de revisión", () => {
    expect(resolvePaymentPanelAccess("platform", null)).toEqual({
      canRead: true,
      canReview: false,
      scope: "platform",
    });
    expect(resolvePaymentPanelAccess("platform", "owner").canReview).toBe(false);
  });
});

describe("revisor distinto del pagador", () => {
  const reviewer = resolvePaymentPanelAccess("ready", "admin");

  it("permite revisar el pago de otro usuario", () => {
    expect(canReviewPayment(reviewer, "user-2", "user-1")).toBe(true);
  });

  it("deshabilita las acciones cuando el pago fue reportado por quien lo revisa", () => {
    expect(canReviewPayment(reviewer, "user-1", "user-1")).toBe(false);
  });

  it("falla cerrado sin identidad de sesión o con permiso de solo lectura", () => {
    expect(canReviewPayment(reviewer, "user-2", null)).toBe(false);
    expect(
      canReviewPayment(resolvePaymentPanelAccess("platform", null), "user-2", "user-1"),
    ).toBe(false);
    expect(canReviewPayment(resolvePaymentPanelAccess("ready", "agent"), "user-2", "user-1")).toBe(
      false,
    );
  });
});

describe("conflictos de revisión en la UI", () => {
  it("recarga tanto por revisión concurrente como por estado terminal ya observado", () => {
    for (const code of ["PAYMENT_ALREADY_REVIEWED", "INVALID_STATE_TRANSITION"]) {
      expect(isReviewConflict(new AuthApiError(409, "conflicto", code))).toBe(true);
    }
  });

  it("no trata otros errores como conflicto de revisión", () => {
    expect(isReviewConflict(new AuthApiError(409, "otro", "BOOKING_CANCELLED"))).toBe(false);
    expect(isReviewConflict(new AuthApiError(403, "forbidden", "FORBIDDEN"))).toBe(false);
    expect(isReviewConflict(new AuthApiError(422, "validación", "VALIDATION_ERROR"))).toBe(false);
    expect(isReviewConflict(new Error("red"))).toBe(false);
  });
});
