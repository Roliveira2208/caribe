import { AuthApiError } from "@caribe/shared";

/**
 * Cliente del catálogo del panel (T-F2-18). Habla solo con los endpoints ya
 * existentes de `/admin/products`: el servidor valida, calcula y decide la
 * propiedad de cada fila. Aquí no se construyen importes ni se envía `tenantId`.
 */
export type CatalogMode = "agency" | "platform";
export type CatalogProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface LocalizedText {
  es: string;
  en: string;
}

export interface CatalogDestination {
  id: string;
  name: LocalizedText;
  country: string;
  code: string;
}

export interface CatalogAttributes {
  stars: number;
  maxGuests: number;
  amenities: string[];
  images: string[];
}

export interface CatalogProduct {
  id: string;
  tenantId: string;
  providerId: string;
  type: "hotel";
  hotelKey: string;
  roomType: string;
  title: LocalizedText;
  description: LocalizedText;
  destination: CatalogDestination;
  status: CatalogProductStatus;
  basePriceUsd: string;
  cancellationPolicyId: string | null;
  attributes: CatalogAttributes;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProductPage {
  items: CatalogProduct[];
  viewerProviderId: string | null;
  nextCursor: string | null;
}

export interface CatalogProductQuery {
  status?: CatalogProductStatus | "ALL";
  q?: string;
  providerId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface CatalogProductInput {
  hotelKey?: string;
  roomType: string;
  title: Partial<LocalizedText>;
  description: Partial<LocalizedText>;
  destinationId: string;
  basePriceUsd: string;
  attributes: {
    stars: number;
    maxGuests: number;
    amenities?: string[];
    images?: string[];
  };
  cancellationPolicyId?: string | null;
  providerId?: string;
  /** Se admite para detectar campos calculados y rechazarlos antes de `fetch`. */
  [key: string]: unknown;
}

export interface CatalogApiOptions {
  fetchImpl?: typeof globalThis.fetch;
  /** Registro de proveedor del actor, devuelto por la API en el listado. */
  providerId?: string | null;
}

export interface CatalogPanelAccess {
  mode: CatalogMode;
  role: string | null;
  canRead: boolean;
  canCreate: boolean;
  canEdit: (product: CatalogProduct) => boolean;
  canChangeStatus: (product: CatalogProduct) => boolean;
}

interface CatalogAccessInput {
  mode: CatalogMode;
  role: string | null | undefined;
  providerId?: string | null;
}

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const ROOM_TYPE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = [
  "hotelKey",
  "roomType",
  "title",
  "description",
  "destinationId",
  "basePriceUsd",
  "attributes",
  "cancellationPolicyId",
  "providerId",
] as const;
const UPDATE_FIELDS = CREATE_FIELDS.filter(
  (field) => field !== "providerId" && field !== "hotelKey",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readError(response: Response): Promise<AuthApiError> {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
    code?: unknown;
  } | null;
  const message =
    typeof body?.message === "string" && body.message !== "" ? body.message : response.statusText;
  return new AuthApiError(
    response.status,
    message,
    typeof body?.code === "string" ? body.code : undefined,
  );
}

function validationError(path: string): AuthApiError {
  return new AuthApiError(422, `Solicitud no válida: ${path}`, "VALIDATION_ERROR");
}

/** GET /admin/products: el cursor y los filtros viajan en la query, nunca en el cuerpo. */
export async function listCatalogProducts(
  query: CatalogProductQuery = {},
  options: CatalogApiOptions = {},
): Promise<CatalogProductPage> {
  const params = new URLSearchParams();
  if (query.status && query.status !== "ALL") params.set("status", query.status);
  if (query.q?.trim()) params.set("q", query.q.trim());
  const providerId = options.providerId ?? query.providerId;
  if (providerId) params.set("providerId", providerId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(`/api/v1/admin/products${suffix}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json().catch(() => null);
  if (
    !isRecord(body) ||
    !Array.isArray(body["items"]) ||
    (body["nextCursor"] !== null && typeof body["nextCursor"] !== "string")
  ) {
    throw new AuthApiError(503, "Respuesta de catálogo no válida.", "CATALOG_UNAVAILABLE");
  }
  const viewer = body["viewerProviderId"];
  return {
    items: body["items"] as CatalogProduct[],
    viewerProviderId: typeof viewer === "string" ? viewer : null,
    nextCursor: body["nextCursor"] as string | null,
  };
}

function validateLocalized(value: unknown, path: string): void {
  if (!isRecord(value) || typeof value["es"] !== "string" || value["es"].trim() === "") {
    throw validationError(path);
  }
  for (const [key, text] of Object.entries(value)) {
    if (key !== "es" && key !== "en") throw validationError(path);
    if (text !== undefined && (typeof text !== "string" || text.trim() === "")) {
      throw validationError(path);
    }
  }
}

function validateInput(body: CatalogProductInput, isCreate: boolean): void {
  const allowed: readonly string[] = isCreate ? CREATE_FIELDS : UPDATE_FIELDS;
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw validationError(extra);
  if (!isCreate && Object.keys(body).length === 0) throw validationError("body");

  if (body.roomType !== undefined && !ROOM_TYPE_PATTERN.test(body.roomType)) {
    throw validationError("roomType");
  }
  if (body.title !== undefined) validateLocalized(body.title, "title");
  if (body.description !== undefined) validateLocalized(body.description, "description");
  if (body.destinationId !== undefined && !UUID_PATTERN.test(body.destinationId)) {
    throw validationError("destinationId");
  }
  if (body.hotelKey !== undefined && !UUID_PATTERN.test(body.hotelKey)) {
    throw validationError("hotelKey");
  }
  if (body.providerId !== undefined && !UUID_PATTERN.test(body.providerId)) {
    throw validationError("providerId");
  }
  if (body.cancellationPolicyId !== undefined && body.cancellationPolicyId !== null) {
    if (!UUID_PATTERN.test(body.cancellationPolicyId))
      throw validationError("cancellationPolicyId");
  }
  if (body.basePriceUsd !== undefined) {
    if (
      typeof body.basePriceUsd !== "string" ||
      !MONEY_PATTERN.test(body.basePriceUsd) ||
      Number(body.basePriceUsd) <= 0
    ) {
      throw validationError("basePriceUsd");
    }
  }
  if (body.attributes !== undefined) {
    const attributes = body.attributes;
    if (
      !Number.isInteger(attributes.stars) ||
      attributes.stars < 1 ||
      attributes.stars > 5 ||
      !Number.isInteger(attributes.maxGuests) ||
      attributes.maxGuests < 1 ||
      attributes.maxGuests > 20
    ) {
      throw validationError("attributes");
    }
    for (const key of Object.keys(attributes)) {
      if (!["stars", "maxGuests", "amenities", "images"].includes(key)) {
        throw validationError(`attributes.${key}`);
      }
    }
  }
}

/** El cuerpo se construye campo por campo: nunca se reenvía el objeto recibido. */
function buildBody(body: CatalogProductInput, isCreate: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of isCreate ? CREATE_FIELDS : UPDATE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (field === "title" || field === "description") {
      const localized = value as Partial<LocalizedText>;
      payload[field] = {
        es: localized.es,
        ...(typeof localized.en === "string" ? { en: localized.en } : {}),
      };
      continue;
    }
    if (field === "attributes") {
      const attributes = body.attributes;
      payload[field] = {
        stars: attributes.stars,
        maxGuests: attributes.maxGuests,
        ...(attributes.amenities !== undefined ? { amenities: attributes.amenities } : {}),
        ...(attributes.images !== undefined ? { images: attributes.images } : {}),
      };
      continue;
    }
    payload[field] = value;
  }
  return payload;
}

async function mutate(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown> | null,
  options: CatalogApiOptions,
): Promise<CatalogProduct> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
  };
  if (body !== null) init.body = JSON.stringify(body);
  const response = await doFetch(path, init);
  if (!response.ok) throw await readError(response);
  return (await response.json().catch(() => null)) as CatalogProduct;
}

/** POST /admin/products: el producto vuelve `DRAFT` desde el servidor. */
export async function createCatalogProduct(
  body: CatalogProductInput,
  options: CatalogApiOptions = {},
): Promise<CatalogProduct> {
  validateInput(body, true);
  return mutate("/api/v1/admin/products", "POST", buildBody(body, true), options);
}

/** PUT /admin/products/:id: parche estricto, sin `status` ni propiedad. */
export async function updateCatalogProduct(
  id: string,
  body: CatalogProductInput,
  options: CatalogApiOptions = {},
): Promise<CatalogProduct> {
  validateInput(body, false);
  return mutate(
    `/api/v1/admin/products/${encodeURIComponent(id)}`,
    "PUT",
    buildBody(body, false),
    options,
  );
}

export function publishCatalogProduct(
  id: string,
  options: CatalogApiOptions = {},
): Promise<CatalogProduct> {
  return mutate(`/api/v1/admin/products/${encodeURIComponent(id)}/publish`, "POST", null, options);
}

export function archiveCatalogProduct(
  id: string,
  options: CatalogApiOptions = {},
): Promise<CatalogProduct> {
  return mutate(`/api/v1/admin/products/${encodeURIComponent(id)}/archive`, "POST", null, options);
}

/**
 * Matriz de la UI, fallo cerrado. Owner/admin gestionan la agencia; el
 * proveedor solo sus filas (el id llega del listado de la API, nunca del
 * cliente); el Super Admin lee en plataforma sin acciones de escritura.
 */
export function resolveCatalogPanelAccess({
  mode,
  role,
  providerId,
}: CatalogAccessInput): CatalogPanelAccess {
  const base: CatalogPanelAccess = {
    mode,
    role: role ?? null,
    canRead: false,
    canCreate: false,
    canEdit: () => false,
    canChangeStatus: () => false,
  };

  if (mode === "platform") return { ...base, canRead: true };
  if (role === "owner" || role === "admin") {
    return {
      ...base,
      canRead: true,
      canCreate: true,
      canEdit: () => true,
      canChangeStatus: () => true,
    };
  }
  if (role === "provider" && typeof providerId === "string" && providerId !== "") {
    return {
      ...base,
      canRead: true,
      canCreate: true,
      canEdit: (product) => product.providerId === providerId,
      canChangeStatus: (product) => product.providerId === providerId,
    };
  }
  return base;
}
