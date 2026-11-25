import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@caribe/shared";
import {
  archiveCatalogProduct,
  createCatalogProduct,
  listCatalogProducts,
  publishCatalogProduct,
  resolveCatalogPanelAccess,
  updateCatalogProduct,
  type CatalogProduct,
  type CatalogProductInput,
} from "../src/lib/catalog-client";

/**
 * Escenarios `catalog › "Alta de producto en el panel"`, "Edición de producto
 * de la agencia", "Proveedor edita solo sus productos" y "Publicar y archivar
 * producto" (T-F2-18). El cliente solo habla con los endpoints existentes de
 * `/admin/products`: no calcula importes, no envía `tenantId` y decide qué
 * controles ofrece según la matriz resuelta en servidor.
 */
const draft: CatalogProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  providerId: "22222222-2222-4222-8222-222222222222",
  type: "hotel",
  hotelKey: "33333333-3333-4333-8333-333333333333",
  roomType: "double",
  title: { es: "Hab. doble", en: "Double room" },
  description: { es: "Descripción", en: "Description" },
  destination: {
    id: "44444444-4444-4444-8444-444444444444",
    name: { es: "Margarita", en: "Margarita" },
    country: "VE",
    code: "MARG",
  },
  status: "DRAFT",
  basePriceUsd: "120.50",
  cancellationPolicyId: null,
  attributes: { stars: 4, maxGuests: 2, amenities: [], images: [] },
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
};

