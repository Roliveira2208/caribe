import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  bookingCancelApiUrl,
  bookingDetailApiUrl,
  cancelErrorKind,
  canCancelBooking,
  formatValueDate,
  parseBookingDetail,
  parseCancelResult,
} from "../src/lib/booking-detail-view";
import type { BookingDocumentView } from "../src/lib/documents-view";
import {
  BookingDetailView,
  type BookingDetailLabels,
  type BookingDetailState,
} from "../src/components/booking-detail-view";

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, " ");

const detail = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "CRB-CARIBE01",
  status: "PENDING_PAYMENT",
  expiresAt: "2026-11-25T15:00:00.000Z",
  totalUsd: "245.80",
  paymentStatus: "APPROVED",
  refundEstimate: {
    amountUsd: "100.00",
    amountVes: "90000.00",
    rate: "900.0000",
    valueDate: "2026-11-15",
    percentage: 100,
  },
  items: [
    {
      productId: "22222222-2222-4222-8222-222222222222",
      hotelKey: "cayo-mar",
      roomType: "doble",
      title: { es: "Hotel Cayo Mar", en: "Cayo Mar Hotel" },
      checkIn: "2026-11-15",
      checkOut: "2026-11-17",
      quantity: 2,
      nightlyPrices: [{ night: "2026-11-15", priceUsd: "120.00" }],
      subtotalUsd: "245.80",
      policySnapshot: {
        policyId: null,
        name: "Flexible",
        rules: [{ hours_before: 72, percentage: 100 }],
      },
    },
  ],
};

const parsedDetail = parseBookingDetail(detail)!;

const documents: BookingDocumentView[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    type: "VOUCHER",
    number: 1,
    status: "READY",
    issuedAt: "2026-11-15T15:00:00.000Z",
    downloadPath: "/api/v1/documents/33333333-3333-4333-8333-333333333333/download",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    type: "RECEIPT",
    number: 1,
    status: "PENDING",
    issuedAt: null,
    downloadPath: null,
  },
];

const labels: BookingDetailLabels = {
  title: "Detalle de la reserva",
  loading: "Cargando el detalle…",
  error: "No pudimos cargar el detalle",
  retry: "Reintentar",
  itemsTitle: "Estancia",
  checkIn: "Entrada",
  checkOut: "Salida",
  room: "Habitación",
  guests: "Personas",
  subtotal: "Subtotal",
  nightPrice: "Precio de la noche",
  policyTitle: "Política guardada al reservar",
  policyRule: "{percentage}% hasta {hours} h antes del check-in",
  policyNone: "Sin política registrada",
  totalLabel: "Total",
  totalUsd: "{amount} USD",
  refundEstimateTitle: "Reembolso estimado (calculado en el servidor)",
  refundEstimatePercentage: "Aplica {percentage} %",
  refundEstimateNote: "Estimación calculada en el servidor; no es un reembolso emitido.",
  terminal: "Esta reserva ya no se puede cancelar.",
  cancel: "Cancelar reserva",
  cancelTitle: "Confirmar cancelación",
  cancelDescription: "No se puede deshacer",
  cancelKeep: "Mantener reserva",
  cancelConfirm: "Confirmar cancelación",
  cancelling: "Cancelando…",
  cancelErrorGeneric: "Error genérico",
  cancelErrorPaymentInReview: "El pago está en revisión",
  cancelErrorNotFound: "No encontrada",
  cancelErrorInvalidState: "Acción no válida",
  cancelSuccess: "Reserva cancelada",
  refundTitle: "Reembolso",
  refundUsd: "{amount} USD",
  refundVes: "{amount} Bs",
  refundRate: "Tasa congelada",
  refundValueDate: "Fecha valor",
  refundStatus: "Estado del reembolso",
  refundStatusPending: "Pendiente",
  refundStatusInReview: "En revisión",
  refundStatusApproved: "Aprobado",
  refundStatusRejected: "Rechazado",
  refundNone: "Sin reembolso",
  documentsTitle: "Tus documentos",
  documentsIntro: "Los documentos se publican al confirmar el pago.",
  documentsRefresh: "Actualizar documentos",
  documentsRefreshing: "Actualizando documentos…",
  documentsLoadError: "No pudimos cargar tus documentos",
  documentsEmpty: "Todavía no hay documentos disponibles.",
  documentNotFiscal: "Documento no fiscal",
  documentNumberLabel: "Número",
  documentDownload: "Descargar PDF",
  documentTypeVoucher: "Voucher de reserva",
  documentTypeReceipt: "Comprobante de pago",
  documentTypeRefundNote: "Nota de reembolso",
  documentStatusPending: "En preparación",
  documentStatusReady: "Disponible",
  documentStatusFailed: "No disponible",
};

function render(state: BookingDetailState): string {
  return normalize(
    renderToStaticMarkup(
      createElement(BookingDetailView, {
        locale: "es" as const,
        labels,
        statusLabel: (status: string) => status,
        state,
        onRetry: () => undefined,
        onRefreshDocuments: () => undefined,
        onCancel: () => undefined,
        onKeep: () => undefined,
        onConfirmCancel: () => undefined,
      }),
    ),
  );
}

