import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_PORT,
  API_PORT,
  DEFAULT_LOCALE,
  LOCALES,
  WEB_PORT,
  isLocale,
  localeSchema,
  preferredLocale,
  replacePathLocale,
  updateUserLocale,
} from "../src/index";

describe("locale", () => {
  it("acepta es y en como idiomas válidos", () => {
    for (const locale of LOCALES) {
      expect(localeSchema.parse(locale)).toBe(locale);
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rechaza idiomas fuera del catálogo", () => {
    expect(isLocale("fr")).toBe(false);
    expect(localeSchema.safeParse("fr").success).toBe(false);
  });

  it("usa es como idioma por defecto", () => {
    expect(DEFAULT_LOCALE).toBe("es");
  });

  it("respeta el idioma válido del perfil y respalda los valores inválidos en es", () => {
    expect(preferredLocale("en")).toBe("en");
    expect(preferredLocale("es")).toBe("es");
    expect(preferredLocale(null)).toBe("es");
    expect(preferredLocale("fr")).toBe("es");
  });

  it("cambia solo el prefijo de idioma de una ruta local", () => {
    expect(replacePathLocale("/en/admin/payments", "es")).toBe("/es/admin/payments");
    expect(replacePathLocale("/es/admin/payments", "en")).toBe("/en/admin/payments");
    expect(replacePathLocale("/en", "es")).toBe("/es");
  });
});

describe('admin-ui › "Idioma persistido" (T-F2-25)', () => {
  it("guarda el idioma por /api/auth/update-user antes de navegar", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: true }),
    }));
    await updateUserLocale("en", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/update-user", {
      credentials: "same-origin",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
  });
});

describe("ports", () => {
  it("asigna un puerto distinto a cada app", () => {
    expect(new Set([WEB_PORT, ADMIN_PORT, API_PORT]).size).toBe(3);
  });
});
