import { describe, expect, it, vi } from "vitest";
import { AuthApiError, isTwoFactorRequired } from "@caribe/shared";
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listSessions,
  listTargetOrganizations,
  resolveTargetOrganization,
  resolveUsersPanelAccess,
  revokeSession,
  isUsersOrganizationError,
  type OrganizationOption,
} from "../src/lib/users-client";

/**
 * Escenarios `auth-access › "Invitar miembro con segundo factor"`, "Cambiar rol
 * de un miembro", "Revocar sesión desde el panel", "Organización objetivo ajena",
 * "Super Admin en modo plataforma" y "Operación sin agencia activa" (T-F2-21).
 * El cliente solo habla con rutas ya existentes de Better Auth: no calcula
 * permisos, no envía tokens de API y no expone agencias ajenas como objetivo.
 */
const agency: OrganizationOption = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Agencia Sol",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problem(status: number, code: string): Response {
  return json({ type: "about:blank", title: "Error", status, code }, status);
}

function fetchSpy(response: Response): typeof globalThis.fetch {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

function callOf(fetchImpl: typeof globalThis.fetch): [string, RequestInit | undefined] {
  const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
  return [String(url), init];
}

describe('auth-access › "Invitar miembro con segundo factor" (T-F2-21)', () => {
  it("envía la invitación por la ruta existente y conserva el código de segundo factor", async () => {
    const ok = fetchSpy(json({ id: "inv-1", email: "ana@example.com" }));
    await inviteMember(
      { organizationId: agency.id, email: "ana@example.com", role: "admin" },
      { fetchImpl: ok },
    );
    const [url, init] = callOf(ok);
    expect(url).toBe("/api/auth/organization/invite-member");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(init?.body))).toEqual({
      organizationId: agency.id,
      email: "ana@example.com",
      role: "admin",
    });
    expect(Object.keys(init?.headers ?? {})).not.toContain("authorization");

    const noTotp = fetchSpy(problem(403, "TWO_FACTOR_REQUIRED"));
    await expect(
      inviteMember(
        { organizationId: agency.id, email: "ana@example.com", role: "admin" },
        { fetchImpl: noTotp },
      ),
    ).rejects.toMatchObject({ status: 403, code: "TWO_FACTOR_REQUIRED" });
    expect(isTwoFactorRequired(new AuthApiError(403, "TOTP", "TWO_FACTOR_REQUIRED"))).toBe(true);
  });

  it("rechaza localmente un correo o rol inválidos sin llamar a la API", async () => {
    const fetchImpl = fetchSpy(json({}));
    for (const payload of [
      { organizationId: agency.id, email: "sin-arroba", role: "admin" },
      { organizationId: agency.id, email: "ana@example.com", role: "super_admin" },
      { organizationId: "", email: "ana@example.com", role: "admin" },
    ]) {
      await expect(inviteMember(payload, { fetchImpl })).rejects.toMatchObject({
        status: 422,
        code: "VALIDATION_ERROR",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('auth-access › "Cambiar rol de un miembro" (T-F2-21)', () => {
  it("envía memberId, rol y organización objetivo sin campos calculados", async () => {
    const fetchImpl = fetchSpy(json({ id: "member-1", role: "provider" }));
    await changeMemberRole(
      { organizationId: agency.id, memberId: "member-1", role: "provider" },
      { fetchImpl },
    );
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("/api/auth/organization/update-member-role");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      organizationId: agency.id,
      memberId: "member-1",
      role: "provider",
    });
  });
});

describe('auth-access › "Revocar sesión desde el panel" (T-F2-21)', () => {
  it("la matriz de plataforma permite revocar y la de agencia no", () => {
    const platform = resolveUsersPanelAccess("platform", null);
    expect(platform).toMatchObject({
      visible: true,
      canRead: true,
      canInvite: false,
      canChangeRole: false,
      canRevokeSession: true,
      scope: "platform",
    });

    for (const role of ["owner", "admin"]) {
      const agencyAccess = resolveUsersPanelAccess("agency", role);
      expect(agencyAccess).toMatchObject({
        visible: true,
        canRead: true,
        canInvite: true,
        canChangeRole: true,
        canRevokeSession: false,
        scope: "agency",
      });
    }
    for (const role of ["agent", "provider", "member", null]) {
      const denied = resolveUsersPanelAccess("agency", role);
      expect(denied.visible).toBe(false);
      expect(denied.canInvite).toBe(false);
      expect(denied.canRevokeSession).toBe(false);
    }
  });

  it("revoca por token de sesión en la ruta de plataforma, sin exponerlo en la URL", async () => {
    const fetchImpl = fetchSpy(json({ success: true }));
    await revokeSession("session-token-de-prueba", { fetchImpl });
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("/api/auth/admin/revoke-user-session");
    expect(url).not.toContain("session-token-de-prueba");
    expect(JSON.parse(String(init?.body))).toEqual({ sessionToken: "session-token-de-prueba" });
  });

  it("lee las sesiones por usuario para el selector de plataforma", async () => {
    const fetchImpl = fetchSpy(
      json({
        sessions: [
          {
            id: "session-1",
            token: "session-token-de-prueba",
            userAgent: "Chrome",
            createdAt: "2026-11-25T17:20:00.000Z",
            expiresAt: "2026-11-26T17:20:00.000Z",
          },
        ],
      }),
    );
    const sessions = await listSessions("user-1", { fetchImpl });
    expect(sessions).toMatchObject([
      { id: "session-1", token: "session-token-de-prueba", device: "Chrome" },
    ]);
    expect(callOf(fetchImpl)[0]).toBe("/api/auth/admin/list-user-sessions");
    expect(JSON.parse(String(callOf(fetchImpl)[1]?.body))).toEqual({ userId: "user-1" });
  });
});

describe('auth-access › "Organización objetivo ajena" (T-F2-21)', () => {
  it("solo ofrece como objetivo una organización de las membresías del actor", async () => {
    const fetchImpl = fetchSpy(json([agency]));
    const organizations = await listTargetOrganizations({ fetchImpl });
    expect(organizations).toEqual([agency]);
    expect(callOf(fetchImpl)[0]).toBe("/api/auth/organization/list");

    expect(resolveTargetOrganization(organizations, agency.id)).toEqual(agency);
    expect(() => resolveTargetOrganization(organizations, "org-de-otra-agencia")).toThrow(
      AuthApiError,
    );

    // Si llegara un objetivo ajeno, la API rechaza la escritura; el cliente
    // nunca sustituye ese identificador por la agencia activa.
    const rejected = fetchSpy(problem(403, "FORBIDDEN"));
    await expect(
      inviteMember(
        { organizationId: "org-de-otra-agencia", email: "ana@example.com", role: "admin" },
        { fetchImpl: rejected },
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(JSON.parse(String(callOf(rejected)[1]?.body)).organizationId).toBe(
      "org-de-otra-agencia",
    );
  });
});

describe('auth-access › "Operación sin agencia activa" (T-F2-21)', () => {
  it("falla cerrado antes de pedir miembros sin organización y traduce el 403 de agencia", async () => {
    const fetchImpl = fetchSpy(json({ members: [] }));
    await expect(listMembers("", { fetchImpl })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      isUsersOrganizationError(new AuthApiError(403, "Sin agencia", "ACTIVE_ORGANIZATION_REQUIRED")),
    ).toBe(true);
    expect(isUsersOrganizationError(new AuthApiError(403, "Sin permiso", "FORBIDDEN"))).toBe(false);
  });

  it("parsea miembros con correo y nombre de Better Auth sin inventar datos", async () => {
    const fetchImpl = fetchSpy(
      json({
        members: [
          {
            id: "member-1",
            userId: "user-1",
            role: "admin",
            user: {
              id: "user-1",
              name: "Ana Pérez",
              email: "ana@example.com",
              twoFactorEnabled: true,
            },
          },
          { id: "member-2", userId: "user-2", role: "provider" },
        ],
      }),
    );
    const members = await listMembers(agency.id, { fetchImpl });
    expect(members).toEqual([
      {
        id: "member-1",
        userId: "user-1",
        role: "admin",
        name: "Ana Pérez",
        email: "ana@example.com",
        twoFactorEnabled: true,
      },
      {
        id: "member-2",
        userId: "user-2",
        role: "provider",
        name: null,
        email: null,
        twoFactorEnabled: null,
      },
    ]);
    expect(callOf(fetchImpl)[0]).toBe(
      `/api/auth/organization/list-members?organizationId=${agency.id}`,
    );
  });
});
