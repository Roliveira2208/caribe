import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@caribe/shared";
import { describe, expect, it } from "vitest";
import { CheckoutView, type CheckoutViewLabels } from "../src/components/checkout-view";
import {
  bookingApiUrl,
  buildBookingRequest,
  checkoutErrorKind,
  checkoutStayFromParams,
  initialTravelers,
  parseBookingCreated,
  type BookingCreatedView,
  type CheckoutTraveler,
} from "../src/lib/checkout-view";
import {
  buildPaymentBody,
  EMPTY_PAYMENT_FIELDS,
  formatHoldRemaining,
  parseReportedPayment,
  paymentApiUrl,
  paymentErrorKind,
  remainingHoldMs,
  type ReportedPaymentView,
} from "../src/lib/payment-view";
import type {
  CatalogAvailabilityView,
  CatalogProductDetailView,
} from "../src/lib/detail-view";

const normalize = (value: string): string =>
  value.replace(/[\u00a0\u202f]/g, " ").replace(/&amp;/g, "&");

const labels: CheckoutViewLabels = {
  loading: "Cargando el checkout…",
  backToDetail: "Volver al detalle",
  title: "Tu reserva",
  subtitle: "Revisa la estancia y completa los datos de los viajeros.",
  stayTitle: "Estancia",
  checkIn: "Entrada",
  checkOut: "Salida",
  guests: "Personas",
  summaryTitle: "Resumen",
  nightPrice: "Precio de la noche",
  availabilityEmpty: "No hay noches disponibles para esta estancia.",
  currencyTitle: "Moneda del resumen",
  currencyUsd: "USD",
  currencyVes: "VES",
  vesUnavailable: "El equivalente en bolívares no está disponible.",
  totalNote: "El total y la tasa los calcula el servidor al crear la reserva.",
  travelersTitle: "Viajeros",
  fullName: "Nombre completo",
  documentType: "Tipo de documento",
  documentNumber: "Número de documento",
  documentTypeDni: "Cédula",
  documentTypePassport: "Pasaporte",
  phone: "Teléfono",
  email: "Correo electrónico",
  addTraveler: "Añadir viajero",
  removeTraveler: "Quitar viajero",
  travelersRequired: "Añade al menos un viajero con nombre y documento.",
  reserve: "Reservar",
  reserving: "Creando reserva…",
  login: "Iniciar sesión",
  paymentTitle: "Completa el pago",
  paymentSubtitle: "Reporta el pago de tu reserva.",
  holdLabel: "Cupo retenido",
  holdPending: "Calculando…",
  holdExpired: "La retención venció.",
  holdNote: "Si vence el tiempo, la reserva pasa a EXPIRED.",
  methodTitle: "Método de pago (simulado)",
  methodMobile: "Pago Móvil",
  methodZelle: "Zelle",
  methodBinance: "Binance Pay",
  methodCard: "Tarjeta",
  amountTitle: "Monto a pagar",
  amountNote: "El total y la tasa se congelan al reportar el pago.",
  bank: "Banco",
  reference: "Referencia",
  senderName: "Nombre del emisor",
  senderEmail: "Correo del emisor",
  confirmationNumber: "Número de confirmación",
  orderId: "Número de orden",
  last4: "Últimos 4 dígitos",
  brand: "Marca",
  reportPayment: "Reportar pago",
  reporting: "Reportando pago…",
  paymentRequired: "Completa los datos del método elegido.",
  successTitle: "Reserva creada",
  successCode: "Código de reserva",
  successStatus: "Pago en revisión",
  paymentStatusLabel: "Estado del pago",
  statusInReview: "Pago en revisión",
  statusApproved: "Pago aprobado",
  successTotal: "Total de la reserva",
  successVes: "Monto en bolívares",
  successRate: "Tasa congelada",
  successExpires: "Retención hasta",
  successDescription: "Guarda tu código.",
};

const productId = "11111111-1111-4111-8111-111111111111";
const stay = { checkIn: "2026-12-01", checkOut: "2026-12-03", guests: 2 };

