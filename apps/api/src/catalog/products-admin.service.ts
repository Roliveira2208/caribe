import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { formatAmount, formatTimestamp, formatValueDate, todayInCaracas } from "@caribe/shared";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { Prisma } from "../generated/prisma/client.js";
import { TenantService } from "../tenant/tenant.service.js";
import { AVAILABILITY_DEFAULT_NIGHTS, addDays, type AvailabilityQuery } from "./catalog.schemas.js";
import { toAttributes, toLocalized } from "./catalog.mappers.js";
import {
  PRODUCTS_ADMIN_DEFAULT_LIMIT,
  normalizeLocalized,
  type AvailabilityWriteBody,
  type CreateProductBody,
  type LocalizedInput,
  type PanelAvailabilityNight,
  type PanelAvailabilityRead,
  type PanelAvailabilityWrite,
  type PanelProduct,
  type PanelProductPage,
  type ProductsAdminQuery,
  type UpdateProductBody,
} from "./products-admin.schemas.js";
import {
  decodeProductsAdminCursor,
  encodeProductsAdminCursor,
} from "./products-admin.cursor.js";
import type { ProductActor } from "./products.guard.js";

type ProductWithDestination = Prisma.ProductGetPayload<{ include: { destination: true } }>;

/**
 * CRUD de tipos de habitación del panel (T-F1-4, specs/catalog y auth-access
 * "Propiedad de productos").
 *
 * Todas las consultas corren en el contexto RLS de la agencia activa o, para
 * el Super Admin, en el contexto `platform`. Además de RLS, cada consulta
 * filtra `tenant_id` y `deleted_at` de forma explícita: en las pruebas la API
 * conecta como superusuario y la lectura no debe depender del rol de la
 * conexión.
 *
 * La propiedad de fila se comprueba aquí, no en el guard: un proveedor solo
 * ve y edita los productos de su registro `providers.user_id`; un producto
 * ajeno (otro proveedor u otra agencia) responde 404 sin revelar propiedad.
 * Los campos de hotel (`title`, `stars`, `amenities`, `images`) se propagan a
 * todos los tipos con la misma `hotel_key` en la misma transacción; el resto
 * son del tipo editado (design §2.2).
 */
@Injectable()
export class ProductsAdminService {
  constructor(private readonly tenantService: TenantService) {}

