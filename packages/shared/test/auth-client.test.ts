import { describe, expect, it, vi } from "vitest";
import {
  type AuthRequestInit,
  type AuthResponse,
  enableTwoFactor,
  fetchJson,
  generateBackupCodes,
  getSession,
  signInEmail,
  signOut,
  verifyTotp,
} from "../src/auth-client";
import { AuthApiError, TWO_FACTOR_REQUIRED, isTwoFactorRequired } from "../src/auth-api";

function jsonResponse(body: unknown, status = 200): AuthResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  };
}

function fetchMockReturning(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: AuthRequestInit) => jsonResponse(body, status));
}

describe("signInEmail", () => {
  it("hace POST a /api/auth/sign-in/email con email y password", async () => {
    const fetchMock = fetchMockReturning({ user: { id: "u1", email: "a@b.c" } });
    const result = await signInEmail("a@b.c", "secretito", { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/sign-in/email");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body!)).toEqual({ email: "a@b.c", password: "secretito" });
    expect(result.user?.email).toBe("a@b.c");
  });

  it("devuelve el cuerpo tal cual cuando el login queda pendiente de 2FA", async () => {
    const fetchMock = fetchMockReturning({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    const result = await signInEmail("a@b.c", "x", { fetch: fetchMock });
    expect(result.twoFactorRedirect).toBe(true);
  });

  it("traduce el 401 de credenciales invalidas a AuthApiError", async () => {
    const fetchMock = fetchMockReturning(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      401,
    );
    const error = await signInEmail("a@b.c", "mal", { fetch: fetchMock }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
  });
});

describe("getSession", () => {
  it("hace GET a /api/auth/get-session sin cache", async () => {
    const fetchMock = fetchMockReturning({ user: { id: "u1" }, session: { id: "s1" } });
    const result = await getSession({ fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/get-session");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(result?.user?.id).toBe("u1");
  });

  it("devuelve null cuando la API responde null", async () => {
    const fetchMock = fetchMockReturning(null);
    expect(await getSession({ fetch: fetchMock })).toBeNull();
  });

  it("devuelve null cuando el cuerpo viene sin usuario", async () => {
    const fetchMock = fetchMockReturning({ user: null, session: null });
    expect(await getSession({ fetch: fetchMock })).toBeNull();
  });
});

describe("enableTwoFactor", () => {
  it("hace POST a /api/auth/two-factor/enable con la contrasena", async () => {
    const fetchMock = fetchMockReturning({
      method: "totp",
      totpURI: "otpauth://totp/Caribe:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Caribe",
      backupCodes: ["1111-1111", "2222-2222"],
    });
    const result = await enableTwoFactor("secretito", { fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/two-factor/enable");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body!)).toEqual({ password: "secretito" });
    expect(result.totpURI).toContain("otpauth://");
    expect(result.backupCodes).toEqual(["1111-1111", "2222-2222"]);
  });
});

describe("verifyTotp", () => {
  it("hace POST a /api/auth/two-factor/verify-totp con el codigo", async () => {
    const fetchMock = fetchMockReturning({ status: true });
    const result = await verifyTotp("123456", { fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/two-factor/verify-totp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body!)).toEqual({ code: "123456" });
    expect(result.status).toBe(true);
  });

  it("traduce el 401 de codigo invalido a AuthApiError", async () => {
    const fetchMock = fetchMockReturning({ code: "INVALID_CODE", message: "invalid code" }, 401);
    const error = await verifyTotp("000000", { fetch: fetchMock }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ status: 401, code: "INVALID_CODE" });
  });
});

describe("generateBackupCodes", () => {
  it("hace POST a /api/auth/two-factor/generate-backup-codes y devuelve los codigos", async () => {
    const fetchMock = fetchMockReturning({ status: true, backupCodes: ["a", "b", "c"] });
    const codes = await generateBackupCodes("secretito", { fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/two-factor/generate-backup-codes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body!)).toEqual({ password: "secretito" });
    expect(codes).toEqual(["a", "b", "c"]);
  });

  it("devuelve lista vacia si la respuesta no trae codigos", async () => {
    const fetchMock = fetchMockReturning({ status: true });
    expect(await generateBackupCodes("secretito", { fetch: fetchMock })).toEqual([]);
  });
});

describe("signOut", () => {
  it("hace POST a /api/auth/sign-out", async () => {
    const fetchMock = fetchMockReturning({ success: true });
    await signOut({ fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/sign-out");
    expect(init.method).toBe("POST");
  });
});

describe("fetchJson", () => {
  it("hace GET same-origin al path dado (proxy de primera parte)", async () => {
    const fetchMock = fetchMockReturning([{ id: "log-1" }]);
    const result = await fetchJson("/api/v1/admin/audit-logs", { fetch: fetchMock });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/admin/audit-logs");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(result).toEqual([{ id: "log-1" }]);
  });

  it("traduce el 403 TWO_FACTOR_REQUIRED a un AuthApiError reconocible", async () => {
    const fetchMock = fetchMockReturning(
      {
        statusCode: 403,
        code: TWO_FACTOR_REQUIRED,
        message: "Activa el segundo factor (TOTP)",
      },
      403,
    );
    const error: unknown = await fetchJson("/api/v1/admin/audit-logs", {
      fetch: fetchMock,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(isTwoFactorRequired(error)).toBe(true);
  });

  it("traduce el 401 sin sesion a AuthApiError", async () => {
    const fetchMock = fetchMockReturning({ message: "Unauthorized" }, 401);
    const error = await fetchJson("/api/v1/admin/audit-logs", { fetch: fetchMock }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ status: 401 });
  });

  it("devuelve null cuando la respuesta no tiene cuerpo JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: AuthRequestInit) => ({
      ok: true,
      status: 204,
      statusText: "",
      json: async () => {
        throw new Error("sin cuerpo");
      },
    }));
    expect(await fetchJson("/api/v1/admin/audit-logs", { fetch: fetchMock })).toBeNull();
  });
});