const product: CatalogProductDetailView = {
  id: productId,
  hotelKey: "22222222-2222-4222-8222-222222222222",
  roomType: "standard",
  type: "hotel",
  title: { es: "Posada del Puerto", en: "Harbor Inn" },
  description: { es: "Habitación con vista al malecón.", en: "Room with a seafront view." },
  destination: {
    id: "dest-1",
    name: { es: "Mérida", en: "Mérida" },
    country: "VE",
    code: "MRD",
  },
  attributes: { stars: 3, maxGuests: 2, amenities: ["wifi"], images: [] },
  basePriceUsd: "80.00",
  basePriceVes: "7200.00",
  cancellationPolicy: null,
};

const availability: CatalogAvailabilityView = {
  productId,
  from: stay.checkIn,
  to: stay.checkOut,
  nights: [
    { night: "2026-12-01", remaining: 2, priceUsd: "80.00", priceVes: "7200.00" },
    { night: "2026-12-02", remaining: 1, priceUsd: "90.00", priceVes: "8100.00" },
  ],
};

const booking: BookingCreatedView = {
  id: "33333333-3333-4333-8333-333333333333",
  code: "CRB-ABCDEFGH",
  status: "PENDING_PAYMENT",
  expiresAt: "2026-12-01T15:30:00.000Z",
  totalUsd: "340.00",
};

const traveler: CheckoutTraveler = {
  fullName: "  Ana Pérez  ",
  documentType: "DNI",
  documentNumber: "  V12345678 ",
};

function render(overrides: Partial<Parameters<typeof CheckoutView>[0]> = {}): string {
  return normalize(
    renderToStaticMarkup(
      createElement(CheckoutView, {
        locale: "es" as Locale,
        productId,
        stay,
        product,
        availability,
        currency: "USD",
        status: "ready",
        booking: null,
        payment: null,
        paymentError: null,
        travelers: [traveler],
        travelerError: null,
        errorMessage: null,
        showLogin: false,
        loginHref: "/es/login",
        busy: false,
        labels,
        ...overrides,
      }),
    ),
  );
}

describe("contrato del checkout", () => {
  it("lee la estancia de la URL y limita los viajeros", () => {
    expect(
      checkoutStayFromParams(
        new URLSearchParams({ checkIn: "2026-12-01", checkOut: "2026-12-03", guests: "2" }),
      ),
    ).toEqual(stay);
    expect(
      checkoutStayFromParams(
        new URLSearchParams({ checkIn: "2026-12-01", checkOut: "2026-12-03", guests: "99" }),
      )?.guests,
    ).toBe(9);
    expect(checkoutStayFromParams(new URLSearchParams({ checkIn: "2026-12-01" }))).toBeNull();
    expect(initialTravelers(2)).toHaveLength(2);
  });

  it("envía solo productId, fechas, cantidad y viajeros saneados", () => {
    const request = buildBookingRequest(productId, stay, [
      { ...traveler, phone: "  ", email: "" },
    ]);
    expect(request).toEqual({
      productId,
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      quantity: 1,
      travelers: [{ fullName: "Ana Pérez", documentType: "DNI", documentNumber: "V12345678" }],
    });
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "checkIn",
      "checkOut",
      "productId",
      "quantity",
      "travelers",
    ]);
    expect(JSON.stringify(request)).not.toContain("currency");
    expect(bookingApiUrl()).toBe("/api/v1/bookings");
  });

  it("rechaza el envío sin viajeros o con correo inválido", () => {
    expect(buildBookingRequest(productId, stay, [])).toBeNull();
    expect(buildBookingRequest(productId, stay, [{ ...traveler, fullName: "" }])).toBeNull();
    expect(
      buildBookingRequest(productId, stay, [{ ...traveler, email: "no-correo" }]),
    ).toBeNull();
  });

  it("valida la respuesta de reserva creada y clasifica los errores", () => {
    expect(parseBookingCreated(booking)).toEqual(booking);
    expect(parseBookingCreated({ ...booking, status: "CONFIRMED" })).toBeNull();
    expect(parseBookingCreated({ ...booking, totalUsd: 340 })).toBeNull();
    expect(checkoutErrorKind(401, { code: "UNAUTHENTICATED" })).toBe("unauthenticated");
    expect(checkoutErrorKind(409, { code: "AVAILABILITY_EXHAUSTED" })).toBe("availability");
    expect(checkoutErrorKind(422, { code: "VALIDATION_ERROR" })).toBe("validation");
    expect(checkoutErrorKind(500, {})).toBe("generic");
  });
});