  /** Listado keyset `updated_at DESC, id DESC` con filtros del panel. */
  async list(actor: ProductActor, query: ProductsAdminQuery): Promise<PanelProductPage> {
    const limit = query.limit ?? PRODUCTS_ADMIN_DEFAULT_LIMIT;
    const cursor = query.cursor ? decodeProductsAdminCursor(query.cursor) : null;

    let viewerProviderId: string | null = null;
    const rows = await this.run(actor, async (tx) => {
      const providerId = await this.providerScope(tx, actor);
      viewerProviderId = providerId;
      return tx.product.findMany({
        where: {
          AND: [
            this.tenantFilter(actor),
            { deletedAt: null },
            providerId ? { providerId } : {},
            query.status ? { status: query.status } : {},
            query.providerId ? { providerId: query.providerId } : {},
            query.hotelKey ? { hotelKey: query.hotelKey } : {},
            query.destinationId ? { destinationId: query.destinationId } : {},
            query.q
              ? {
                  OR: [
                    { title: { path: ["es"], string_contains: query.q } },
                    { title: { path: ["en"], string_contains: query.q } },
                  ],
                }
              : {},
            cursor
              ? {
                  OR: [
                    { updatedAt: { lt: new Date(cursor.updatedAt) } },
                    { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
                  ],
                }
              : {},
          ],
        },
        include: { destination: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toPanelProduct),
      viewerProviderId,
      nextCursor:
        hasMore && last
          ? encodeProductsAdminCursor({
              updatedAt: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** Ficha de panel; incluye borradores y archivados, nunca borrados lógicos. */
  async detail(actor: ProductActor, id: string): Promise<PanelProduct> {
    const product = await this.run(actor, (tx) => this.findProduct(tx, actor, id));
    return toPanelProduct(product);
  }

  /** Alta de un tipo de habitación en estado `DRAFT`. */
  async create(actor: ProductActor, body: CreateProductBody): Promise<PanelProduct> {
    const product = await this.run(actor, async (tx) => {
      const tenantId = this.requireTenant(actor);
      const providerId = await this.resolveCreateProvider(tx, actor, body.providerId);
      await this.assertDestination(tx, tenantId, body.destinationId);
      await this.assertCancellationPolicy(tx, tenantId, body.cancellationPolicyId ?? null);

      const hotelKey = body.hotelKey ?? randomUUID();
      if (body.hotelKey) {
        const siblings = await tx.product.count({
          where: { tenantId, hotelKey, deletedAt: null },
        });
        if (siblings >= 5) {
          throw validationError(
            "hotelKey",
            "Un hotel no puede tener más de 5 tipos de habitación",
          );
        }
      }

      return tx.product.create({
        data: {
          id: randomUUID(),
          tenantId,
          providerId,
          type: "HOTEL",
          hotelKey,
          roomType: body.roomType,
          title: localizedJson(body.title),
          description: localizedJson(body.description),
          destinationId: body.destinationId,
          status: "DRAFT",
          basePriceUsd: body.basePriceUsd,
          cancellationPolicyId: body.cancellationPolicyId ?? null,
          source: "OWN",
          attributes: body.attributes,
        },
        include: { destination: true },
      });
    });

    return toPanelProduct(product);
  }

  /**
   * Edición parcial. `title` y los atributos compartidos del hotel se
   * propagan a todos los tipos de la misma `hotel_key`; `description`,
   * `roomType`, `maxGuests`, `basePriceUsd`, destino y política son del tipo
   * editado.
   */
  async update(
    actor: ProductActor,
    id: string,
    body: UpdateProductBody,
  ): Promise<PanelProduct> {
    const product = await this.run(actor, async (tx) => {
      const current = await this.findProduct(tx, actor, id);
      const tenantId = this.requireTenant(actor);

      if (body.destinationId !== undefined) {
        await this.assertDestination(tx, tenantId, body.destinationId);
      }
      if (body.cancellationPolicyId !== undefined && body.cancellationPolicyId !== null) {
        await this.assertCancellationPolicy(tx, tenantId, body.cancellationPolicyId);
      }

      if (body.title !== undefined) {
        await tx.product.updateMany({
          where: { tenantId, hotelKey: current.hotelKey, deletedAt: null },
          data: { title: localizedJson(body.title) },
        });
      }

      if (body.attributes !== undefined) {
        const siblings = await tx.product.findMany({
          where: { tenantId, hotelKey: current.hotelKey, deletedAt: null },
          select: { id: true, attributes: true },
        });
        for (const sibling of siblings) {
          const previous = toAttributes(sibling.attributes);
          const attributes = {
            stars: body.attributes.stars,
            // La ocupación es del tipo: solo cambia en la fila editada.
            maxGuests:
              sibling.id === current.id ? body.attributes.maxGuests : previous.maxGuests,
            amenities: body.attributes.amenities,
            images: body.attributes.images,
          };
          await tx.product.update({ where: { id: sibling.id }, data: { attributes } });
        }
      }

      const perType: Prisma.ProductUpdateInput = {};
      if (body.description !== undefined) {
        perType.description = localizedJson(body.description);
      }
      if (body.roomType !== undefined) perType.roomType = body.roomType;
      if (body.basePriceUsd !== undefined) perType.basePriceUsd = body.basePriceUsd;
      if (body.destinationId !== undefined) {
        perType.destination = { connect: { id: body.destinationId } };
      }
      if (body.cancellationPolicyId !== undefined) {
        perType.cancellationPolicy = body.cancellationPolicyId
          ? { connect: { id: body.cancellationPolicyId } }
          : { disconnect: true };
      }
      if (Object.keys(perType).length > 0) {
        await tx.product.update({ where: { id: current.id }, data: perType });
      }

      return tx.product.findUniqueOrThrow({
        where: { id: current.id },
        include: { destination: true },
      });
    });

    return toPanelProduct(product);
  }

  /** Publica el producto (cualquier estado previo salvo borrado lógico). */
  async publish(actor: ProductActor, id: string): Promise<PanelProduct> {
    return this.setStatus(actor, id, "PUBLISHED");
  }

  /** Archiva el producto. */
  async archive(actor: ProductActor, id: string): Promise<PanelProduct> {
    return this.setStatus(actor, id, "ARCHIVED");
  }

  /** Noches del ámbito del actor con cupo y reservadas, nunca inferidas. */
  async readAvailability(
    actor: ProductActor,
    id: string,
    query: AvailabilityQuery,
  ): Promise<PanelAvailabilityRead> {
    const from = query.from ?? todayInCaracas();
    const to = query.to ?? addDays(from, AVAILABILITY_DEFAULT_NIGHTS);
    return this.run(actor, async (tx) => {
      const product = await this.findProduct(tx, actor, id);
      const rows = await tx.availability.findMany({
        where: {
          productId: product.id,
          night: { gte: nightDate(from), lt: nightDate(to) },
        },
        orderBy: { night: "asc" },
        select: { night: true, capacity: true, reserved: true, priceUsd: true },
      });
      return {
        productId: product.id,
        from,
        to,
        nights: rows.map((row) => ({
          night: formatValueDate(row.night),
          capacity: row.capacity,
          reserved: row.reserved,
          priceUsd: formatAmount(row.priceUsd),
        })),
      };
    });
  }

  /**
   * Crea o ajusta noches en una sola transacción. Una noche repetida en el
   * cuerpo se detecta antes de escribir; `reserved` nunca viaja del cliente:
   * se conserva en la fila existente y nace en cero en la nueva.
   */
  async writeAvailability(
    actor: ProductActor,
    id: string,
    body: AvailabilityWriteBody,
  ): Promise<PanelAvailabilityWrite> {
    return this.run(actor, async (tx) => {
      const product = await this.findProduct(tx, actor, id);
      const nights = new Set<string>();
      for (const night of body.nights) {
        if (nights.has(night.night)) {
          throw duplicatedNight();
        }
        nights.add(night.night);
      }

      const written: PanelAvailabilityNight[] = [];
      try {
        for (const night of body.nights) {
          const date = nightDate(night.night);
          const current = await tx.availability.findUnique({
            where: { productId_night: { productId: id, night: date } },
            select: { reserved: true },
          });
          const reserved = current?.reserved ?? 0;
          if (night.capacity < reserved) {
            throw validationError(
              "nights.capacity",
              "La capacidad no puede ser menor que las habitaciones reservadas",
            );
          }

          if (current) {
            await tx.availability.update({
              where: { productId_night: { productId: id, night: date } },
              data: { capacity: night.capacity, priceUsd: night.priceUsd },
            });
          } else {
            await tx.availability.create({
              data: {
                id: randomUUID(),
                tenantId: product.tenantId,
                productId: id,
                night: date,
                capacity: night.capacity,
                reserved: 0,
                priceUsd: night.priceUsd,
              },
            });
          }
          written.push({
            night: night.night,
            capacity: night.capacity,
            reserved,
            priceUsd: formatAmount(night.priceUsd),
          });
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw duplicatedNight();
        }
        throw error;
      }
      return { productId: id, nights: written };
    });
  }

  /** Borrado lógico: todas las lecturas posteriores responden 404. */
  async remove(actor: ProductActor, id: string): Promise<void> {
    await this.run(actor, async (tx) => {
      const current = await this.findProduct(tx, actor, id);
      await tx.product.update({
        where: { id: current.id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async setStatus(
    actor: ProductActor,
    id: string,
    status: "PUBLISHED" | "ARCHIVED",
  ): Promise<PanelProduct> {
    const product = await this.run(actor, async (tx) => {
      const current = await this.findProduct(tx, actor, id);
      return tx.product.update({
        where: { id: current.id },
        data: { status },
        include: { destination: true },
      });
    });
    return toPanelProduct(product);
  }

  /** Ejecuta en el contexto RLS que corresponde al actor. */
  private run<T>(
    actor: ProductActor,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return actor.tenantId
      ? this.tenantService.withTenant(actor.tenantId, fn)
      : this.tenantService.withPlatform(fn);
  }

  private tenantFilter(actor: ProductActor): Prisma.ProductWhereInput {
    return actor.tenantId ? { tenantId: actor.tenantId } : {};
  }

  private requireTenant(actor: ProductActor): string {
    if (!actor.tenantId) {
      throw new ApiProblemException(
        "FORBIDDEN",
        "El Super Admin solo puede consultar productos.",
      );
    }
    return actor.tenantId;
  }

  /**
   * Filtro de propiedad del proveedor: devuelve su `provider_id` o `null`
   * para owner/admin (ven toda la agencia). Un usuario con rol provider sin
   * registro de proveedor no puede operar sobre productos.
   */
  private async providerScope(
    tx: Prisma.TransactionClient,
    actor: ProductActor,
  ): Promise<string | null> {
    if (actor.membershipRole !== "provider") return null;
    const provider = await tx.provider.findFirst({
      where: { tenantId: actor.tenantId ?? undefined, userId: actor.userId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!provider) {
      throw new ApiProblemException(
        "FORBIDDEN",
        "Tu usuario no tiene un registro de proveedor en esta agencia.",
      );
    }
    return provider.id;
  }

  /**
   * Producto de la agencia del actor, sin borrado lógico. En contexto de
   * plataforma no se filtra agencia (el Super Admin puede leer cualquiera);
   * en contexto tenant el filtro explícito convierte un producto de otra
   * agencia en 404. El proveedor solo alcanza los de su registro y un producto
   * ajeno también responde 404, sin revelar a quién pertenece.
   */
  private async findProduct(
    tx: Prisma.TransactionClient,
    actor: ProductActor,
    id: string,
  ): Promise<ProductWithDestination> {
    const product = await tx.product.findFirst({
      where: { ...this.tenantFilter(actor), id, deletedAt: null },
      include: { destination: true },
    });
    if (!product) throw notFound();

    const providerId = await this.providerScope(tx, actor);
    if (providerId !== null && product.providerId !== providerId) {
      // Mismo cuerpo que una agencia ajena: el 403 revelaría la propiedad.
      throw notFound();
    }
    return product;
  }

  /** Resuelve el proveedor del alta según el rol del actor. */
  private async resolveCreateProvider(
    tx: Prisma.TransactionClient,
    actor: ProductActor,
    requested: string | undefined,
  ): Promise<string> {
    const tenantId = this.requireTenant(actor);

    if (actor.membershipRole === "provider") {
      const own = await this.providerScope(tx, actor);
      if (!own) throw notFound();
      if (requested !== undefined && requested !== own) {
        throw new ApiProblemException(
          "FORBIDDEN",
          "Solo puedes crear productos en tu registro de proveedor.",
        );
      }
      return own;
    }

    if (requested === undefined) {
      throw validationError("providerId", "El proveedor es obligatorio");
    }
    const provider = await tx.provider.findFirst({
      where: { id: requested, tenantId },
      select: { id: true },
    });
    if (!provider) {
      throw validationError("providerId", "El proveedor no existe en la agencia");
    }
    return provider.id;
  }

  private async assertDestination(
    tx: Prisma.TransactionClient,
    tenantId: string,
    destinationId: string,
  ): Promise<void> {
    const destination = await tx.destination.findFirst({
      where: { id: destinationId, tenantId },
      select: { id: true },
    });
    if (!destination) {
      throw validationError("destinationId", "El destino no existe en la agencia");
    }
  }

  private async assertCancellationPolicy(
    tx: Prisma.TransactionClient,
    tenantId: string,
    policyId: string | null,
  ): Promise<void> {
    if (policyId === null) return;
    const policy = await tx.cancellationPolicy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true },
    });
    if (!policy) {
      throw validationError(
        "cancellationPolicyId",
        "La política de cancelación no existe en la agencia",
      );
    }
  }
}

/** Texto i18n normalizado como JSON de Prisma (objeto plano). */
function localizedJson(value: LocalizedInput): Prisma.InputJsonValue {
  const normalized = normalizeLocalized(value);
  return { es: normalized.es, en: normalized.en };
}

function toPanelProduct(row: ProductWithDestination): PanelProduct {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    type: "hotel",
    hotelKey: row.hotelKey,
    roomType: row.roomType,
    title: toLocalized(row.title),
    description: toLocalized(row.description),
    destination: {
      id: row.destination.id,
      name: toLocalized(row.destination.name),
      country: row.destination.country,
      code: row.destination.code,
    },
    status: row.status,
    basePriceUsd: formatAmount(row.basePriceUsd),
    cancellationPolicyId: row.cancellationPolicyId,
    attributes: toAttributes(row.attributes),
    createdAt: formatTimestamp(row.createdAt),
    updatedAt: formatTimestamp(row.updatedAt),
  };
}

function notFound(): ApiProblemException {
  return new ApiProblemException("NOT_FOUND", "El recurso no existe.");
}

/** Fecha calendario de Caracas como DATE de Prisma (medianoche UTC). */
function nightDate(night: string): Date {
  return new Date(`${night}T00:00:00.000Z`);
}

function duplicatedNight(): ApiProblemException {
  return new ApiProblemException(
    "AVAILABILITY_DUPLICATED",
    "La noche ya está registrada para este producto.",
  );
}

function validationError(path: string, message: string): ApiProblemException {
  return new ApiProblemException("VALIDATION_ERROR", "La solicitud no es válida.", [
    { path, message },
  ]);
}
