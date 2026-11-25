import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrato de la pantalla de usuarios y roles (T-F2-21) sobre el código fuente:
 * usa solo rutas existentes de Better Auth, resuelve el acceso en servidor,
 * no ofrece revocación a la agencia y saca todas las etiquetas de es/en.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function messages(locale: "es" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? flatten(value, path) : [path];
  });
}

describe('auth-access › escenarios del panel de usuarios y roles (T-F2-21)', () => {
  it("resuelve acceso y agencia en servidor antes de mostrar el panel", () => {
    const pagePath = "src/app/[locale]/admin/users/page.tsx";
    expect(existsSync(join(appRoot, pagePath))).toBe(true);
    const page = read(pagePath);
    for (const fragment of [
      "loadPanelAccess(request)",
      "PanelAccessNotice",
      "loadActiveMemberRole(request)",
      "resolveUsersPanelAccess(",
      'alternateLinks(locale, "/admin/users")',
    ]) {
      expect(page, `falta "${fragment}" en la página`).toContain(fragment);
    }
  });

  it("usa las rutas existentes y reacciona al segundo factor y al error de agencia", () => {
    const client = read("src/lib/users-client.ts");
    for (const route of [
      "/organization/list-members",
      "/organization/invite-member",
      "/organization/update-member-role",
      "/admin/list-user-sessions",
      "/admin/revoke-user-session",
    ]) {
      expect(client).toContain(route);
    }
    expect(client).not.toContain("Bearer ");
    expect(client).not.toContain("x-api-key");

    const panel = read("src/components/users-panel.tsx");
    for (const fragment of [
      "isTwoFactorRequired(cause)",
      'router.replace(`/${locale}/two-factor',
      "resolveTargetOrganization(",
      "isUsersOrganizationError(cause)",
      "listSessions(",
      "revokeSession(",
      "access.canInvite",
      "access.canChangeRole",
      "access.canRevokeSession",
    ]) {
      expect(panel, `falta "${fragment}" en el panel`).toContain(fragment);
    }
  });

  it("no ofrece revocación a la agencia y no muestra el token de sesión", () => {
    const panel = read("src/components/users-panel.tsx");
    expect(panel).toContain("access.scope === \"platform\"");
    expect(panel).not.toContain("{session.token}");
    expect(panel).not.toContain("{session.ipAddress}");
    expect(panel).toContain('t("ipHidden")');
    expect(read("src/components/site-header.tsx")).toContain('href="/admin/users"');
  });

  it("saca todos los textos visibles de es y en", () => {
    const keys = [
      "nav.users",
      "users.title",
      "users.description",
      "users.activeAgency",
      "users.tabsMembers",
      "users.tabsSessions",
      "users.tabsAgencies",
      "users.forbidden",
      "users.search",
      "users.searchPlaceholder",
      "users.role",
      "users.allRoles",
      "users.colMember",
      "users.colRole",
      "users.colTwoFactor",
      "users.colLastSession",
      "users.colActions",
      "users.invite",
      "users.changeRole",
      "users.email",
      "users.emailPlaceholder",
      "users.targetOrg",
      "users.cancel",
      "users.save",
      "users.before",
      "users.after",
      "users.confirmRole",
      "users.sessionUserId",
      "users.sessionUserIdPlaceholder",
      "users.loadSessions",
      "users.colDevice",
      "users.colSessionStart",
      "users.colSessionEnd",
      "users.noSessions",
      "users.revokeSelected",
      "users.ipHidden",
      "users.sessionRevoked",
      "users.noMembers",
      "users.noAgencies",
      "users.validationError",
      "users.genericError",
      "users.accessDenied",
      "users.notFound",
    ];
    for (const locale of ["es", "en"] as const) {
      const available = flatten(messages(locale));
      for (const key of keys) expect(available, `${locale}: falta ${key}`).toContain(key);
    }
  });
});
