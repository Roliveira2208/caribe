import { describe, expect, it } from "vitest";
import { apiConfig, resolveTrustedOrigins } from "../src/config.js";

describe("apiConfig", () => {
  it("expone la API en el puerto 3002", () => {
    expect(apiConfig.port).toBe(3002);
  });

  it("versiona la API en /api/v1", () => {
    expect(apiConfig.basePath).toBe("/api/v1");
  });
});

describe("resolveTrustedOrigins", () => {
  it("recorta y descarta entradas vacías", () => {
    expect(
      resolveTrustedOrigins({
        TRUSTED_ORIGINS: " http://localhost:3000 , , http://localhost:3001 ",
      }),
    ).toEqual(["http://localhost:3000", "http://localhost:3001"]);
  });

  it("devuelve una lista vacía sin orígenes configurados", () => {
    expect(resolveTrustedOrigins({})).toEqual([]);
  });
});
