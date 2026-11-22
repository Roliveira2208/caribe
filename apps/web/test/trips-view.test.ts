import { describe, expect, it } from "vitest";
import {
  formatTripDate,
  parseTripsPage,
  tripsApiUrl,
  tripsErrorKind,
} from "../src/lib/trips-view";

const booking = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "CRB-CARIBE01",
  status: "PENDING_PAYMENT",
  expiresAt: "2026-11-25T15:00:00.000Z",
  totalUsd: "245.80",
  createdAt: "2026-11-21T15:00:00.000Z",
};

describe("vista de Mis viajes", () => {
  it("lee el listado de reservas sin convertir el importe a float", () => {
    expect(parseTripsPage({ items: [booking], nextCursor: null })).toEqual({
      items: [booking],
      nextCursor: null,
    });
    expect(parseTripsPage({ items: [], nextCursor: "cursor-2" })?.nextCursor).toBe("cursor-2");
  });

  it("rechaza respuestas mal formadas o estados desconocidos", () => {
    expect(parseTripsPage(null)).toBeNull();
    expect(parseTripsPage({ items: "no" })).toBeNull();
    expect(parseTripsPage({ items: [], nextCursor: 42 })).toBeNull();
    expect(parseTripsPage({ items: [{ ...booking, status: "UNKNOWN" }] })).toBeNull();
    expect(parseTripsPage({ items: [{ ...booking, totalUsd: 245.8 }] })).toBeNull();
    expect(parseTripsPage({ items: [{ ...booking, expiresAt: "no" }] })).toBeNull();
    expect(parseTripsPage({ items: [{ ...booking, id: "" }] })).toBeNull();
  });

  it("usa la ruta de primera parte y distingue el 401 del resto de errores", () => {
    expect(tripsApiUrl()).toBe("/api/v1/bookings");
    expect(tripsApiUrl("CONFIRMED")).toBe("/api/v1/bookings?status=CONFIRMED");
    expect(tripsErrorKind(401)).toBe("unauthenticated");
    expect(tripsErrorKind(500)).toBe("generic");
  });

  it("formatea la fecha de caducidad en ambos idiomas", () => {
    for (const locale of ["es", "en"] as const) {
      const formatted = formatTripDate(booking.expiresAt, locale);
      expect(formatted).toContain("2026");
      expect(formatted.length).toBeGreaterThan(0);
    }
  });
});
