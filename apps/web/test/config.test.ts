import { describe, expect, it } from "vitest";
import { webConfig } from "../src/config.js";

describe("webConfig", () => {
  it("expone la web en el puerto 3000", () => {
    expect(webConfig.port).toBe(3000);
  });

  it("reenvía /api a la API para la cookie de primera parte", () => {
    expect(webConfig.apiRoute).toBe("/api");
  });

  it("usa los idiomas compartidos es y en", () => {
    expect(webConfig.locales).toEqual(["es", "en"]);
  });
});
