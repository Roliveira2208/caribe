import { describe, expect, it } from "vitest";
import { auditCsv } from "../src/audit/audit.csv.js";
import type { AuditLogItem, AuditLogPage } from "../src/audit/audit.schemas.js";

/**
 * Serializador puro del CSV de auditoría (T-F2-25). Comprueba que solo salen
 * columnas permitidas, que los estados se traducen y que ningún payload
 * sensible (ni el tenant) se cuela en el archivo.
 */
function itemWith(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    actorId: "33333333-3333-4333-8333-333333333333",
    action: "payment.review",
    entity: "payment",
    entityId: "44444444-4444-4444-8444-444444444444",
    before: { status: "IN_REVIEW", password: "Password123!" },
    after: { status: "APPROVED", token: "secreto", internalMessage: "stack trace" },
    ip: "127.0.0.1",
    at: "2026-11-26T12:00:00.000Z",
    ...overrides,
  };
}

function pageWith(...items: AuditLogItem[]): AuditLogPage {
  return { items, nextCursor: null };
}

describe("audit: CSV con columnas permitidas y estados localizados", () => {
  it("usa encabezados en español y estados de negocio traducidos", () => {
    const csv = auditCsv(pageWith(itemWith()), "es");
    const lines = csv.trim().split(/\r?\n/);

    expect(lines[0]).toBe(
      "ID,Fecha,Actor,Acción,Entidad,ID de entidad,Estado anterior,Estado nuevo,IP",
    );
    expect(lines[1]).toBe(
      "11111111-1111-4111-8111-111111111111,2026-11-26T12:00:00.000Z,33333333-3333-4333-8333-333333333333,payment.review,payment,44444444-4444-4444-8444-444444444444,En revisión,Aprobado,127.0.0.1",
    );
  });

  it("usa encabezados y estados en inglés con lang=en", () => {
    const csv = auditCsv(pageWith(itemWith()), "en");
    const lines = csv.trim().split(/\r?\n/);

    expect(lines[0]).toBe(
      "ID,Date,Actor,Action,Entity,Entity ID,Previous status,New status,IP",
    );
    expect(lines[1]).toContain(",Under review,Approved,");
  });

  it("no incluye tenant, secretos ni mensajes internos de los payloads", () => {
    const csv = auditCsv(pageWith(itemWith()), "es");

    expect(csv).not.toContain("tenantId");
    expect(csv).not.toContain("tenant_id");
    expect(csv).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(csv).not.toContain("Password123!");
    expect(csv).not.toContain("secreto");
    expect(csv).not.toContain("stack trace");
    expect(csv).not.toContain("password");
    expect(csv).not.toContain("internalMessage");
  });

  it("rotula estados ausentes o desconocidos sin volcar texto arbitrario", () => {
    const csv = auditCsv(
      pageWith(
        itemWith({
          before: null,
          after: { status: "MENSAJE_INTERNO_CON_SECRETO" },
        }),
      ),
      "es",
    );

    expect(csv).toContain(",—,Otro,");
    expect(csv).not.toContain("MENSAJE_INTERNO_CON_SECRETO");
  });

  it("prefija con apóstrofo las celdas que empiezan por =, +, - o @", () => {
    const csv = auditCsv(
      pageWith(
        itemWith({
          id: "=SUM(1+1)",
          action: "@cmd",
          actorId: "+1.00",
          entity: "-2.00",
        }),
      ),
      "es",
    );

    expect(csv.split(/\r?\n/)[1]).toContain(
      "'=SUM(1+1),2026-11-26T12:00:00.000Z,'+1.00,'@cmd,'-2.00,",
    );
  });

  it("mantiene el escape de comillas al prefijar una fórmula", () => {
    const csv = auditCsv(
      pageWith(itemWith({ action: '=HYPERLINK("http://x","ir")' })),
      "en",
    );

    expect(csv).toContain('"\'=HYPERLINK(""http://x"",""ir"")"');
  });
});
