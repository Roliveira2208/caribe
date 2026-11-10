import { describe, expect, it } from "vitest";
import type { PermissionCheck } from "@thallesp/nestjs-better-auth";
import {
  isAdminRoute,
  mergeRoutePermissions,
  requiresAdminExclusivePermission,
} from "../src/admin/admin-route.js";

/**
 * Clasificacion de rutas administrativas (T-F0-8, delta de auth-access): la
 * lista de permisos exclusivos se fija contra la matriz aprobada en T-F0-6
 * para que un cambio en access.ts no recalibre en silencio que rutas exigen
 * segundo factor.
 */

/** Exclusivos: concedidos a owner/admin/super_admin y a ningun otro rol. */
const EXCLUSIVE_ADMIN_PERMISSIONS: PermissionCheck[] = [
  { payment: ["review"] },
  { "exchange-rate": ["read", "update"] },
  { report: ["read"] },
  { audit: ["read"] },
  { member: ["create", "update", "delete"] },
  { invitation: ["create", "cancel"] },
  { organization: ["create", "read", "update", "delete"] },
  { booking: ["update", "cancel"] },
  {
    user: ["create", "list", "get", "update", "set-role", "ban", "set-password"],
  },
  { session: ["list", "revoke"] },
];

/** Compartidos con agent/provider/member: no exigen segundo factor. */
const NON_EXCLUSIVE_PERMISSIONS: PermissionCheck[] = [
  { product: ["create", "read", "update", "delete"] },
  { booking: ["create", "read"] },
  { payment: ["read"] },
];

describe("clasificación de rutas administrativas (T-F0-8)", () => {
  it("los permisos exclusivos administrativos salen de la matriz T-F0-6", () => {
    for (const permission of EXCLUSIVE_ADMIN_PERMISSIONS) {
      expect(
        requiresAdminExclusivePermission(permission),
        `debe ser exclusivo: ${JSON.stringify(permission)}`,
      ).toBe(true);
    }
    for (const permission of NON_EXCLUSIVE_PERMISSIONS) {
      expect(
        requiresAdminExclusivePermission(permission),
        `no debe ser exclusivo: ${JSON.stringify(permission)}`,
      ).toBe(false);
    }
  });

  it("toda ruta registrada bajo /admin es administrativa", () => {
    expect(isAdminRoute({ path: "admin/exchange-rates/override" })).toBe(true);
    expect(isAdminRoute({ path: "admin" })).toBe(true);
    expect(isAdminRoute({ path: "admin/audit-logs", permissions: { audit: ["read"] } })).toBe(true);
  });

  it("fuera de /admin solo clasifican permiso o rol administrativo", () => {
    // product:update lo comparte el proveedor: no administrativa.
    expect(isAdminRoute({ path: "products", permissions: { product: ["update"] } })).toBe(false);
    expect(isAdminRoute({ path: "bookings/abc" })).toBe(false);
    // "adminfoo" no es el prefijo /admin.
    expect(isAdminRoute({ path: "adminfoo/reports" })).toBe(false);
    // exchange-rate:read y audit:read son exclusivos.
    expect(
      isAdminRoute({ path: "exchange-rates/current", permissions: { "exchange-rate": ["read"] } }),
    ).toBe(true);
    expect(isAdminRoute({ path: "audit-logs", permissions: { audit: ["read"] } })).toBe(true);
  });

  it("los roles administrativos exigidos también vuelven administrativa la ruta", () => {
    expect(isAdminRoute({ path: "platform/status", systemRoles: ["super_admin"] })).toBe(true);
    expect(isAdminRoute({ path: "agencies/status", orgRoles: ["owner", "admin"] })).toBe(true);
    expect(isAdminRoute({ path: "bookings", orgRoles: ["provider"] })).toBe(false);
    expect(isAdminRoute({ path: "users", systemRoles: ["user"] })).toBe(false);
  });

  it("mergeRoutePermissions une los checks de todos los decoradores", () => {
    expect(
      mergeRoutePermissions(
        { permission: { product: ["update"] } },
        { permissions: { "exchange-rate": ["update"] } },
      ),
    ).toEqual({ product: ["update"], "exchange-rate": ["update"] });
    expect(mergeRoutePermissions(undefined, undefined)).toBeUndefined();
  });
});
