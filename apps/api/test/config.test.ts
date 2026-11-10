import { describe, expect, it } from "vitest";
import { apiConfig } from "../src/config.js";

describe("apiConfig", () => {
  it("expone la API en el puerto 3002", () => {
    expect(apiConfig.port).toBe(3002);
  });

  it("versiona la API en /api/v1", () => {
    expect(apiConfig.basePath).toBe("/api/v1");
  });
});
