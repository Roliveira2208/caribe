import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "../src/lib/csp.js";
import proxy from "../src/proxy.js";

/** script-src aislado: el resto de directivas no debe relajar la política. */
function scriptSrc(csp: string): string {
  return (
    csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src ")) ?? ""
  );
}

/**
 * CSP del panel (T-F2-3, spec security). Se eligen nonces por petición en lugar
 * de hashes: Ant Design inyecta estilos en SSR y Next solo puede marcar sus
 * scripts con el nonce si la página se renderiza bajo demanda. El nonce se
 * genera en proxy.ts, se pasa al render por `x-nonce` y se publica en la
 * cabecera; `script-src` nunca incluye `'unsafe-inline'`.
 */
describe("CSP del panel", () => {
  it("prohíbe scripts inline y usa el nonce de la petición", () => {
    const csp = buildContentSecurityPolicy("bm9uY2U", false);
    expect(scriptSrc(csp)).toContain("'nonce-bm9uY2U'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).toContain("'strict-dynamic'");
    expect(csp).not.toContain("script-src-elem 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("en desarrollo añade unsafe-eval pero nunca unsafe-inline en scripts", () => {
    const csp = buildContentSecurityPolicy("bm9uY2U", true);
    expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
  });

  it("el proxy publica la CSP en páginas y en la página de error", async () => {
    for (const path of ["/es", "/es/admin/payments", "/es/ruta-inexistente"]) {
      const response = await proxy(new NextRequest(`http://localhost:3001${path}`));
      const csp = response.headers.get("content-security-policy");
      expect(csp, path).toBeTruthy();
      expect(scriptSrc(csp ?? "")).not.toContain("'unsafe-inline'");
    }
  });

  it("el proxy entrega el nonce al renderizador de Next", async () => {
    const request = new NextRequest("http://localhost:3001/es");
    const response = await proxy(request);
    const nonce = request.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  });

  it("el shell se renderiza por petición para que el nonce sea único", () => {
    const layout = readFileSync(
      new URL("../src/app/[locale]/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain("connection()");
  });
});
