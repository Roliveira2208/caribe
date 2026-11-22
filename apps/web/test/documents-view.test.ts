import { describe, expect, it } from "vitest";
import { documentsApiUrl, parseBookingDocuments } from "../src/lib/documents-view";

const readyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pendingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ready = {
  id: readyId,
  type: "VOUCHER",
  number: 7,
  status: "READY",
  issuedAt: "2026-11-21T15:00:00.000Z",
  downloadPath: `/api/v1/documents/${readyId}/download`,
};

const pending = {
  id: pendingId,
  type: "RECEIPT",
  number: 8,
  status: "PENDING",
  issuedAt: null,
  downloadPath: null,
};

describe("contrato del listado de documentos", () => {
  it("acepta solo las seis claves del contrato y descarta datos internos", () => {
    const parsed = parseBookingDocuments({
      items: [
        { ...ready, file_url: "docs/secret.pdf", tenantId: "otra", amountUsd: "100.00" },
        pending,
      ],
    });
    expect(parsed).toEqual([ready, pending]);
    expect(JSON.stringify(parsed)).not.toContain("file_url");
    expect(JSON.stringify(parsed)).not.toContain("tenantId");
  });

  it("rechaza un READY sin ruta autenticada y un PENDING con ruta", () => {
    expect(parseBookingDocuments({ items: [{ ...ready, downloadPath: null }] })).toBeNull();
    expect(
      parseBookingDocuments({
        items: [{ ...pending, downloadPath: `/api/v1/documents/${pendingId}/download` }],
      }),
    ).toBeNull();
  });

  it("rechaza rutas inventadas y respuestas sin items", () => {
    expect(
      parseBookingDocuments({
        items: [{ ...ready, downloadPath: "/documentos/voucher.pdf" }],
      }),
    ).toBeNull();
    expect(parseBookingDocuments({ documentos: [] })).toBeNull();
    expect(parseBookingDocuments(null)).toBeNull();
  });

  it("codifica el identificador en la ruta del listado", () => {
    expect(documentsApiUrl("id con/espacio")).toBe(
      "/api/v1/bookings/id%20con%2Fespacio/documents",
    );
  });
});
