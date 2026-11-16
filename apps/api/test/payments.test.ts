import { describe, expect, it } from "vitest";
import { paymentBodySchema, paymentReference } from "@caribe/shared";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import {
  decodePaymentsCursor,
  encodePaymentsCursor,
  type PaymentsCursor,
} from "../src/payments/payments.cursor.js";
import {
  PAYMENTS_DEFAULT_LIMIT,
  PAYMENTS_MAX_LIMIT,
  hashPaymentRequest,
  listPaymentsQuerySchema,
  parseStoredPaymentResponse,
  rejectPaymentSchema,
} from "../src/payments/payments.schemas.js";

/**
 * Unitarios del contrato de pagos (T-F1-9): cursor del listado, esquemas de
 * query/rechazo y validación por método. Los escenarios de 422 de la spec
 * ("Datos por método de pago", "Rechazo sin motivo" y "Monto enviado por el
 * cliente") se prueban aquí sin base de datos; el resto vive en
 * payments.e2e.ts.
 */
describe("cursor del listado de pagos", () => {
  const cursor: PaymentsCursor = {
    order: "payments",
    createdAt: "2026-11-15T10:00:00.000Z",
    id: "pay-1",
  };

  it("codifica y decodifica sin pérdida", () => {
    const encoded = encodePaymentsCursor({
      createdAt: cursor.createdAt,
      id: cursor.id,
    });
    expect(encoded).not.toContain("{");
    expect(decodePaymentsCursor(encoded)).toEqual(cursor);
  });

  it("rechaza un cursor que no es base64url de JSON con 422", () => {
    expectValidationError(() => decodePaymentsCursor("%%%"));
    expectValidationError(() =>
      decodePaymentsCursor(Buffer.from("no es json", "utf8").toString("base64url")),
    );
  });

  it("rechaza un cursor con forma inesperada con 422", () => {
    const missingId = Buffer.from(
      JSON.stringify({ order: "payments", createdAt: cursor.createdAt }),
      "utf8",
    ).toString("base64url");
    expectValidationError(() => decodePaymentsCursor(missingId));
  });

  it("rechaza un cursor generado para otro listado con 422", () => {
    const other = Buffer.from(
      JSON.stringify({ order: "bookings", createdAt: cursor.createdAt, id: cursor.id }),
      "utf8",
    ).toString("base64url");
    expectValidationError(() => decodePaymentsCursor(other));
  });

  it("rechaza una fecha que no es ISO 8601 UTC con 422", () => {
    for (const createdAt of [
      "2026-11-15",
      "2026-11-15T10:00:00Z",
      "2026-11-15T10:00:00.000-04:00",
      "ayer",
    ]) {
      const encoded = encodePaymentsCursor({ createdAt, id: cursor.id });
      expectValidationError(() => decodePaymentsCursor(encoded));
    }
  });

  it("rechaza un identificador vacío con 422", () => {
    const encoded = encodePaymentsCursor({ createdAt: cursor.createdAt, id: "" });
    expectValidationError(() => decodePaymentsCursor(encoded));
  });
});

describe("query del listado de pagos", () => {
  it("acepta los filtros completos", () => {
    const parsed = listPaymentsQuerySchema.parse({
      status: "IN_REVIEW",
      method: "PAGO_MOVIL",
      bookingId: "9f1d7a4e-3c62-4f43-9d0e-2a4b6c8d0e1f",
      limit: String(PAYMENTS_MAX_LIMIT),
      cursor: "abc",
    });
    expect(parsed).toMatchObject({
      status: "IN_REVIEW",
      method: "PAGO_MOVIL",
      limit: PAYMENTS_MAX_LIMIT,
    });
  });

  it("no fija límite por defecto en el esquema (lo resuelve el servicio)", () => {
    expect(listPaymentsQuerySchema.parse({})).toEqual({});
    expect(PAYMENTS_DEFAULT_LIMIT).toBe(20);
  });

  it("rechaza un límite fuera de rango, estados o métodos desconocidos y claves extra", () => {
    expect(listPaymentsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(
      listPaymentsQuerySchema.safeParse({ limit: String(PAYMENTS_MAX_LIMIT + 1) }).success,
    ).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ status: "PAID" }).success).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ method: "PAYPAL" }).success).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ bookingId: "no-uuid" }).success).toBe(false);
    expect(listPaymentsQuerySchema.safeParse({ tenantId: "x" }).success).toBe(false);
  });
});

