import { describe, expect, it, vi } from "vitest";
import { getTenantSettings } from "../src/lib/tenant-settings-client";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response;
}

describe('admin-ui › "Bandera del modo de aprobación" (T-F2-25)', () => {
  it("lee el modo de la API con la sesión del servidor", async () => {
    const fetchImpl = vi.fn(async () => response({ paymentMode: "MANUAL" }));
    const settings = await getTenantSettings({
      cookieHeader: "better-auth.session_token=abc",
      origin: "http://localhost:3001",
      apiUrl: "http://localhost:3002",
      fetchImpl,
    });

    expect(settings).toEqual({ paymentMode: "MANUAL" });
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:3002/api/v1/admin/tenant-settings", {
      headers: {
        cookie: "better-auth.session_token=abc",
        origin: "http://localhost:3001",
      },
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("falla cerrado si la API deniega o devuelve un modo desconocido", async () => {
    await expect(
      getTenantSettings({ fetchImpl: async () => response({ status: 403 }, 403) }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getTenantSettings({ fetchImpl: async () => response({ paymentMode: "OTRO" }) }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
