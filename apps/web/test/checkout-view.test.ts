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
  successTitle: "Reserva creada",
  successCode: "Código de reserva",
  successStatus: "Pago en revisión",
  successTotal: "Total de la reserva",
  successExpires: "Retención hasta",
  successDescription: "Guarda tu código. El pago se revisará sin otra acción de tu parte.",
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