describe("rechazo de un pago", () => {
  it("exige un motivo no vacío y de hasta 500 caracteres", () => {
    expect(rejectPaymentSchema.parse({ reason: "  Comprobante ilegible  " })).toEqual({
      reason: "Comprobante ilegible",
    });
    expect(rejectPaymentSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(rejectPaymentSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(rejectPaymentSchema.safeParse({}).success).toBe(false);
    expect(rejectPaymentSchema.safeParse({ reason: "ok", status: "REJECTED" }).success).toBe(
      false,
    );
  });
});

describe("datos por método de pago", () => {
  it("acepta Pago Móvil con banco, teléfono venezolano y referencia", () => {
    const parsed = paymentBodySchema.parse({
      method: "PAGO_MOVIL",
      bank: "Banesco",
      phone: "+584141234567",
      reference: "1234",
    });
    expect(paymentReference(parsed)).toBe("1234");
  });

  it("rechaza Pago Móvil sin banco, teléfono o referencia", () => {
    expect(
      paymentBodySchema.safeParse({ method: "PAGO_MOVIL", phone: "+584141234567", reference: "1234" })
        .success,
    ).toBe(false);
    expect(
      paymentBodySchema.safeParse({ method: "PAGO_MOVIL", bank: "Banesco", reference: "1234" })
        .success,
    ).toBe(false);
    expect(
      paymentBodySchema.safeParse({ method: "PAGO_MOVIL", bank: "Banesco", phone: "+584141234567" })
        .success,
    ).toBe(false);
  });

  it("rechaza un teléfono que no cumple el formato venezolano", () => {
    for (const phone of ["0414123456", "1234567890", "+1 555 0100", "+58414-1234567"]) {
      expect(
        paymentBodySchema.safeParse({ method: "PAGO_MOVIL", bank: "Banesco", phone, reference: "1234" })
          .success,
      ).toBe(false);
    }
  });

  it("rechaza una referencia de Pago Móvil fuera de 4 a 20 alfanuméricos", () => {
    for (const reference of ["123", "1234-5", "1234 5", "x".repeat(21)]) {
      expect(
        paymentBodySchema.safeParse({
          method: "PAGO_MOVIL",
          bank: "Banesco",
          phone: "+584141234567",
          reference,
        }).success,
      ).toBe(false);
    }
  });

  it("Zelle exige confirmación y nombre o correo del emisor", () => {
    expect(
      paymentBodySchema.safeParse({ method: "ZELLE", confirmationNumber: "Z-1" }).success,
    ).toBe(false);
    expect(
      paymentBodySchema.safeParse({ method: "ZELLE", senderName: "Ana", confirmationNumber: "Z-1" })
        .success,
    ).toBe(true);
    expect(
      paymentBodySchema.safeParse({ method: "ZELLE", senderEmail: "ana@example.com", confirmationNumber: "Z-1" })
        .success,
    ).toBe(true);
    expect(paymentBodySchema.safeParse({ method: "ZELLE", senderName: "Ana" }).success).toBe(
      false,
    );
  });

  it("Binance Pay exige identificador de orden", () => {
    expect(paymentBodySchema.safeParse({ method: "BINANCE_PAY" }).success).toBe(false);
    const parsed = paymentBodySchema.parse({ method: "BINANCE_PAY", orderId: "B-9" });
    expect(paymentReference(parsed)).toBe("B-9");
  });

  it("tarjeta guarda solo últimos 4 dígitos y marca", () => {
    const parsed = paymentBodySchema.parse({ method: "CARD", last4: "4242", brand: "VISA" });
    expect(paymentReference(parsed)).toBeNull();
    expect(paymentBodySchema.safeParse({ method: "CARD", last4: "42", brand: "VISA" }).success).toBe(
      false,
    );
    expect(
      paymentBodySchema.safeParse({ method: "CARD", last4: "42424", brand: "VISA" }).success,
    ).toBe(false);
  });

  it("rechaza cardNumber, pan y cvv con 422", () => {
    for (const extra of [
      { cardNumber: "4242424242424242" },
      { pan: "4242424242424242" },
      { cvv: "123" },
    ]) {
      expect(
        paymentBodySchema.safeParse({ method: "CARD", last4: "4242", brand: "VISA", ...extra })
          .success,
      ).toBe(false);
    }
  });

  it("rechaza montos, tasas, tenant_id, user_id y claves desconocidas", () => {
    for (const extra of [
      { amount_usd: "1.00" },
      { amount_ves: "900.00" },
      { rate: "900.0000" },
      { tenant_id: "org" },
      { user_id: "user" },
      { status: "APPROVED" },
    ]) {
      expect(
        paymentBodySchema.safeParse({
          method: "BINANCE_PAY",
          orderId: "B-9",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});

describe("hash y respuesta guardada del alta de pago", () => {
  const body = {
    method: "PAGO_MOVIL" as const,
    bank: "Banesco",
    phone: "+584141234567",
    reference: "1234",
  };

  it("es estable para el mismo cuerpo y cambia con otro cuerpo u otra reserva", () => {
    const base = hashPaymentRequest("booking-1", body);
    expect(hashPaymentRequest("booking-1", body)).toBe(base);
    expect(hashPaymentRequest("booking-2", body)).not.toBe(base);
    expect(
      hashPaymentRequest("booking-1", { ...body, reference: "9999" }),
    ).not.toBe(base);
  });

  it("acepta solo una respuesta mínima con id y estado válido", () => {
    expect(parseStoredPaymentResponse({ id: "pay-1", status: "APPROVED" })).toEqual({
      id: "pay-1",
      status: "APPROVED",
    });
    for (const value of [
      null,
      [],
      "x",
      {},
      { id: "pay-1" },
      { id: "", status: "APPROVED" },
      { id: "pay-1", status: "PAID" },
      { id: "pay-1", status: "APPROVED", amountUsd: "100.00" },
    ]) {
      expect(parseStoredPaymentResponse(value)).toBeNull();
    }
  });
});

function expectValidationError(fn: () => unknown): void {
  const error = capture(fn);
  expect(error.code).toBe("VALIDATION_ERROR");
  expect(error.issues?.[0]?.path).toBe("cursor");
}

function capture(fn: () => unknown): ApiProblemException {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiProblemException) return error;
    throw error;
  }
  throw new Error("se esperaba ApiProblemException");
}
