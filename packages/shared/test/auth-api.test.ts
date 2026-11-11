import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  TWO_FACTOR_REQUIRED,
  isTwoFactorRequired,
  parseOtpauthUri,
  safeLocalizedRedirectPath,
  secretFromOtpauthUri,
  twoFactorScreenMode,
  twoFactorSignInPending,
} from "../src/auth-api";

describe("twoFactorSignInPending", () => {
  it("detecta el sign-in pendiente de segundo factor", () => {
    expect(twoFactorSignInPending({ twoFactorRedirect: true, twoFactorMethods: ["totp"] })).toBe(
      true,
    );
  });

  it("acepta la respuesta sin twoFactorMethods", () => {
    expect(twoFactorSignInPending({ twoFactorRedirect: true })).toBe(true);
  });

  it("no marca un login normal como pendiente", () => {
    expect(twoFactorSignInPending({ user: { id: "u1", email: "a@b.c" } })).toBe(false);
  });

  it("exige twoFactorRedirect true", () => {
    expect(twoFactorSignInPending({ twoFactorRedirect: false })).toBe(false);
    expect(twoFactorSignInPending({})).toBe(false);
  });

  it("tolera cuerpos no objeto", () => {
    expect(twoFactorSignInPending(null)).toBe(false);
    expect(twoFactorSignInPending(undefined)).toBe(false);
    expect(twoFactorSignInPending("nope")).toBe(false);
    expect(twoFactorSignInPending(42)).toBe(false);
  });
});

describe("AuthApiError", () => {
  it("expone status, code y message", () => {
    const error = new AuthApiError(403, "Activa el segundo factor", TWO_FACTOR_REQUIRED);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
    expect(error.code).toBe(TWO_FACTOR_REQUIRED);
    expect(error.message).toBe("Activa el segundo factor");
    expect(error.name).toBe("AuthApiError");
  });
});

describe("isTwoFactorRequired", () => {
  it("reconoce el 403 con codigo TWO_FACTOR_REQUIRED", () => {
    expect(isTwoFactorRequired(new AuthApiError(403, "msg", TWO_FACTOR_REQUIRED))).toBe(true);
  });

  it("reconoce el cuerpo del 403 de Nest con status o statusCode", () => {
    expect(isTwoFactorRequired({ status: 403, code: TWO_FACTOR_REQUIRED })).toBe(true);
    expect(isTwoFactorRequired({ statusCode: 403, code: TWO_FACTOR_REQUIRED })).toBe(true);
  });

  it("ignora otros codigos y otros estados", () => {
    expect(isTwoFactorRequired(new AuthApiError(403, "sin permiso", "FORBIDDEN"))).toBe(false);
    expect(isTwoFactorRequired(new AuthApiError(401, "sin sesion", TWO_FACTOR_REQUIRED))).toBe(
      false,
    );
    expect(isTwoFactorRequired({ status: 403, message: "sin permiso" })).toBe(false);
  });

  it("tolera cualquier entrada", () => {
    expect(isTwoFactorRequired(null)).toBe(false);
    expect(isTwoFactorRequired(undefined)).toBe(false);
    expect(isTwoFactorRequired("TWO_FACTOR_REQUIRED")).toBe(false);
    expect(isTwoFactorRequired(new Error("x"))).toBe(false);
  });
});

describe("parseOtpauthUri", () => {
  it("extrae secreto, emisor y cuenta del URI estandar", () => {
    expect(
      parseOtpauthUri(
        "otpauth://totp/Caribe:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Caribe",
      ),
    ).toEqual({ secret: "JBSWY3DPEHPK3PXP", issuer: "Caribe", account: "alice@example.com" });
  });

  it("usa el emisor del label cuando la query no lo trae", () => {
    expect(parseOtpauthUri("otpauth://totp/Caribe:bob@example.com?secret=ABC123")).toEqual({
      secret: "ABC123",
      issuer: "Caribe",
      account: "bob@example.com",
    });
  });

  it("tolera labels sin emisor", () => {
    expect(parseOtpauthUri("otpauth://totp/bob@example.com?secret=ABC123&issuer=Caribe")).toEqual({
      secret: "ABC123",
      issuer: "Caribe",
      account: "bob@example.com",
    });
  });

  it("devuelve null si falta el secreto o el scheme no es otpauth", () => {
    expect(parseOtpauthUri("otpauth://totp/Caribe:x?issuer=Caribe")).toBeNull();
    expect(parseOtpauthUri("https://caribe.example.com")).toBeNull();
    expect(parseOtpauthUri("")).toBeNull();
  });
});

describe("secretFromOtpauthUri", () => {
  it("devuelve solo el secreto", () => {
    expect(secretFromOtpauthUri("otpauth://totp/Caribe:x?secret=JBSWY3DPEHPK3PXP")).toBe(
      "JBSWY3DPEHPK3PXP",
    );
  });

  it("devuelve null para entradas invalidas", () => {
    expect(secretFromOtpauthUri("no-uri")).toBeNull();
    expect(secretFromOtpauthUri("")).toBeNull();
  });
});

describe("safeLocalizedRedirectPath", () => {
  it("acepta rutas internas del idioma dado", () => {
    expect(safeLocalizedRedirectPath("/es/bookings", "es")).toBe("/es/bookings");
    expect(safeLocalizedRedirectPath("/en/login", "en")).toBe("/en/login");
  });

  it("acepta la raiz del idioma y normaliza la barra final", () => {
    expect(safeLocalizedRedirectPath("/es", "es")).toBe("/es");
    expect(safeLocalizedRedirectPath("/es/", "es")).toBe("/es");
  });

  it("rechaza rutas de otro idioma o sin prefijo", () => {
    expect(safeLocalizedRedirectPath("/en/bookings", "es")).toBeNull();
    expect(safeLocalizedRedirectPath("es/bookings", "es")).toBeNull();
    expect(safeLocalizedRedirectPath("/", "es")).toBeNull();
  });

  it("rechaza URLs absolutas, protocolo-relativas y traversal", () => {
    expect(safeLocalizedRedirectPath("https://evil.example.com", "es")).toBeNull();
    expect(safeLocalizedRedirectPath("//evil.example.com", "es")).toBeNull();
    expect(safeLocalizedRedirectPath("/es/../en", "es")).toBeNull();
    expect(safeLocalizedRedirectPath("/es/x\\y", "es")).toBeNull();
  });

  it("tolera entradas no cadena", () => {
    expect(safeLocalizedRedirectPath(null, "es")).toBeNull();
    expect(safeLocalizedRedirectPath(undefined, "es")).toBeNull();
    expect(safeLocalizedRedirectPath("", "es")).toBeNull();
    expect(safeLocalizedRedirectPath(42, "es")).toBeNull();
  });
});

describe("twoFactorScreenMode", () => {
  it("sin sesion: modo verificacion (login pendiente del segundo factor)", () => {
    expect(twoFactorScreenMode(null)).toBe("verify");
    expect(twoFactorScreenMode({ user: null })).toBe("verify");
  });

  it("sesion sin TOTP: modo activacion", () => {
    expect(twoFactorScreenMode({ user: { id: "u1", twoFactorEnabled: false } })).toBe("activate");
    expect(twoFactorScreenMode({ user: { id: "u1" } })).toBe("activate");
  });

  it("sesion con TOTP activo: nada que hacer", () => {
    expect(twoFactorScreenMode({ user: { id: "u1", twoFactorEnabled: true } })).toBe("done");
  });
});
