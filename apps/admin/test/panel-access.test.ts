import { describe, expect, it, vi } from "vitest";
import type { SessionData } from "@caribe/shared";
import {
  loadActiveMemberRole,
  loadAuditActor,
  loadPanelAccess,
  loadRateRole,
  loadSessionUser,
  parseAgencies,
  resolvePanelAccess,
  type AgencyOption,
} from "../src/lib/panel-access";

const agencies: AgencyOption[] = [
  { id: "org-sol", name: "Agencia Sol" },
  { id: "org-mar", name: "Agencia Mar" },
];

function session(role?: string, activeOrganizationId?: string): SessionData {
  return {
    user: { id: "user-1", email: "admin@example.com", role },
    session: activeOrganizationId ? { activeOrganizationId } : null,
  };
}

function mockFetch(sessionBody: SessionData | null, organizationsBody: unknown) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const body = url.endsWith("/get-session")
      ? sessionBody
      : url.endsWith("/organization/list")
        ? organizationsBody
        : { id: "org-sol" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const options = {
  cookieHeader: "better-auth.session_token=token",
  origin: "http://localhost:3001",
  apiUrl: "http://localhost:3002",
};

describe("resolvePanelAccess", () => {
  it("fija automáticamente la única membresía", () => {
    expect(resolvePanelAccess(session(), [agencies[0]!])).toEqual({
      status: "activate",
      organization: agencies[0],
    });
  });

  it("muestra el selector con varias membresías sin fijar ninguna", () => {
    expect(resolvePanelAccess(session(), agencies)).toEqual({
      status: "choose",
      organizations: agencies,
    });
  });

  it("no entra al panel sin membresías", () => {
    expect(resolvePanelAccess(session(), [])).toEqual({ status: "no-membership" });
  });

  it("entra en modo plataforma aunque el Super Admin tenga membresías", () => {
    expect(resolvePanelAccess(session("super_admin"), agencies)).toEqual({ status: "platform" });
  });

  it("conserva una agencia activa válida", () => {
    expect(resolvePanelAccess(session(undefined, "org-mar"), agencies)).toEqual({
      status: "ready",
      organization: agencies[1],
    });
  });

  it("vuelve a elegir si la agencia activa ya no es una membresía", () => {
    expect(resolvePanelAccess(session(undefined, "org-borrada"), agencies)).toEqual({
      status: "choose",
      organizations: agencies,
    });
  });

  it("pide acceso con una sesión ausente", () => {
    expect(resolvePanelAccess(null, agencies)).toEqual({ status: "login" });
  });
});

describe("parseAgencies", () => {
  it("acepta la lista plana y el objeto con organizations", () => {
    expect(parseAgencies(agencies)).toEqual(agencies);
    expect(parseAgencies({ organizations: agencies })).toEqual(agencies);
  });

  it("descarta entradas sin identificador o nombre", () => {
    expect(parseAgencies([{ id: "org-1", name: "Sol" }, { id: "", name: "Mar" }, null])).toEqual([
      { id: "org-1", name: "Sol" },
    ]);
  });
});

describe("loadPanelAccess", () => {
  it("fija la única agencia contra Better Auth", async () => {
    const { fetchImpl, calls } = mockFetch(session(), [agencies[0]]);
    const access = await loadPanelAccess({ ...options, fetchImpl });

    expect(access).toEqual({ status: "ready", organization: agencies[0] });
    expect(calls.map((call) => call.url)).toContain(
      "http://localhost:3002/api/auth/organization/set-active",
    );
    expect(calls.at(-1)?.body).toBe(JSON.stringify({ organizationId: "org-sol" }));
  });

  it("no fija nada con varias membresías", async () => {
    const { fetchImpl, calls } = mockFetch(session(), agencies);
    const access = await loadPanelAccess({ ...options, fetchImpl });

    expect(access).toEqual({ status: "choose", organizations: agencies });
    expect(calls.some((call) => call.url.endsWith("/set-active"))).toBe(false);
  });

  it("no fija nada para el Super Admin", async () => {
    const { fetchImpl, calls } = mockFetch(session("super_admin"), agencies);
    expect(await loadPanelAccess({ ...options, fetchImpl })).toEqual({ status: "platform" });
    expect(calls.some((call) => call.url.endsWith("/set-active"))).toBe(false);
  });
});

describe("loadSessionUser", () => {
  it("devuelve el id de usuario de la sesión de Better Auth", async () => {
    const { fetchImpl } = mockFetch(session(), agencies);
    await expect(loadSessionUser({ ...options, fetchImpl })).resolves.toBe("user-1");
  });

  it("falla cerrado sin sesión o con un id inválido", async () => {
    const anonymous = vi.fn(async () => new Response(JSON.stringify(null), { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(loadSessionUser({ ...options, fetchImpl: anonymous })).resolves.toBeNull();

    const invalid = vi.fn(async () =>
      new Response(JSON.stringify({ user: { id: 42 } }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadSessionUser({ ...options, fetchImpl: invalid })).resolves.toBeNull();
  });
});

describe("loadAuditActor", () => {
  it("resuelve plataforma para el Super Admin sin consultar membresías", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(session("super_admin")), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadAuditActor({ ...options, fetchImpl })).resolves.toEqual({
      status: "platform",
      role: "super_admin",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("resuelve el rol de la membresía activa para el resto de usuarios", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/get-session")) {
        return new Response(JSON.stringify(session()), { status: 200 });
      }
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await expect(loadAuditActor({ ...options, fetchImpl })).resolves.toEqual({
      status: "ready",
      role: "admin",
    });
  });

  it("falla cerrado sin sesión o sin rol de agencia", async () => {
    const anonymous = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(loadAuditActor({ ...options, fetchImpl: anonymous })).resolves.toEqual({
      status: "login",
      role: null,
    });

    const noRole = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/get-session")) {
        return new Response(JSON.stringify(session()), { status: 200 });
      }
      return new Response(JSON.stringify({ role: null }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await expect(loadAuditActor({ ...options, fetchImpl: noRole })).resolves.toEqual({
      status: "login",
      role: null,
    });
  });
});

describe("loadActiveMemberRole", () => {
  it("lee el mismo rol que usa el panel de tasas", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ role: "agent" }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadActiveMemberRole({ ...options, fetchImpl })).resolves.toBe("agent");
    expect(loadRateRole).toBe(loadActiveMemberRole);
  });
});

describe("loadRateRole", () => {
  it("lee el rol de la membresía activa de Better Auth", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("http://localhost:3002/api/auth/organization/get-active-member-role");
      return new Response(JSON.stringify({ role: "admin" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await expect(loadRateRole({ ...options, fetchImpl })).resolves.toBe("admin");
  });

  it("fallo cerrado: sin rol o con respuesta inválida devuelve null", async () => {
    const unauthorised = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(loadRateRole({ ...options, fetchImpl: unauthorised })).resolves.toBeNull();

    const invalid = vi.fn(async () =>
      new Response(JSON.stringify({ role: 42 }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadRateRole({ ...options, fetchImpl: invalid })).resolves.toBeNull();
  });
});