function ready(overrides: Partial<Extract<BookingDetailState, { kind: "ready" }>> = {}) {
  return {
    kind: "ready" as const,
    detail: parsedDetail,
    documents,
    documentsError: false,
    documentsRefreshing: false,
    confirming: false,
    cancelling: false,
    cancelError: null,
    result: null,
    ...overrides,
  };
}

describe("detalle y cancelación de una reserva", () => {
  it("lee el detalle sin convertir importes a float", () => {
    expect(parsedDetail.totalUsd).toBe("245.80");
    expect(parsedDetail.items[0]?.nightlyPrices[0]?.priceUsd).toBe("120.00");
    expect(parsedDetail.paymentStatus).toBe("APPROVED");
    expect(parsedDetail.refundEstimate?.amountVes).toBe("90000.00");
    expect(parseBookingDetail({ ...detail, totalUsd: 245.8 })).toBeNull();
    expect(parseBookingDetail({ ...detail, status: "UNKNOWN" })).toBeNull();
    expect(parseBookingDetail({ ...detail, paymentStatus: 0.5 })).toBeNull();
    expect(parseBookingDetail({ ...detail, items: [] })).toBeNull();
    expect(parseBookingDetail({ ...detail, items: [{ ...detail.items[0], subtotalUsd: 245.8 }] })).toBeNull();
    expect(
      parseBookingDetail({
        ...detail,
        items: [{ ...detail.items[0], policySnapshot: undefined }],
      }),
    ).toBeNull();
  });

  it("lee el reembolso devuelto por la cancelación", () => {
    const result = parseCancelResult({
      id: parsedDetail.id,
      code: parsedDetail.code,
      status: "CANCELLED",
      refund: {
        id: "55555555-5555-4555-8555-555555555555",
        amountUsd: "122.90",
        amountVes: "110610.00",
        rate: "900.0000",
        valueDate: "2026-11-15",
        paymentStatus: "APPROVED",
      },
    });
    expect(result?.refund?.amountVes).toBe("110610.00");
    expect(parseCancelResult({ id: parsedDetail.id, code: "X", status: "CANCELLED", refund: undefined })).toBeNull();
  });

  it("clasifica errores y calcula rutas de la API", () => {
    expect(bookingDetailApiUrl(parsedDetail.id)).toBe(`/api/v1/bookings/${parsedDetail.id}`);
    expect(bookingCancelApiUrl(parsedDetail.id)).toBe(`/api/v1/bookings/${parsedDetail.id}/cancel`);
    expect(cancelErrorKind(409, { code: "PAYMENT_IN_REVIEW" })).toBe("paymentInReview");
    expect(cancelErrorKind(404, {})).toBe("notFound");
    expect(cancelErrorKind(500, {})).toBe("generic");
    expect(canCancelBooking("CONFIRMED")).toBe(true);
    expect(canCancelBooking("CANCELLED")).toBe(false);
    expect(formatValueDate("2026-11-15", "es")).toContain("2026");
  });

  it("muestra el detalle congelado y solo descargas de documentos listos", () => {
    const html = render(ready());
    expect(html).toContain("Hotel Cayo Mar");
    expect(html).toContain("245.80 USD");
    expect(html).toContain("Política guardada al reservar");
    expect(html).toContain("100% hasta 72 h antes del check-in");
    expect(html).toContain("Reembolso estimado (calculado en el servidor)");
    expect(html).toContain("90000.00 Bs");
    expect(html).toContain("Documento no fiscal");
    expect(html.match(/Descargar PDF/g)).toHaveLength(1);
    expect(html).toContain("/api/v1/documents/33333333-3333-4333-8333-333333333333/download");
    expect(html).toContain("Cancelar reserva");
    expect(html).not.toContain('role="alertdialog"');
  });

  it("pide confirmación antes de cancelar y anuncia el bloqueo por pago en revisión", () => {
    const confirming = render(ready({ confirming: true }));
    expect(confirming).toContain('role="alertdialog"');
    expect(confirming).toContain("Mantener reserva");
    expect(confirming).toContain("Confirmar cancelación");

    const blocked = render(ready({ cancelError: "paymentInReview" }));
    expect(blocked).toContain('role="alert"');
    expect(blocked).toContain("El pago está en revisión");
    expect(blocked).not.toContain('role="alertdialog"');
  });

  it("muestra el reembolso de la respuesta sin recalcularlo y sin botón de cancelar", () => {
    const result = parseCancelResult({
      id: parsedDetail.id,
      code: parsedDetail.code,
      status: "CANCELLED",
      refund: {
        id: "refund-1",
        amountUsd: "122.90",
        amountVes: "110610.00",
        rate: "900.0000",
        valueDate: "2026-11-15",
        paymentStatus: "APPROVED",
      },
    })!;
    const html = render(ready({ result, detail: { ...parsedDetail, status: "CANCELLED" } }));
    expect(html).toContain("Reserva cancelada");
    expect(html).toContain("110610.00 Bs");
    expect(html).toContain("900.0000");
    expect(html).not.toContain("Cancelar reserva");
  });

  it("no inventa documentos ni acciones en estados de error", () => {
    const html = render({ kind: "error" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("Descargar PDF");
    expect(html).not.toContain("Cancelar reserva");
  });
});
