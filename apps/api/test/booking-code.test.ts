import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_CODE_ALPHABET,
  generateBookingCode,
  isBookingCode,
  withCodeRetry,
} from "../src/bookings/booking-code.js";
import { hashBookingRequest, type CreateBookingBody } from "../src/bookings/bookings.schemas.js";

/**
 * Unitarios del codigo de reserva (T-F1-7, specs/booking "Codigo de reserva"
 * y "Colision de codigo") y del hash de idempotencia.
 */
describe("booking code", () => {
  it("genera CRB- seguido de 8 caracteres Crockford", () => {
    // pick fijo: cada posicion toma el primer caracter del alfabeto.
    const code = generateBookingCode(() => 0);
    expect(code).toBe("CRB-00000000");
    expect(isBookingCode(code)).toBe(true);
  });

  it("solo usa caracteres del alfabeto Crockford (sin I, L, O ni U)", () => {
    for (let index = 0; index < 100; index += 1) {
      const code = generateBookingCode();
      expect(code).toMatch(/^CRB-[0-9A-HJKMNP-TV-Z]{8}$/);
      for (const char of code.slice("CRB-".length)) {
        expect(BOOKING_CODE_ALPHABET).toContain(char);
      }
    }
    expect(BOOKING_CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("respeta el indice que devuelve el generador inyectado", () => {
    const picks = [31, 0, 31, 0, 31, 0, 31, 0];
    let cursor = 0;
    const code = generateBookingCode(() => picks[cursor++] ?? 0);
    expect(code).toBe("CRB-Z0Z0Z0Z0");
  });

  it("rechaza codigos con formato invalido", () => {
    expect(isBookingCode("CRB-1234567")).toBe(false);
    expect(isBookingCode("CRB-123456789")).toBe(false);
    expect(isBookingCode("CRB-1234567I")).toBe(false);
    expect(isBookingCode("crb-12345678")).toBe(false);
  });

  it("reintenta cuando el codigo ya existe y usa el siguiente", async () => {
    const generate = vi.fn().mockReturnValueOnce("CRB-AAAAAAAA").mockReturnValueOnce("CRB-BBBBBBBB");
    const attempt = vi.fn(async (code: string) => (code === "CRB-AAAAAAAA" ? null : code));

    await expect(withCodeRetry(generate, attempt)).resolves.toBe("CRB-BBBBBBBB");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenNthCalledWith(1, "CRB-AAAAAAAA");
    expect(attempt).toHaveBeenNthCalledWith(2, "CRB-BBBBBBBB");
  });

  it("se rinde tras el maximo de intentos", async () => {
    const generate = vi.fn(() => "CRB-AAAAAAAA");
    const attempt = vi.fn(async () => null);

    await expect(withCodeRetry(generate, attempt, 3)).rejects.toThrow(/3 intentos/);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("propaga un fallo distinto de la colision", async () => {
    const failure = new Error("fallo de cupo");
    const attempt = vi.fn(async () => {
      throw failure;
    });

    await expect(withCodeRetry(() => "CRB-AAAAAAAA", attempt)).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("hash de idempotencia", () => {
  const body: CreateBookingBody = {
    productId: "00000000-0000-4000-8000-000000000001",
    checkIn: "2027-01-10",
    checkOut: "2027-01-12",
    quantity: 1,
    travelers: [
      { fullName: "Ana Pérez", documentType: "V", documentNumber: "12345678" },
    ],
  };

  it("es estable para el mismo cuerpo", () => {
    expect(hashBookingRequest(body)).toBe(hashBookingRequest({ ...body }));
    expect(hashBookingRequest(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia si cambia un campo del cuerpo", () => {
    expect(hashBookingRequest({ ...body, quantity: 2 })).not.toBe(hashBookingRequest(body));
  });
});
