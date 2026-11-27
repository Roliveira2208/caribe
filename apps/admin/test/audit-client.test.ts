import { describe, expect, it, vi } from "vitest";
import {
  downloadAdminAuditCsv,
  listAdminAuditLogs,
  listAuthEvents,
  resolveAuditAccess,
} from "../src/lib/audit-client";

function fetchJson(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('audit › "Exportación CSV de auditoría" (T-F2-25)', () => {
  it("exporta por la misma ruta con los mismos filtros y el idioma activo", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("ID,Fecha\n", { status: 200 }),
    ) as unknown as typeof fetch;

    const blob = await downloadAdminAuditCsv(
      { action: "payment.approved", from: "2026-11-01T00:00:00.000Z" },
      "es",
      { fetchImpl },
    );

    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    const query = new URLSearchParams(url.split("?")[1]);
    expect([...query.keys()].sort()).toEqual(["action", "format", "from", "lang", "limit"]);
    expect(query.get("format")).toBe("csv");
    expect(query.get("lang")).toBe("es");
    expect(query.get("action")).toBe("payment.approved");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("no envía un cursor de exportación que el usuario no eligió", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 200 }),
    ) as unknown as typeof fetch;
    await downloadAdminAuditCsv({ cursor: "opaco" }, "en", { fetchImpl });
    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(new URLSearchParams(url.split("?")[1]).has("cursor")).toBe(false);
  });
});

describe("cliente de auditoría del admin (T-F2-15)", () => {
  it("envía solo los filtros permitidos y el cursor opaco a /admin/audit-logs", async () => {
    const fetchImpl = fetchJson({ items: [], nextCursor: null });
    await listAdminAuditLogs(
      {
        action: "exchange-rate.override",
        entity: "ExchangeRate",
        actor: "user-1",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-30T23:59:59.999Z",
        cursor: "cursor-opaco",
      },
      { fetchImpl },
    );

    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(url.startsWith("/api/v1/admin/audit-logs?")).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect([...query.keys()].sort()).toEqual(["action", "actor", "cursor", "entity", "from", "to"]);
    expect(query.get("cursor")).toBe("cursor-opaco");
    expect(query.get("action")).toBe("exchange-rate.override");
  });

  it("omite filtros vacíos y no construye un cursor propio", async () => {
    const fetchImpl = fetchJson({ items: [], nextCursor: null });
    await listAdminAuditLogs({ action: "", cursor: null }, { fetchImpl });
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe("/api/v1/admin/audit-logs");
  });

  it("filtra eventos de autenticación por ruta, outcome, rango y cursor", async () => {
    const fetchImpl = fetchJson({ items: [], nextCursor: "siguiente" });
    const page = await listAuthEvents(
      {
        route: "/organization/invite-member",
        outcome: "error",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-30T23:59:59.999Z",
        cursor: "cursor-opaco",
      },
      { fetchImpl },
    );

    expect(page.nextCursor).toBe("siguiente");
    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    const query = new URLSearchParams(url.split("?")[1]);
    expect([...query.keys()].sort()).toEqual(["cursor", "from", "outcome", "route", "to"]);
    expect(query.get("outcome")).toBe("error");
  });

  it("conserva códigos de problema para que la UI distinga 403 y sesión", async () => {
    const fetchImpl = fetchJson(
      { status: 403, code: "ACTIVE_ORGANIZATION_REQUIRED", message: "interno" },
      403,
    );
    await expect(listAdminAuditLogs({}, { fetchImpl })).rejects.toMatchObject({
      status: 403,
      code: "ACTIVE_ORGANIZATION_REQUIRED",
    });
  });

  it("descarta filas mal formadas y expone el cursor devuelto por la API", async () => {
    const fetchImpl = fetchJson({
      items: [
        {
          id: "log-1",
          tenantId: null,
          actorId: null,
          action: "organization.create",
          entity: "organization",
          entityId: "org-1",
          before: null,
          after: { id: "org-1" },
          ip: null,
          at: "2026-11-25T10:00:00.000Z",
        },
        { id: "roto" },
      ],
      nextCursor: "siguiente",
    });
    const page = await listAdminAuditLogs({}, { fetchImpl });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.ip).toBeNull();
    expect(page.nextCursor).toBe("siguiente");
  });
});

describe("matriz del visor de auditoría", () => {
  it("owner y admin leen en su agencia, sin acciones de escritura", () => {
    for (const role of ["owner", "admin"]) {
      expect(resolveAuditAccess("ready", role)).toEqual({
        visible: true,
        canRead: true,
        scope: "agency",
      });
    }
  });

  it("agente, provider, member y roles desconocidos no ven el visor", () => {
    for (const role of ["agent", "provider", "member", "otro", null]) {
      expect(resolveAuditAccess("ready", role).visible).toBe(false);
      expect(resolveAuditAccess("ready", role).canRead).toBe(false);
    }
  });

  it("el Super Admin lee en plataforma en modo solo lectura", () => {
    expect(resolveAuditAccess("platform", null)).toEqual({
      visible: true,
      canRead: true,
      scope: "platform",
    });
    expect(resolveAuditAccess("platform", "owner").scope).toBe("platform");
  });

  it("falla cerrado sin sesión", () => {
    expect(resolveAuditAccess("login", null).visible).toBe(false);
  });
});
