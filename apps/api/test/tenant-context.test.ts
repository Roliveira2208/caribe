import { describe, expect, it } from "vitest";
import {
  isPlatformRole,
  tenantContextFromSession,
  type SessionTenantInfo,
} from "../src/tenant/tenant-context.js";

/**
 * Resolucion del contexto de tenant (T-F0-7): funcion pura, sin BD. Los
 * casos de RLS con dos tenants estan en tenant.e2e.ts.
 */
const session = (overrides: Partial<SessionTenantInfo> = {}): SessionTenantInfo => ({
  session: { activeOrganizationId: null },
  user: { role: null },
  ...overrides,
});

describe("tenantContextFromSession", () => {
  it("sin sesion no hay contexto", () => {
    expect(tenantContextFromSession(null)).toEqual({ kind: "none" });
    expect(tenantContextFromSession(undefined)).toEqual({ kind: "none" });
  });

  it("una sesion con organizacion activa resuelve su tenant", () => {
    expect(
      tenantContextFromSession(session({ session: { activeOrganizationId: "org-a" } })),
    ).toEqual({ kind: "tenant", tenantId: "org-a" });
  });

  it("un Super Admin sin agencia activa resuelve plataforma", () => {
    expect(tenantContextFromSession(session({ user: { role: "super_admin" } }))).toEqual({
      kind: "platform",
    });
  });

  it("un cliente sin membresia no resuelve nada", () => {
    expect(tenantContextFromSession(session({ user: { role: "user" } }))).toEqual({ kind: "none" });
    expect(tenantContextFromSession(session())).toEqual({ kind: "none" });
  });

  it("la organizacion activa gana al rol de plataforma", () => {
    expect(
      tenantContextFromSession(
        session({ session: { activeOrganizationId: "org-a" }, user: { role: "super_admin" } }),
      ),
    ).toEqual({ kind: "tenant", tenantId: "org-a" });
  });
});

describe("isPlatformRole", () => {
  it("acepta el rol de plataforma en cadena o arreglo", () => {
    expect(isPlatformRole("super_admin")).toBe(true);
    expect(isPlatformRole(["super_admin", "otro"])).toBe(true);
  });

  it("rechaza cualquier otro valor", () => {
    expect(isPlatformRole("user")).toBe(false);
    expect(isPlatformRole("admin")).toBe(false);
    expect(isPlatformRole(null)).toBe(false);
    expect(isPlatformRole(undefined)).toBe(false);
    expect(isPlatformRole([])).toBe(false);
  });
});