const validInput: CatalogProductInput = {
  roomType: "double",
  title: { es: "Hab. doble", en: "Double room" },
  description: { es: "Descripción", en: "Description" },
  destinationId: draft.destination.id,
  basePriceUsd: "120.50",
  attributes: { stars: 4, maxGuests: 2, amenities: [], images: [] },
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function problem(status: number, code: string): Response {
  return json({ status, code, message: "error de prueba" }, { status });
}

function fetchSpy(response: Response) {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

describe('catalog › "Alta de producto en el panel" (T-F2-18)', () => {
  it("usa POST /admin/products con texto decimal y sin campos calculados", async () => {
    const fetchImpl = fetchSpy(json({ ...draft, status: "DRAFT" }, { status: 201 }));
    const saved = await createCatalogProduct(validInput, { fetchImpl });

    expect(saved.status).toBe("DRAFT");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/admin/products");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      roomType: "double",
      destinationId: draft.destination.id,
      basePriceUsd: "120.50",
    });
    expect(body).not.toHaveProperty("providerId");
    expect(typeof body["basePriceUsd"]).toBe("string");
    for (const key of ["totalUsd", "totalVes", "exchangeRate", "tenantId", "status", "actorId"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("rechaza localmente montos no decimales y campos calculados sin llamar a la API", async () => {
    const fetchImpl = fetchSpy(json(draft, { status: 201 }));

    await expect(
      createCatalogProduct(
        { ...validInput, basePriceUsd: 120.5 } as unknown as CatalogProductInput,
        {
          fetchImpl,
        },
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });

    await expect(
      createCatalogProduct(
        { ...validInput, totalUsd: "120.50" } as unknown as CatalogProductInput,
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(AuthApiError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('catalog › "Edición de producto de la agencia" (T-F2-18)', () => {
  it("envía solo los campos editables y refleja el estado devuelto por el servidor", async () => {
    const fetchImpl = fetchSpy(json({ ...draft, status: "PUBLISHED", basePriceUsd: "135.00" }));
    const patch = {
      title: { es: "Hab. doble editada", en: "Edited double room" },
      basePriceUsd: "135.00",
    } as unknown as CatalogProductInput;
    const updated = await updateCatalogProduct(draft.id, patch, { fetchImpl });

    expect(updated.status).toBe("PUBLISHED");
    expect(updated.basePriceUsd).toBe("135.00");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe(`/api/v1/admin/products/${draft.id}`);
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["basePriceUsd", "title"]);
    expect(body).not.toHaveProperty("totalVes");
  });

  it("rechaza un parche vacío y los cambios de estado por PUT", async () => {
    const fetchImpl = fetchSpy(json(draft));

    await expect(
      updateCatalogProduct(draft.id, {} as unknown as CatalogProductInput, { fetchImpl }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    await expect(
      updateCatalogProduct(
        draft.id,
        { status: "PUBLISHED" } as unknown as Parameters<typeof updateCatalogProduct>[1],
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('catalog › "Proveedor edita solo sus productos" (T-F2-18)', () => {
  const other = {
    ...draft,
    id: "55555555-5555-4555-8555-555555555555",
    providerId: "66666666-6666-4666-8666-666666666666",
  };

  it("el proveedor solo edita los suyos; el admin edita toda su agencia", () => {
    const provider = resolveCatalogPanelAccess({
      mode: "agency",
      role: "provider",
      providerId: draft.providerId,
    });
    expect(provider.canEdit(draft)).toBe(true);
    expect(provider.canChangeStatus(draft)).toBe(true);
    expect(provider.canEdit(other)).toBe(false);
    expect(provider.canChangeStatus(other)).toBe(false);
    expect(provider.canCreate).toBe(true);

    const admin = resolveCatalogPanelAccess({ mode: "agency", role: "admin" });
    expect(admin.canEdit(other)).toBe(true);
    expect(admin.canChangeStatus(other)).toBe(true);
    expect(admin.canCreate).toBe(true);
  });

  it("el Super Admin solo lee, el agente no entra y el proveedor sin registro falla cerrado", () => {
    const platform = resolveCatalogPanelAccess({ mode: "platform", role: null });
    expect(platform.canRead).toBe(true);
    expect(platform.canCreate).toBe(false);
    expect(platform.canEdit(draft)).toBe(false);
    expect(platform.canChangeStatus(draft)).toBe(false);

    const agent = resolveCatalogPanelAccess({ mode: "agency", role: "agent" });
    const unregistered = resolveCatalogPanelAccess({ mode: "agency", role: "provider" });
    for (const access of [agent, unregistered]) {
      expect(access.canRead).toBe(false);
      expect(access.canCreate).toBe(false);
      expect(access.canEdit(draft)).toBe(false);
    }
  });

  it("el listado filtra por proveedor y conserva el cursor opaco de la API", async () => {
    const fetchImpl = fetchSpy(json({ items: [draft, other], nextCursor: "opaco" }));
    const page = await listCatalogProducts(
      { status: "DRAFT", q: "doble", providerId: draft.providerId, limit: 20, cursor: null },
      { fetchImpl, providerId: draft.providerId },
    );

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("opaco");
    const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const parsed = new URL(String(url), "http://localhost:3001");
    expect(parsed.pathname).toBe("/api/v1/admin/products");
    expect(parsed.searchParams.get("status")).toBe("DRAFT");
    expect(parsed.searchParams.get("q")).toBe("doble");
    expect(parsed.searchParams.get("providerId")).toBe(draft.providerId);
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(parsed.searchParams.has("cursor")).toBe(false);
  });
});

describe('catalog › "Publicar y archivar producto" (T-F2-18)', () => {
  it("publica y archiva por POST sin cuerpo ni importes calculados", async () => {
    const publishFetch = fetchSpy(json({ ...draft, status: "PUBLISHED" }));
    const published = await publishCatalogProduct(draft.id, { fetchImpl: publishFetch });
    expect(published.status).toBe("PUBLISHED");
    const [publishUrl, publishInit] = vi.mocked(publishFetch).mock.calls[0] ?? [];
    expect(publishUrl).toBe(`/api/v1/admin/products/${draft.id}/publish`);
    expect(publishInit?.method).toBe("POST");
    expect(publishInit?.body).toBeUndefined();

    const archiveFetch = fetchSpy(json({ ...draft, status: "ARCHIVED" }));
    const archived = await archiveCatalogProduct(draft.id, { fetchImpl: archiveFetch });
    expect(archived.status).toBe("ARCHIVED");
    const [archiveUrl] = vi.mocked(archiveFetch).mock.calls[0] ?? [];
    expect(archiveUrl).toBe(`/api/v1/admin/products/${draft.id}/archive`);
  });

  it("conserva 403 y traduce 404 sin revelar propiedad", async () => {
    const forbidden = fetchSpy(problem(403, "FORBIDDEN"));
    await expect(publishCatalogProduct(draft.id, { fetchImpl: forbidden })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });

    const missing = fetchSpy(problem(404, "NOT_FOUND"));
    await expect(archiveCatalogProduct(draft.id, { fetchImpl: missing })).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
