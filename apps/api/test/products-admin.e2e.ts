import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import {
  addMember,
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * E2E del panel de productos (T-F1-4, delta de catalog "Atributos de hotel" y
 * "Estados", y delta de auth-access "Propiedad de productos").
 *
 * Monta dos agencias con owners, admin, agentes y proveedores reales de Better
 * Auth, y productos por SQL/Prisma. Comprueba por HTTP la matriz de permisos,
 * la propiedad de fila (proveedor solo su registro, otra agencia 404), el
 * CRUD, la propagación de datos de hotel, los estados, el borrado lógico y la
 * paginación por cursor.
 */

interface ProblemBody {
  status: number;
  code: string;
  detail: string;
  errors?: Array<{ path: string; message: string }>;
}

interface PanelProductBody {
  id: string;
  tenantId: string;
  providerId: string;
  type: string;
  hotelKey: string;
  roomType: string;
  title: { es: string; en: string };
  description: { es: string; en: string };
  destination: { id: string; name: { es: string; en: string }; country: string; code: string };
  status: string;
  basePriceUsd: string;
  cancellationPolicyId: string | null;
  attributes: { stars: number; maxGuests: number; amenities: string[]; images: string[] };
  createdAt: string;
  updatedAt: string;
}

interface PanelPageBody {
  items: PanelProductBody[];
  viewerProviderId: string | null;
  nextCursor: string | null;
}

describe("products admin", () => {
  let app: ApiApplication;
  let baseUrl: string;

  const suffix = randomUUID().slice(0, 8);
  const image = "https://images.caribe.test/hotel.jpg";

  let orgA: string;
  let orgB: string;
  let provider1: string;
  let provider2: string;
  let providerB: string;
  let destA: string;
  let destB: string;
  let policyA: string;
  let policyB: string;

  let ownerCookie: string;
  let adminCookie: string;
  let provider1Cookie: string;
  let provider2Cookie: string;
  let providerBCookie: string;
  let agentCookie: string;
  let superCookie: string;

  const hotelShared = randomUUID();
  const hotelOther = randomUUID();
  const hotelAgencyB = randomUUID();
  const hotelDeleted = randomUUID();
  const hotelFull = randomUUID();

  const draftOwn = randomUUID();
  const publishedOwn = randomUUID();
  const draftOther = randomUUID();
  const draftAgencyB = randomUUID();
  const deletedA = randomUUID();
  const draftForSuper = randomUUID();
  const fullHotelIds = Array.from({ length: 5 }, () => randomUUID());
  const extraIds = Array.from({ length: 3 }, () => randomUUID());
  const userIds: string[] = [];

  const titleOwn = { es: "Hotel Sol", en: "Sun Hotel" };
  const titleOther = { es: "Hotel Mar", en: "Sea Hotel" };
  const titleB = { es: "Hotel Luna", en: "Moon Hotel" };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    // Agencia A: owner y admin con TOTP; agente y dos proveedores.
    const owner = await userWithTotp(baseUrl, `owner-products-${suffix}@example.com`);
    userIds.push(owner.userId);
    orgA = (await createAgency(owner.userId, `Agencia productos A ${suffix}`, `productos-a-${suffix}`)).id;
    await setActiveOrg(baseUrl, owner.cookie, orgA);
    ownerCookie = owner.cookie;

    const admin = await userWithTotp(baseUrl, `admin-products-${suffix}@example.com`);
    userIds.push(admin.userId);
    await addMember(orgA, admin.userId, "admin");
    await setActiveOrg(baseUrl, admin.cookie, orgA);
    adminCookie = admin.cookie;

    const provider1User = await createUser(`provider1-products-${suffix}@example.com`);
    userIds.push(provider1User);
    await addMember(orgA, provider1User, "provider");
    provider1Cookie = await signIn(baseUrl, `provider1-products-${suffix}@example.com`);
    await setActiveOrg(baseUrl, provider1Cookie, orgA);
    provider1 = randomUUID();
    await prisma.provider.create({
      data: { id: provider1, tenantId: orgA, userId: provider1User, name: `Proveedor 1 ${suffix}` },
    });

    const provider2User = await createUser(`provider2-products-${suffix}@example.com`);
    userIds.push(provider2User);
    await addMember(orgA, provider2User, "provider");
    provider2Cookie = await signIn(baseUrl, `provider2-products-${suffix}@example.com`);
    await setActiveOrg(baseUrl, provider2Cookie, orgA);
    provider2 = randomUUID();
    await prisma.provider.create({
      data: { id: provider2, tenantId: orgA, userId: provider2User, name: `Proveedor 2 ${suffix}` },
    });

    const agentUser = await createUser(`agent-products-${suffix}@example.com`);
    userIds.push(agentUser);
    await addMember(orgA, agentUser, "agent");
    agentCookie = await signIn(baseUrl, `agent-products-${suffix}@example.com`);
    await setActiveOrg(baseUrl, agentCookie, orgA);

    // Agencia B: owner y proveedor.
    const ownerB = await createUser(`owner-products-b-${suffix}@example.com`);
    userIds.push(ownerB);
    orgB = (await createAgency(ownerB, `Agencia productos B ${suffix}`, `productos-b-${suffix}`)).id;
    const providerBUser = await createUser(`provider-products-b-${suffix}@example.com`);
    userIds.push(providerBUser);
    await addMember(orgB, providerBUser, "provider");
    providerBCookie = await signIn(baseUrl, `provider-products-b-${suffix}@example.com`);
    await setActiveOrg(baseUrl, providerBCookie, orgB);
    providerB = randomUUID();
    await prisma.provider.create({
      data: { id: providerB, tenantId: orgB, userId: providerBUser, name: `Proveedor B ${suffix}` },
    });

    // Super Admin de plataforma con TOTP, sin agencia activa.
    const superAdmin = await userWithTotp(baseUrl, `super-products-${suffix}@example.com`);
    userIds.push(superAdmin.userId);
    await prisma.user.update({
      where: { id: superAdmin.userId },
      data: { role: "super_admin" },
    });
    superCookie = superAdmin.cookie;

    destA = randomUUID();
    destB = randomUUID();
    policyA = randomUUID();
    policyB = randomUUID();
    await prisma.destination.create({
      data: {
        id: destA,
        tenantId: orgA,
        name: { es: "Mérida", en: "Merida" },
        country: "VE",
        code: `mer-${suffix}`,
      },
    });
    await prisma.destination.create({
      data: {
        id: destB,
        tenantId: orgB,
        name: { es: "Margarita", en: "Margarita" },
        country: "VE",
        code: `pmv-${suffix}`,
      },
    });
    await prisma.cancellationPolicy.create({
      data: {
        id: policyA,
        tenantId: orgA,
        name: `Flexible A ${suffix}`,
        rules: [{ hours_before: 72, percentage: 100 }],
      },
    });
    await prisma.cancellationPolicy.create({
      data: {
        id: policyB,
        tenantId: orgB,
        name: `Flexible B ${suffix}`,
        rules: [{ hours_before: 72, percentage: 100 }],
      },
    });

    const product = async (params: {
      id: string;
      tenantId: string;
      providerId: string;
      hotelKey: string;
      roomType: string;
      title: { es: string; en: string };
      destinationId: string;
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
      deletedAt?: Date;
    }) => {
      await prisma.product.create({
        data: {
          id: params.id,
          tenantId: params.tenantId,
          providerId: params.providerId,
          type: "HOTEL",
          hotelKey: params.hotelKey,
          roomType: params.roomType,
          title: params.title,
          description: { es: "Habitación de prueba", en: "Test room" },
          destinationId: params.destinationId,
          status: params.status ?? "DRAFT",
          basePriceUsd: "120.00",
          cancellationPolicyId: params.tenantId === orgA ? policyA : policyB,
          source: "OWN",
          attributes: { stars: 4, maxGuests: 2, amenities: ["wifi"], images: [] },
          deletedAt: params.deletedAt ?? null,
        },
      });
    };

    await product({
      id: draftOwn,
      tenantId: orgA,
      providerId: provider1,
      hotelKey: hotelShared,
      roomType: "standard",
      title: titleOwn,
      destinationId: destA,
    });
    await product({
      id: publishedOwn,
      tenantId: orgA,
      providerId: provider1,
      hotelKey: hotelShared,
      roomType: "suite",
      title: titleOwn,
      destinationId: destA,
      status: "PUBLISHED",
    });
    await product({
      id: draftOther,
      tenantId: orgA,
      providerId: provider2,
      hotelKey: hotelOther,
      roomType: "standard",
      title: titleOther,
      destinationId: destA,
    });
    await product({
      id: draftAgencyB,
      tenantId: orgB,
      providerId: providerB,
      hotelKey: hotelAgencyB,
      roomType: "standard",
      title: titleB,
      destinationId: destB,
    });
    await product({
      id: deletedA,
      tenantId: orgA,
      providerId: provider1,
      hotelKey: hotelDeleted,
      roomType: "standard",
      title: { es: "Hotel Borrado", en: "Deleted Hotel" },
      destinationId: destA,
      deletedAt: new Date(),
    });
    await product({
      id: draftForSuper,
      tenantId: orgA,
      providerId: provider1,
      hotelKey: randomUUID(),
      roomType: "standard",
      title: { es: "Hotel Súper", en: "Super Hotel" },
      destinationId: destA,
    });

    for (const [index, id] of fullHotelIds.entries()) {
      await product({
        id,
        tenantId: orgA,
        providerId: provider1,
        hotelKey: hotelFull,
        roomType: `tipo-${index}`,
        title: { es: `Hotel Lleno ${index}`, en: `Full Hotel ${index}` },
        destinationId: destA,
      });
    }
    for (const [index, id] of extraIds.entries()) {
      await product({
        id,
        tenantId: orgA,
        providerId: provider1,
        hotelKey: randomUUID(),
        roomType: `extra-${index}`,
        title: { es: `Hotel Extra ${index}`, en: `Extra Hotel ${index}` },
        destinationId: destA,
      });
    }
  });

  afterAll(async () => {
    // Si el hook de arranque agota el timeout, orgA/orgB quedan sin asignar:
    // no convertir ese fallo en un error de Prisma que lo oculte.
    if (orgA && orgB) {
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app?.close();
  });

  function url(path: string): string {
    return `${baseUrl}/api/v1${path}`;
  }

  async function call(
    method: string,
    path: string,
    cookie?: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = { origin: authOrigin };
    if (cookie) headers["cookie"] = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    return fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  async function expectProblem(
    res: Response,
    status: number,
    code: string,
  ): Promise<ProblemBody> {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await json<ProblemBody>(res);
    expect(body).toMatchObject({ status, code });
    return body;
  }

  const validCreate = () => ({
    roomType: "standard",
    title: { es: "Hotel Nuevo", en: "New Hotel" },
    description: { es: "Habitación nueva", en: "New room" },
    destinationId: destA,
    basePriceUsd: "150.00",
    attributes: {
      stars: 4,
      maxGuests: 2,
      amenities: ["wifi"],
      images: [image],
    },
  });

  describe("alta y lectura", () => {
    it("el proveedor crea su producto sin enviar providerId y nace DRAFT", async () => {
      const res = await call("POST", "/admin/products", provider1Cookie, validCreate());
      expect(res.status).toBe(201);
      const product = await json<PanelProductBody>(res);
      expect(product).toMatchObject({
        tenantId: orgA,
        providerId: provider1,
        type: "hotel",
        roomType: "standard",
        status: "DRAFT",
        basePriceUsd: "150.00",
        destination: { id: destA },
      });
      expect(product.hotelKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(product.title).toEqual({ es: "Hotel Nuevo", en: "New Hotel" });
      expect(product.attributes).toEqual({
        stars: 4,
        maxGuests: 2,
        amenities: ["wifi"],
        images: [image],
      });
    });

    it("el admin crea un producto para el proveedor que elige", async () => {
      const res = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        roomType: "doble",
        providerId: provider2,
      });
      expect(res.status).toBe(201);
      await expect(json<PanelProductBody>(res)).resolves.toMatchObject({
        providerId: provider2,
        status: "DRAFT",
      });
    });

    it("el proveedor no puede crear para otro proveedor ni para otra agencia", async () => {
      const other = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        providerId: provider2,
      });
      await expectProblem(other, 403, "FORBIDDEN");

      const foreign = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        providerId: providerB,
        destinationId: destB,
      });
      await expectProblem(foreign, 403, "FORBIDDEN");
    });

    it("rechaza atributos inválidos, imágenes no permitidas y montos no decimales", async () => {
      const missingStars = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        attributes: { maxGuests: 2 },
      });
      const missingBody = await expectProblem(missingStars, 422, "VALIDATION_ERROR");
      expect(missingBody.errors?.map((issue) => issue.path)).toContain("attributes.stars");

      const unknownKey = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        attributes: { ...validCreate().attributes, view: "sea" },
      });
      const unknownBody = await expectProblem(unknownKey, 422, "VALIDATION_ERROR");
      expect(unknownBody.errors?.some((issue) => issue.path.startsWith("attributes"))).toBe(true);

      for (const images of [
        Array.from({ length: 11 }, (_, index) => `https://images.caribe.test/${index}.jpg`),
        ["http://images.caribe.test/a.jpg"],
        ["data:image/png;base64,abc"],
        ["/images/a.jpg"],
        ["https://evil.example.com/a.jpg"],
      ]) {
        const res = await call("POST", "/admin/products", provider1Cookie, {
          ...validCreate(),
          attributes: { ...validCreate().attributes, images },
        });
        const body = await expectProblem(res, 422, "VALIDATION_ERROR");
        expect(body.errors?.some((issue) => issue.path.startsWith("attributes.images"))).toBe(true);
      }

      for (const attributes of [
        { ...validCreate().attributes, stars: 0 },
        { ...validCreate().attributes, stars: 6 },
        { ...validCreate().attributes, maxGuests: 0 },
        { ...validCreate().attributes, maxGuests: 21 },
      ]) {
        const res = await call("POST", "/admin/products", provider1Cookie, {
          ...validCreate(),
          attributes,
        });
        await expectProblem(res, 422, "VALIDATION_ERROR");
      }

      for (const basePriceUsd of ["0", "0.00", "1e3", "12.345"]) {
        const res = await call("POST", "/admin/products", provider1Cookie, {
          ...validCreate(),
          basePriceUsd,
        });
        await expectProblem(res, 422, "VALIDATION_ERROR");
      }

      const extraKey = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        status: "PUBLISHED",
      });
      await expectProblem(extraKey, 422, "VALIDATION_ERROR");
    });

    it("el proveedor ve su borrador, no el de otro proveedor y no el de otra agencia", async () => {
      const own = await call("GET", `/admin/products/${draftOwn}`, provider1Cookie);
      expect(own.status).toBe(200);
      await expect(json<PanelProductBody>(own)).resolves.toMatchObject({
        id: draftOwn,
        status: "DRAFT",
      });

      const otherProvider = await call("GET", `/admin/products/${draftOther}`, provider1Cookie);
      await expectProblem(otherProvider, 404, "NOT_FOUND");

      const otherAgency = await call("GET", `/admin/products/${draftAgencyB}`, provider1Cookie);
      await expectProblem(otherAgency, 404, "NOT_FOUND");

      const otherAgencyEdit = await call("PUT", `/admin/products/${draftAgencyB}`, provider1Cookie, {
        basePriceUsd: "99.00",
      });
      await expectProblem(otherAgencyEdit, 404, "NOT_FOUND");
    });

    it("el owner y el admin ven toda su agencia y un producto de otra agencia responde 404", async () => {
      const own = await call("GET", `/admin/products/${draftOwn}`, adminCookie);
      expect(own.status).toBe(200);

      const foreign = await call("GET", `/admin/products/${draftAgencyB}`, adminCookie);
      await expectProblem(foreign, 404, "NOT_FOUND");

      const ownerOwn = await call("GET", `/admin/products/${draftOther}`, ownerCookie);
      expect(ownerOwn.status).toBe(200);
      await expect(json<PanelProductBody>(ownerOwn)).resolves.toMatchObject({
        id: draftOther,
        providerId: provider2,
      });

      const ownerForeign = await call("GET", `/admin/products/${draftAgencyB}`, ownerCookie);
      await expectProblem(ownerForeign, 404, "NOT_FOUND");
    });

    it("un producto con borrado lógico responde 404 en el panel", async () => {
      const res = await call("GET", `/admin/products/${deletedA}`, adminCookie);
      await expectProblem(res, 404, "NOT_FOUND");
    });

    it("el agente no tiene permiso de productos", async () => {
      const list = await call("GET", "/admin/products", agentCookie);
      await expectProblem(list, 403, "FORBIDDEN");

      const create = await call("POST", "/admin/products", agentCookie, validCreate());
      await expectProblem(create, 403, "FORBIDDEN");
    });

    it("sin sesión responde 401", async () => {
      const res = await call("GET", "/admin/products");
      await expectProblem(res, 401, "UNAUTHENTICATED");
    });

    it("el Super Admin lista y lee, pero no crea, edita, publica, archiva ni borra", async () => {
      const list = await call("GET", "/admin/products", superCookie);
      expect(list.status).toBe(200);
      const page = await json<PanelPageBody>(list);
      expect(page.items.some((item) => item.id === draftAgencyB)).toBe(true);
      expect(page.items.some((item) => item.id === draftOwn)).toBe(true);

      const detail = await call("GET", `/admin/products/${draftOwn}`, superCookie);
      expect(detail.status).toBe(200);

      const create = await call("POST", "/admin/products", superCookie, {
        ...validCreate(),
        providerId: provider1,
      });
      await expectProblem(create, 403, "FORBIDDEN");

      const update = await call("PUT", `/admin/products/${draftOwn}`, superCookie, {
        basePriceUsd: "99.00",
      });
      await expectProblem(update, 403, "FORBIDDEN");

      const publish = await call("POST", `/admin/products/${draftForSuper}/publish`, superCookie);
      await expectProblem(publish, 403, "FORBIDDEN");

      const archive = await call("POST", `/admin/products/${draftForSuper}/archive`, superCookie);
      await expectProblem(archive, 403, "FORBIDDEN");

      const remove = await call("DELETE", `/admin/products/${draftForSuper}`, superCookie);
      await expectProblem(remove, 403, "FORBIDDEN");

      const stillDraft = await call("GET", `/admin/products/${draftForSuper}`, adminCookie);
      await expect(json<PanelProductBody>(stillDraft)).resolves.toMatchObject({
        status: "DRAFT",
      });
    });
  });

  describe("edición y propagación de hotel", () => {
    it("propaga título, estrellas, amenidades e imágenes a todos los tipos del hotel", async () => {
      const res = await call("PUT", `/admin/products/${publishedOwn}`, provider1Cookie, {
        title: { es: "Hotel Sol Renovado", en: "Renewed Sun Hotel" },
        description: { es: "Suite renovada", en: "Renewed suite" },
        basePriceUsd: "180.00",
        attributes: {
          stars: 5,
          maxGuests: 4,
          amenities: ["wifi", "spa"],
          images: [image],
        },
      });
      expect(res.status).toBe(200);
      await expect(json<PanelProductBody>(res)).resolves.toMatchObject({
        id: publishedOwn,
        basePriceUsd: "180.00",
        attributes: { stars: 5, maxGuests: 4, amenities: ["wifi", "spa"], images: [image] },
      });

      const sibling = await call("GET", `/admin/products/${draftOwn}`, provider1Cookie);
      const siblingBody = await json<PanelProductBody>(sibling);
      expect(siblingBody.title).toEqual({ es: "Hotel Sol Renovado", en: "Renewed Sun Hotel" });
      expect(siblingBody.attributes).toEqual({
        stars: 5,
        // maxGuests es del tipo: el hermano conserva el suyo.
        maxGuests: 2,
        amenities: ["wifi", "spa"],
        images: [image],
      });
      // La descripción y el precio no se propagan.
      expect(siblingBody.description.es).toBe("Habitación de prueba");
      expect(siblingBody.basePriceUsd).toBe("120.00");
    });

    it("la propagación del hotel no alcanza los tipos de otro proveedor", async () => {
      const hotelKey = randomUUID();
      const own = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        hotelKey,
        providerId: provider1,
        roomType: "propia",
      });
      expect(own.status).toBe(201);
      const ownBody = await json<PanelProductBody>(own);

      const other = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        hotelKey,
        providerId: provider2,
        roomType: "ajena",
        title: titleOther,
      });
      expect(other.status).toBe(201);
      const otherBody = await json<PanelProductBody>(other);
      expect(otherBody.title).toEqual(titleOther);

      const update = await call("PUT", `/admin/products/${ownBody.id}`, provider1Cookie, {
        title: { es: "Solo mi hotel", en: "Only my hotel" },
        attributes: {
          stars: 5,
          maxGuests: 3,
          amenities: ["spa"],
          images: [image],
        },
      });
      expect(update.status).toBe(200);

      const untouched = await call("GET", `/admin/products/${otherBody.id}`, adminCookie);
      await expect(json<PanelProductBody>(untouched)).resolves.toMatchObject({
        id: otherBody.id,
        title: titleOther,
        attributes: { stars: 4, maxGuests: 2, amenities: ["wifi"], images: [image] },
      });
    });

    it("el proveedor no edita el producto de otro proveedor y el admin sí", async () => {
      const forbidden = await call("PUT", `/admin/products/${draftOther}`, provider1Cookie, {
        basePriceUsd: "99.00",
      });
      const forbiddenBody = await expectProblem(forbidden, 404, "NOT_FOUND");
      const missing = await call("GET", `/admin/products/${randomUUID()}`, provider1Cookie);
      const missingBody = await expectProblem(missing, 404, "NOT_FOUND");
      expect(forbiddenBody.detail).toBe(missingBody.detail);

      const forbiddenPublish = await call(
        "POST",
        `/admin/products/${draftOther}/publish`,
        provider1Cookie,
      );
      await expectProblem(forbiddenPublish, 404, "NOT_FOUND");

      const forbiddenArchive = await call(
        "POST",
        `/admin/products/${draftOther}/archive`,
        provider1Cookie,
      );
      await expectProblem(forbiddenArchive, 404, "NOT_FOUND");

      const admin = await call("PUT", `/admin/products/${draftOther}`, adminCookie, {
        description: { es: "Editado por admin", en: "Edited by admin" },
      });
      expect(admin.status).toBe(200);
      await expect(json<PanelProductBody>(admin)).resolves.toMatchObject({
        description: { es: "Editado por admin", en: "Edited by admin" },
      });
    });

    it("rechaza el cuerpo vacío, claves calculadas y referencias de otra agencia", async () => {
      const empty = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {});
      await expectProblem(empty, 422, "VALIDATION_ERROR");

      const status = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {
        status: "PUBLISHED",
      });
      await expectProblem(status, 422, "VALIDATION_ERROR");

      const destination = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {
        destinationId: destB,
      });
      const body = await expectProblem(destination, 422, "VALIDATION_ERROR");
      expect(body.errors?.[0]?.path).toBe("destinationId");

      const policy = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {
        cancellationPolicyId: policyB,
      });
      const policyBody = await expectProblem(policy, 422, "VALIDATION_ERROR");
      expect(policyBody.errors?.[0]?.path).toBe("cancellationPolicyId");

      for (const field of ["totalUsd", "totalVes", "exchangeRate"]) {
        const calculated = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {
          [field]: "1000.00",
        });
        await expectProblem(calculated, 422, "VALIDATION_ERROR");
      }
    });
  });

  describe("publicación, archivo y borrado lógico", () => {
    it("el proveedor publica y archiva su producto; el catálogo público lo refleja", async () => {
      const publish = await call("POST", `/admin/products/${draftOwn}/publish`, provider1Cookie);
      expect(publish.status).toBe(200);
      await expect(json<PanelProductBody>(publish)).resolves.toMatchObject({
        status: "PUBLISHED",
      });

      const publicDetail = await call("GET", `/products/${draftOwn}`);
      expect(publicDetail.status).toBe(200);

      const archive = await call("POST", `/admin/products/${draftOwn}/archive`, provider1Cookie);
      expect(archive.status).toBe(200);
      await expect(json<PanelProductBody>(archive)).resolves.toMatchObject({
        status: "ARCHIVED",
      });

      const hidden = await call("GET", `/products/${draftOwn}`);
      await expectProblem(hidden, 404, "NOT_FOUND");

      const republish = await call("POST", `/admin/products/${draftOwn}/publish`, provider1Cookie);
      expect(republish.status).toBe(200);
      await expect(json<PanelProductBody>(republish)).resolves.toMatchObject({
        status: "PUBLISHED",
      });
      const publicAgain = await call("GET", `/products/${draftOwn}`);
      expect(publicAgain.status).toBe(200);

      const archiveAgain = await call("POST", `/admin/products/${draftOwn}/archive`, provider1Cookie);
      expect(archiveAgain.status).toBe(200);
      await expect(json<PanelProductBody>(archiveAgain)).resolves.toMatchObject({
        status: "ARCHIVED",
      });
    });

    it("el admin publica el producto de otro proveedor y el borrado lógico lo oculta", async () => {
      const publish = await call("POST", `/admin/products/${draftOther}/publish`, adminCookie);
      expect(publish.status).toBe(200);

      const remove = await call("DELETE", `/admin/products/${draftOther}`, adminCookie);
      expect(remove.status).toBe(204);

      const panel = await call("GET", `/admin/products/${draftOther}`, adminCookie);
      await expectProblem(panel, 404, "NOT_FOUND");

      const publicDetail = await call("GET", `/products/${draftOther}`);
      await expectProblem(publicDetail, 404, "NOT_FOUND");

      const provider = await call("GET", `/admin/products/${draftOther}`, provider2Cookie);
      await expectProblem(provider, 404, "NOT_FOUND");
    });
  });

  describe("listado y filtros", () => {
    it("el proveedor solo ve sus productos", async () => {
      const res = await call("GET", "/admin/products?limit=100", provider1Cookie);
      expect(res.status).toBe(200);
      const page = await json<PanelPageBody>(res);
      expect(page.items.every((item) => item.providerId === provider1)).toBe(true);
      expect(page.viewerProviderId).toBe(provider1);
      expect(page.items.some((item) => item.id === draftOther)).toBe(false);
      expect(page.items.some((item) => item.id === draftAgencyB)).toBe(false);
    });

    it("el admin filtra por estado, proveedor, hotel y destino", async () => {
      const byStatus = await call("GET", "/admin/products?status=ARCHIVED&limit=100", adminCookie);
      const statusPage = await json<PanelPageBody>(byStatus);
      expect(statusPage.viewerProviderId).toBeNull();
      expect(statusPage.items.every((item) => item.status === "ARCHIVED")).toBe(true);
      expect(statusPage.items.some((item) => item.id === draftOwn)).toBe(true);

      const byProvider = await call(
        "GET",
        `/admin/products?providerId=${provider2}&limit=100`,
        adminCookie,
      );
      const providerPage = await json<PanelPageBody>(byProvider);
      expect(providerPage.items.every((item) => item.providerId === provider2)).toBe(true);

      const byHotel = await call("GET", `/admin/products?hotelKey=${hotelShared}&limit=100`, adminCookie);
      const hotelPage = await json<PanelPageBody>(byHotel);
      expect(hotelPage.items.map((item) => item.id).sort()).toEqual(
        [draftOwn, publishedOwn].sort(),
      );

      const byDestination = await call(
        "GET",
        `/admin/products?destinationId=${destB}&limit=100`,
        adminCookie,
      );
      const destinationPage = await json<PanelPageBody>(byDestination);
      expect(destinationPage.items).toEqual([]);
    });

    it("busca por título i18n y valida el límite y el cursor", async () => {
      const search = await call("GET", "/admin/products?q=Renovado&limit=100", adminCookie);
      const page = await json<PanelPageBody>(search);
      expect(page.items.some((item) => item.id === publishedOwn)).toBe(true);
      expect(page.items.some((item) => item.id === draftOwn)).toBe(true);

      for (const limit of ["0", "101"]) {
        const res = await call("GET", `/admin/products?limit=${limit}`, adminCookie);
        await expectProblem(res, 422, "VALIDATION_ERROR");
      }

      const cursor = await call("GET", "/admin/products?cursor=%%%", adminCookie);
      const body = await expectProblem(cursor, 422, "VALIDATION_ERROR");
      expect(body.errors?.[0]?.path).toBe("cursor");
    });

    it("pagina con cursor sin repetir ni perder productos", async () => {
      const all = await call("GET", "/admin/products?limit=100", adminCookie);
      const allPage = await json<PanelPageBody>(all);
      const expected = allPage.items.map((item) => item.id).sort();

      const collected: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const query: string = cursor
          ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
          : "?limit=2";
        const res: Response = await call("GET", `/admin/products${query}`, adminCookie);
        expect(res.status).toBe(200);
        const page: PanelPageBody = await json<PanelPageBody>(res);
        collected.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }

      expect(new Set(collected).size).toBe(collected.length);
      expect(collected.sort()).toEqual(expected);
    });
  });

  describe("límite de tipos por hotel", () => {
    it("rechaza un sexto tipo para la misma hotelKey", async () => {
      const res = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        hotelKey: hotelFull,
        providerId: provider1,
        roomType: "sexto",
      });
      const body = await expectProblem(res, 422, "VALIDATION_ERROR");
      expect(body.errors?.[0]?.path).toBe("hotelKey");
    });

    it("sin hotelKey genera uno nuevo y permite el alta", async () => {
      const res = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        providerId: provider1,
      });
      expect(res.status).toBe(201);
      const created = await json<PanelProductBody>(res);
      expect(created.hotelKey).not.toBe(hotelFull);
      expect(created.hotelKey).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("disponibilidad del panel (T-F2-19)", () => {
    interface AvailabilityWriteBody {
      productId: string;
      nights: Array<{ night: string; capacity: number; reserved: number; priceUsd: string }>;
    }

    interface AvailabilityReadBody extends AvailabilityWriteBody {
      from: string;
      to: string;
    }

    let availabilityProductId: string;
    const caracasDay = (offset: number): string =>
      todayInCaracas(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
    const nightA = caracasDay(2);
    const nightB = caracasDay(3);

    beforeAll(async () => {
      const res = await call("POST", "/admin/products", adminCookie, {
        ...validCreate(),
        providerId: provider1,
        roomType: "availability",
      });
      expect(res.status).toBe(201);
      availabilityProductId = (await json<PanelProductBody>(res)).id;
    });

    function nightsOf(productId: string) {
      return prisma.availability.findMany({ where: { productId }, orderBy: { night: "asc" } });
    }

    async function write(nights: unknown[], cookie = adminCookie, productId = availabilityProductId) {
      return call("POST", `/admin/products/${productId}/availability`, cookie, { nights });
    }

    it("crea noches con precio decimal como texto y reserved en cero", async () => {
      const res = await write([
        { night: nightA, capacity: 5, priceUsd: "120.50" },
        { night: nightB, capacity: 4, priceUsd: "130.00" },
      ]);
      expect(res.status).toBe(200);
      const body = await json<AvailabilityWriteBody>(res);
      expect(body.productId).toBe(availabilityProductId);
      expect(body.nights).toMatchObject([
        { night: nightA, capacity: 5, reserved: 0, priceUsd: "120.50" },
        { night: nightB, capacity: 4, reserved: 0, priceUsd: "130.00" },
      ]);

      const rows = await nightsOf(availabilityProductId);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.reserved).toBe(0);
      expect(rows[0]?.priceUsd.toFixed(2)).toBe("120.50");
    });

    it("ajusta una noche existente conservando reserved y sin crear otra fila", async () => {
      await prisma.availability.updateMany({
        where: {
          productId: availabilityProductId,
          night: new Date(`${nightA}T00:00:00.000Z`),
        },
        data: { reserved: 3 },
      });

      const res = await write([{ night: nightA, capacity: 8, priceUsd: "140.00" }]);
      expect(res.status).toBe(200);
      const body = await json<AvailabilityWriteBody>(res);
      expect(body.nights).toMatchObject([
        { night: nightA, capacity: 8, reserved: 3, priceUsd: "140.00" },
      ]);

      const rows = await nightsOf(availabilityProductId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ capacity: 8, reserved: 3 });
      expect(rows[0]?.priceUsd.toFixed(2)).toBe("140.00");
    });

    it("lee cupo, reservadas y precio como texto del ámbito del panel", async () => {
      const res = await call(
        "GET",
        `/admin/products/${availabilityProductId}/availability?from=${nightA}&to=${caracasDay(4)}`,
        adminCookie,
      );
      expect(res.status).toBe(200);
      const body = await json<AvailabilityReadBody>(res);
      expect(body.productId).toBe(availabilityProductId);
      expect(body.from).toBe(nightA);
      expect(body.nights).toMatchObject([
        { night: nightA, capacity: 8, reserved: 3, priceUsd: "140.00" },
        { night: nightB, capacity: 4, reserved: 0, priceUsd: "130.00" },
      ]);
    });

    it("rechaza una noche repetida con 409 y no escribe ninguna fila", async () => {
      const before = await nightsOf(availabilityProductId);
      const res = await write([
        { night: nightB, capacity: 2, priceUsd: "150.00" },
        { night: nightB, capacity: 3, priceUsd: "160.00" },
      ]);
      await expectProblem(res, 409, "AVAILABILITY_DUPLICATED");

      const after = await nightsOf(availabilityProductId);
      expect(after.map((row) => row.night.toISOString().slice(0, 10))).toEqual(
        before.map((row) => row.night.toISOString().slice(0, 10)),
      );
      expect(after.map((row) => row.capacity)).toEqual(before.map((row) => row.capacity));
      expect(after.map((row) => row.priceUsd.toFixed(2))).toEqual(
        before.map((row) => row.priceUsd.toFixed(2)),
      );
    });

    it("rechaza reserved del cliente, precio numérico, campos calculados y capacidad menor que reservadas", async () => {
      for (const night of [
        { night: nightA, capacity: 2, reserved: 1, priceUsd: "120.50" },
        { night: nightA, capacity: 2, priceUsd: 120.5 },
        { night: nightA, capacity: 2, priceUsd: "120.50", totalVes: "100000.00" },
        { night: nightA, capacity: 2, priceUsd: "120.50", totalUsd: "120.50" },
        { night: nightA, capacity: 2, priceUsd: "120.50", exchangeRate: "80.0000" },
        { night: nightA, capacity: 0, priceUsd: "120.50" },
        { night: nightA, capacity: 2, priceUsd: "120.50" },
        { night: "no-es-fecha", capacity: 2, priceUsd: "120.50" },
      ]) {
        await expectProblem(await write([night]), 422, "VALIDATION_ERROR");
      }
    });

    it("aplica propiedad de fila, permisos y sesión", async () => {
      const nights = [{ night: nightA, capacity: 5, priceUsd: "120.50" }];
      const range = `?from=${nightA}&to=${caracasDay(4)}`;
      const read = (productId: string, cookie = "") =>
        call("GET", `/admin/products/${productId}/availability${range}`, cookie);

      await expectProblem(await write(nights, provider1Cookie, draftOther), 404, "NOT_FOUND");
      await expectProblem(await write(nights, adminCookie, draftAgencyB), 404, "NOT_FOUND");
      await expectProblem(await write(nights, agentCookie), 403, "FORBIDDEN");
      await expectProblem(await write(nights, superCookie), 403, "FORBIDDEN");
      await expectProblem(await write(nights, ""), 401, "UNAUTHENTICATED");

      await expectProblem(await read(draftOther, provider1Cookie), 404, "NOT_FOUND");
      await expectProblem(await read(draftAgencyB, adminCookie), 404, "NOT_FOUND");
      await expectProblem(await read(availabilityProductId, agentCookie), 403, "FORBIDDEN");
      await expectProblem(await read(availabilityProductId, ""), 401, "UNAUTHENTICATED");
    });

    it("exige la traducción en en alta y en edición", async () => {
      const create = await call("POST", "/admin/products", provider1Cookie, {
        ...validCreate(),
        title: { es: "Sin inglés" },
      });
      const createBody = await expectProblem(create, 422, "VALIDATION_ERROR");
      expect(createBody.errors?.map((issue) => issue.path)).toContain("title.en");

      const update = await call("PUT", `/admin/products/${draftOwn}`, provider1Cookie, {
        description: { es: "Sin inglés" },
      });
      const updateBody = await expectProblem(update, 422, "VALIDATION_ERROR");
      expect(updateBody.errors?.map((issue) => issue.path)).toContain("description.en");
    });
  });
});
