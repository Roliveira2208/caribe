import { describe, expect, it } from "vitest";
import type { PermissionCheck } from "@thallesp/nestjs-better-auth";
import {
  BETTER_AUTH_ADMIN_ROUTES,
  BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS,
  BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES,
  BETTER_AUTH_NON_ADMIN_ROUTES,
  isAdminRoute,
  joinRoutePath,
  mergeRoutePermissions,
  requiresAdminExclusivePermission,
  targetOrganizationIdOf,
  tenantOrganizationIdOf,
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

  it("la agencia objetivo ignora el cuerpo en rutas que no aceptan organizationId", () => {
    // "request": cuerpo o query y, si no vienen, la activa.
    expect(targetOrganizationIdOf("request", { organizationId: "cuerpo" }, undefined, "activa")).toBe(
      "cuerpo",
    );
    expect(targetOrganizationIdOf("request", {}, { organizationId: "query" }, "activa")).toBe("query");
    expect(targetOrganizationIdOf("request", {}, undefined, "activa")).toBe("activa");
    expect(targetOrganizationIdOf("request", {}, undefined, null)).toBeUndefined();
    // "unknown" (o sin declarar): ni cuerpo ni activa; fail-closed con null.
    expect(targetOrganizationIdOf("unknown", { organizationId: "ajena" }, undefined, "activa")).toBe(
      null,
    );
    expect(targetOrganizationIdOf(undefined, { organizationId: "ajena" }, undefined, "activa")).toBe(
      null,
    );
  });

  it("la auditoría no imputa por el cuerpo en rutas con agencia objetivo desconocida", () => {
    // "request": el cuerpo/query es la agencia afectada (invite-member...).
    expect(
      tenantOrganizationIdOf(
        "invitation",
        { id: "inv", organizationId: "devuelta" },
        { organizationId: "cuerpo" },
        undefined,
        "activa",
        "request",
      ),
    ).toBe("cuerpo");

    // "unknown" (cancel-invitation): el cuerpo lo ve el hook crudo y la lib lo
    // ignora; la fila va a la agencia de la invitación devuelta (T-F0-19).
    expect(
      tenantOrganizationIdOf(
        "invitation",
        { id: "inv", organizationId: "de-la-invitacion" },
        { organizationId: "ajena" },
        { organizationId: "ajena" },
        "activa",
        "unknown",
      ),
    ).toBe("de-la-invitacion");

    // La entidad devuelta puede venir anidada (remove-member -> { member }).
    expect(
      tenantOrganizationIdOf(
        "member",
        { member: { id: "m", organizationId: "de-la-membresia" } },
        { organizationId: "ajena" },
        undefined,
        "activa",
        "unknown",
      ),
    ).toBe("de-la-membresia");

    // Sin entidad devuelta con agencia, "unknown" cae a la activa (no al
    // cuerpo): imputar a una agencia inventada por el cliente nunca.
    expect(
      tenantOrganizationIdOf("invitation", {}, { organizationId: "ajena" }, undefined, "activa", "unknown"),
    ).toBe("activa");
    // Y "request" mantiene el respaldo entidad -> activa sin cuerpo.
    expect(
      tenantOrganizationIdOf(
        "invitation",
        { organizationId: "devuelta" },
        {},
        undefined,
        "activa",
        "request",
      ),
    ).toBe("devuelta");
  });

  it("el registro de rutas no administrativas de Better Auth es explícito (T-F1-0)", () => {
    // Snapshot de better-auth 1.7.18. Un upgrade que añada, renombre o
    // elimine rutas obliga a revisar estas listas: el inventario e2e compara
    // contra auth.api real.
    expect(BETTER_AUTH_NON_ADMIN_ROUTES).toHaveLength(30);
    expect(BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES).toHaveLength(15);
    expect(BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS).toEqual(
      BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES.map((route) => route.path),
    );

    for (const route of [
      ...BETTER_AUTH_NON_ADMIN_ROUTES,
      ...BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES,
    ]) {
      expect(route.reason.trim(), `${route.path} sin justificación`).not.toBe("");
    }
  });

  it("las rutas no administrativas no invaden las familias administrativas", () => {
    const familyPrefixes = ["/admin", "/organization", "/two-factor"];
    expect(
      BETTER_AUTH_NON_ADMIN_ROUTES.filter((route) =>
        familyPrefixes.some((prefix) => route.path.startsWith(prefix)),
      ),
    ).toEqual([]);
    expect(
      BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES.filter(
        (route) => !route.path.startsWith("/organization/"),
      ),
    ).toEqual([]);
  });

  it("ninguna ruta está a la vez en la tabla administrativa y en una lista no administrativa", () => {
    const adminPaths = new Set(BETTER_AUTH_ADMIN_ROUTES.map((route) => route.path));
    const overlaps = [
      ...BETTER_AUTH_NON_ADMIN_ROUTES,
      ...BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES,
    ].filter((route) => adminPaths.has(route.path));
    expect(overlaps.map((route) => route.path)).toEqual([]);
  });

  it("la tabla administrativa y la allowlist no admiten paths con parámetros", () => {
    // La clasificación es un Map exacto y no puede casar con ctx.path; el
    // módulo falla al cargar si alguien añade un patrón. Las rutas con
    // parámetros de la lib son no administrativas y están declaradas en
    // BETTER_AUTH_NON_ADMIN_ROUTES.
    expect(BETTER_AUTH_ADMIN_ROUTES.filter((route) => route.path.includes(":"))).toEqual([]);
    expect(
      BETTER_AUTH_NON_ADMIN_ORGANIZATION_ROUTES.filter((route) => route.path.includes(":")),
    ).toEqual([]);
  });

  it("joinRoutePath no deja barras finales cuando el método no declara path", () => {
    // @Get() sin argumento declara "/" en la metadata de Nest; la ruta
    // registrada es la del controller, sin barra final.
    expect(joinRoutePath("products", "/")).toBe("products");
    expect(joinRoutePath("admin/audit-logs", "/")).toBe("admin/audit-logs");
    expect(joinRoutePath("/products/", "/:id/")).toBe("products/:id");
    expect(joinRoutePath("/", "/")).toBe("");
  });
});
