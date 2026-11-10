import { describe, expect, it } from "vitest";
import { REDACTED, sanitizeAuditPayload } from "../src/audit/audit-sanitize.js";

/**
 * Unitario del sanitizador de payloads de auditoria (T-F0-9): nada de
 * contrasenas, tokens, secretos TOTP ni datos de tarjeta puede llegar a las
 * columnas before/after de audit_logs. La spec audit exige el rastro del
 * estado antes/despues, no de los datos sensibles que lo acompanan.
 */
describe("sanitizeAuditPayload", () => {
  it("redacta claves sensibles en el nivel superior", () => {
    expect(
      sanitizeAuditPayload({
        password: "Password123!",
        token: "abc123",
        totpSecret: "JBSWY3DPEHPK3PXP",
        cardNumber: "4111111111111111",
        cvv: "123",
      }),
    ).toEqual({
      password: REDACTED,
      token: REDACTED,
      totpSecret: REDACTED,
      cardNumber: REDACTED,
      cvv: REDACTED,
    });
  });

  it("redacta dentro de objetos anidados y arreglos", () => {
    const payload = {
      status: "approved",
      payment: {
        method: "pago-movil",
        card: { number: "4111111111111111", cvv: "123" },
        cardNumber: "4111111111111111",
      },
      attempts: [{ password: "x" }, { ok: true }],
    };
    expect(sanitizeAuditPayload(payload)).toEqual({
      status: "approved",
      payment: {
        method: "pago-movil",
        // "card" es clave sensible: el valor completo se redacta, no se
        // recorre hacia adentro.
        card: REDACTED,
        cardNumber: REDACTED,
      },
      attempts: [{ password: REDACTED }, { ok: true }],
    });
  });

  it("normaliza la clave: mayusculas, guiones y guiones bajos", () => {
    expect(
      sanitizeAuditPayload({
        PASSword: "x",
        card_number: "4111111111111111",
        "totp-secret": "JBSWY3DPEHPK3PXP",
        CardNumber: "4111111111111111",
        client_id: "no sensible",
      }),
    ).toEqual({
      PASSword: REDACTED,
      card_number: REDACTED,
      "totp-secret": REDACTED,
      CardNumber: REDACTED,
      client_id: "no sensible",
    });
  });

  it("deja pasar los datos no sensibles sin tocarlos", () => {
    const payload = {
      amountUsd: "125.00",
      vesAmount: "4520.50",
      exchangeRateId: "rate-1",
      status: { before: "pending", after: "approved" },
      tags: ["pago-movil", "demo"],
    };
    expect(sanitizeAuditPayload(payload)).toEqual(payload);
  });

  it("pasa primitivos, null y undefined tal cual", () => {
    expect(sanitizeAuditPayload("texto")).toBe("texto");
    expect(sanitizeAuditPayload(42)).toBe(42);
    expect(sanitizeAuditPayload(true)).toBe(true);
    expect(sanitizeAuditPayload(null)).toBe(null);
    expect(sanitizeAuditPayload(undefined)).toBe(undefined);
  });

  it("no se cuelga con referencias circulares", () => {
    const payload: Record<string, unknown> = { name: "pago" };
    payload.self = payload;
    const result = sanitizeAuditPayload(payload) as Record<string, unknown>;
    expect(result.name).toBe("pago");
    expect(result.self).toBe(REDACTED);
  });

  it("cubre un arreglo en el nivel superior", () => {
    expect(sanitizeAuditPayload([{ secret: "s" }, "valor"])).toEqual([
      { secret: REDACTED },
      "valor",
    ]);
  });
});
