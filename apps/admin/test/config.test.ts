import { describe, expect, it } from "vitest";
import { adminConfig } from "../src/config.js";

describe("adminConfig", () => {
  it("expone el panel en el puerto 3001", () => {
    expect(adminConfig.port).toBe(3001);
  });

  it("reenvía /api a la API para la cookie de primera parte", () => {
    expect(adminConfig.apiRoute).toBe("/api");
  });

  it("usa los idiomas compartidos es y en", () => {
    expect(adminConfig.locales).toEqual(["es", "en"]);
  });
});