describe("vista de checkout", () => {
  it("muestra estancia, resumen USD y viajeros sin enviar la moneda", () => {
    const html = render();
    expect(html).toContain('data-checkout-status="ready"');
    expect(html).toContain("Posada del Puerto");
    expect(html).toContain("Tu reserva");
    expect(html).toContain("USD 80,00");
    expect(html).toContain("USD 90,00");
    expect(html).toContain("El total y la tasa los calcula el servidor al crear la reserva.");
    expect(html).toContain(">Reservar</button>");
    expect(html).not.toContain('name="currency"');
    expect(html).not.toContain("·");
    expect(html).not.toContain("→");
  });

  it("usa importes VES del servidor cuando se elige esa presentación", () => {
    const html = render({ currency: "VES" });
    expect(html).toContain("Bs.S 7.200,00");
    expect(html).not.toContain("USD 80,00");
  });

  it("asocia el error de viajeros al bloque y no permite reservar sin datos", () => {
    const html = render({
      travelers: [{ ...traveler, fullName: "", documentNumber: "" }],
      travelerError: labels.travelersRequired,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="travelers-error"');
    expect(html).toContain('id="travelers-error"');
    expect(html).toContain("Añade al menos un viajero con nombre y documento.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("asocia el error al bloque cuando no queda ningún viajero", () => {
    const html = render({ travelers: [], travelerError: labels.travelersRequired });
    expect(html).toContain('data-checkout-status="ready"');
    expect(html).toContain('aria-describedby="travelers-error"');
    expect(html).toContain('id="travelers-error"');
    expect(html).toContain("Añade al menos un viajero con nombre y documento.");
  });

  it("muestra error con acceso al login cuando falte sesión", () => {
    const html = render({
      status: "error",
      product: null,
      availability: null,
      errorMessage: "Inicia sesión para reservar.",
      showLogin: true,
      loginHref: "/es/login?redirectTo=%2Fes%2Fcheckout%2Fproducto",
    });
    expect(html).toContain('data-checkout-status="error"');
    expect(html).toContain("Inicia sesión para reservar.");
    expect(html).toContain("/es/login?redirectTo=%2Fes%2Fcheckout%2Fproducto");
  });

  it("muestra el código y Pago en revisión sin navegar a otra ruta", () => {
    const html = render({ status: "success", booking });
    expect(html).toContain('data-checkout-status="success"');
    expect(html).toContain("CRB-ABCDEFGH");
    expect(html).toContain("Pago en revisión");
    expect(html).toContain("USD 340,00");
    expect(html).not.toContain("/pago");
    expect(html).not.toContain("/confirmacion");
  });
});

describe("contrato del pago", () => {
  it("envía solo el método y los datos del método elegido", () => {
    const fields = {
      bank: "Banco de Venezuela",
      phone: "04125551122",
      reference: "ABC12345",
      senderName: "Ana Pérez",
      senderEmail: "ana@example.com",
      confirmationNumber: "ZEL-7788",
      orderId: "ORD-9900",
      last4: "1234",
      brand: "Visa",
    };
    expect(buildPaymentBody("PAGO_MOVIL", fields)).toEqual({
      method: "PAGO_MOVIL",
      bank: "Banco de Venezuela",
      phone: "04125551122",
      reference: "ABC12345",
    });
    expect(buildPaymentBody("ZELLE", fields)).toEqual({
      method: "ZELLE",
      senderName: "Ana Pérez",
      senderEmail: "ana@example.com",
      confirmationNumber: "ZEL-7788",
    });
    expect(buildPaymentBody("BINANCE_PAY", fields)).toEqual({
      method: "BINANCE_PAY",
      orderId: "ORD-9900",
    });
    expect(buildPaymentBody("CARD", fields)).toEqual({
      method: "CARD",
      last4: "1234",
      brand: "Visa",
    });
    expect(paymentApiUrl(booking.id)).toBe(
      `/api/v1/bookings/${booking.id}/payments`,
    );
  });

  it("rechaza datos incompletos, extraños y números de tarjeta completos", () => {
    expect(buildPaymentBody("PAGO_MOVIL", { ...EMPTY_PAYMENT_FIELDS, phone: "123" })).toBeNull();
    expect(buildPaymentBody("ZELLE", EMPTY_PAYMENT_FIELDS)).toBeNull();
    expect(buildPaymentBody("CARD", { ...EMPTY_PAYMENT_FIELDS, last4: "12345678" })).toBeNull();
    const serialized = JSON.stringify(buildPaymentBody("CARD", { ...EMPTY_PAYMENT_FIELDS, last4: "1234", brand: "Visa" }));
    expect(serialized).not.toContain("cardNumber");
    expect(serialized).not.toContain("cvv");
  });

  it("acepta solo pagos con importes y tasa serializados como texto", () => {
    const payment: ReportedPaymentView = {
      id: "55555555-5555-4555-8555-555555555555",
      status: "IN_REVIEW",
      amountUsd: "340.00",
      amountVes: "15300.00",
      rate: "45.0000",
    };
    expect(parseReportedPayment(payment)).toEqual(payment);
    expect(parseReportedPayment({ ...payment, amountUsd: 340 })).toBeNull();
    expect(parseReportedPayment({ ...payment, rate: 45 })).toBeNull();
    expect(parseReportedPayment({ ...payment, status: "UNKNOWN" })).toBeNull();
  });

  it("clasifica los errores del alta de pago", () => {
    expect(paymentErrorKind(410, { code: "HOLD_EXPIRED" })).toBe("expired");
    expect(paymentErrorKind(409, { code: "DUPLICATE_PAYMENT_REFERENCE" })).toBe("duplicate");
    expect(paymentErrorKind(422, { code: "VALIDATION_ERROR" })).toBe("validation");
    expect(paymentErrorKind(403, {})).toBe("forbidden");
    expect(paymentErrorKind(500, {})).toBe("generic");
  });

  it("muestra la retención restante sin valores negativos", () => {
    const expiresAt = "2026-12-01T15:00:30.000Z";
    expect(remainingHoldMs(expiresAt, Date.parse("2026-12-01T15:00:00.000Z"))).toBe(30000);
    expect(remainingHoldMs(expiresAt, Date.parse("2026-12-01T15:01:00.000Z"))).toBe(0);
    expect(formatHoldRemaining(30000)).toBe("00:30");
    expect(formatHoldRemaining(90000)).toBe("01:30");
    expect(formatHoldRemaining(-1)).toBe("00:00");
  });
});

describe("vista del pago", () => {
  it("muestra la retención, los métodos y el total calculado por el servidor", () => {
    const html = render({ status: "payment", booking });
    expect(html).toContain('data-checkout-status="payment"');
    expect(html).toContain('role="timer"');
    expect(html).toContain("Cupo retenido");
    expect(html).toContain("Pago Móvil");
    expect(html).toContain("Zelle");
    expect(html).toContain("Binance Pay");
    expect(html).toContain("Tarjeta");
    expect(html).toContain("USD 340,00");
    expect(html).toContain("Reportar pago");
    expect(html).not.toContain("cardNumber");
    expect(html).not.toContain("cvv");
  });

  it("muestra el estado y los importes congelados tras reportar el pago", () => {
    const html = render({
      status: "success",
      booking,
      payment: {
        id: "55555555-5555-4555-8555-555555555555",
        status: "IN_REVIEW",
        amountUsd: "340.00",
        amountVes: "15300.00",
        rate: "45.0000",
      },
    });
    expect(html).toContain('data-checkout-status="success"');
    expect(html).toContain("Estado del pago");
    expect(html).toContain("Pago en revisión");
    expect(html).toContain("Bs.S 15.300,00");
    expect(html).toContain("45.0000");
  });
});
