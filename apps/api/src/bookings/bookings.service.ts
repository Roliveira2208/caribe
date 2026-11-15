import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  formatAmount,
  formatTimestamp,
  formatValueDate,
  type DecimalValue,
} from "@caribe/shared";
import { AuditService } from "../audit/audit.service.js";
import { toLocalized } from "../catalog/catalog.mappers.js";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import { Prisma } from "../generated/prisma/client.js";
import { TENANT_SETTINGS_DEFAULTS } from "../tenant-settings/tenant-settings.schemas.js";
import { TenantService } from "../tenant/tenant.service.js";
import {
  generateBookingCode,
  withCodeRetry,
} from "./booking-code.js";
import { decodeBookingsCursor, encodeBookingsCursor } from "./bookings.cursor.js";
import {
  BOOKINGS_CREATE_ENDPOINT,
  BOOKINGS_DEFAULT_LIMIT,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_TTL_MS,
  hashBookingRequest,
  parseStoredBookingResponse,
  type BookingDetailResponse,
  type BookingItemResponse,
  type BookingNightPrice,
  type BookingPage,
  type BookingStatusValue,
  type BookingSummaryResponse,
  type CreateBookingBody,
  type ListBookingsQuery,
} from "./bookings.schemas.js";

/** Producto visible en el catalogo publico: solo necesitamos su agencia. */
interface PublicProductRow {
  id: string;
  tenant_id: string;
}

/** Noche de disponibilidad bloqueada con `FOR UPDATE`. */
interface LockedNightRow {
  id: string;
  night: string;
  capacity: number;
  reserved: number;
  price_usd: DecimalValue;
}

/** Resultado de reclamar una `Idempotency-Key`. */
type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "replay"; bookingId: string }
  | { kind: "reused" }
  | { kind: "in-progress" };

/** Datos que necesita una transaccion de reserva. */
interface ReserveParams {
  userId: string;
  key: string;
  body: CreateBookingBody;
  tenantId: string;
  productId: string;
  code: string;
  ip: string | null;
}

/**
 * Creacion de reservas (T-F1-7, specs/booking "Retencion de cupo sin
 * sobreventa", "Idempotencia", "Codigo de reserva" y "Auditoria de reservas").
 *
 * La agencia se resuelve desde el producto y no desde la sesion: un cliente sin
 * agencia activa puede reservar. La lectura del producto corre en el contexto
 * RLS `public` (solo publicados y sin borrado logico); un producto no visible
 * responde 409 `PRODUCT_INACTIVE` sin revelar si existe. La reserva corre en
 * `tenant`+`owner` para escribir `bookings`, `booking_items` y la clave de
 * idempotencia (que solo es visible para su usuario).
 *
 * El orden de bloqueo es el de la spec: primero las noches de `availability`
 * con `FOR UPDATE` en orden ascendente de `night`, luego el incremento de
 * `reserved` y la insercion de la reserva y su linea. La auditoria se escribe
 * en la MISMA transaccion: si falla, la reserva no se confirma.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly auditService: AuditService,
  ) {}

  async create(input: {
    userId: string;
    idempotencyKey: string | undefined;
    body: CreateBookingBody;
    ip: string | null;
  }): Promise<BookingDetailResponse> {
    const key = requireIdempotencyKey(input.idempotencyKey);
    const requestHash = hashBookingRequest(input.body);
    const claim = await this.claimKey(input.userId, key, requestHash);

    if (claim.kind === "reused") {
      throw new ApiProblemException(
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya se usó con otro cuerpo.",
      );
    }
    if (claim.kind === "in-progress") {
      throw new ApiProblemException(
        "IDEMPOTENCY_KEY_IN_PROGRESS",
        "La solicitud con esta clave de idempotencia sigue en curso.",
      );
    }
    if (claim.kind === "replay") {
      // Reintento identico: se reconstruye el detalle ya creado. La respuesta
      // guardada es minima ({ id, code }); no se duplica la reserva ni la
      // auditoria.
      return this.detailForUser(input.userId, claim.bookingId);
    }

    try {
      const product = await this.publicProduct(input.body.productId);
      return await withCodeRetry(generateBookingCode, (code) =>
        this.createAttempt({
          userId: input.userId,
          key,
          body: input.body,
          tenantId: product.tenant_id,
          productId: product.id,
          code,
          ip: input.ip,
        }),
      );
    } catch (error) {
      // Una solicitud fallida no deja la clave atrapada en vuelo: el cliente
      // puede reintentar con la misma clave.
      await this.releaseKey(input.userId, key).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Intenta reservar con un codigo. Una colision de codigo devuelve `null`
   * para que `withCodeRetry` repita la transaccion completa con otro codigo;
   * el rollback deshace el incremento de cupo de la tentativa fallida.
   */
  private async createAttempt(params: ReserveParams): Promise<BookingDetailResponse | null> {
    try {
      return await this.tenantService.withOwnerTenant(params.userId, params.tenantId, (tx) =>
        this.reserve(tx, params),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** Una transaccion completa de reserva con el codigo ya elegido. */
  private async reserve(
    tx: Prisma.TransactionClient,
    params: ReserveParams,
  ): Promise<BookingDetailResponse> {
    const product = await tx.product.findFirst({
      where: {
        id: params.productId,
        tenantId: params.tenantId,
        status: "PUBLISHED",
        deletedAt: null,
      },
      select: {
        id: true,
        hotelKey: true,
        roomType: true,
        title: true,
        cancellationPolicyId: true,
      },
    });
    // El producto pudo despublicarse entre la lectura publica y este bloqueo.
    if (!product) {
      throw new ApiProblemException(
        "PRODUCT_INACTIVE",
        "El producto no está disponible para reservar.",
      );
    }

    const policy = product.cancellationPolicyId
      ? await tx.cancellationPolicy.findFirst({
          where: { id: product.cancellationPolicyId, tenantId: params.tenantId },
          select: { id: true, name: true, rules: true },
        })
      : null;
    const policySnapshot = policy
      ? { policyId: policy.id, name: policy.name, rules: policy.rules }
      : { policyId: null, name: null, rules: [] };

    const settings = await tx.tenantSettings.findUnique({
      where: { tenantId: params.tenantId },
      select: { holdMinutes: true },
    });
    const holdMinutes = settings?.holdMinutes ?? TENANT_SETTINGS_DEFAULTS.holdMinutes;

    const nights = await tx.$queryRaw<LockedNightRow[]>(Prisma.sql`
      SELECT "id" AS id,
             "night"::text AS night,
             "capacity" AS capacity,
             "reserved" AS reserved,
             "price_usd" AS price_usd
        FROM "availability"
       WHERE "product_id" = ${params.productId}
         AND "tenant_id" = ${params.tenantId}
         AND "night" >= ${params.body.checkIn}::date
         AND "night" < ${params.body.checkOut}::date
       ORDER BY "night" ASC
       FOR UPDATE
    `);

    if (nights.length !== nightsBetween(params.body.checkIn, params.body.checkOut)) {
      throw new ApiProblemException(
        "AVAILABILITY_UNAVAILABLE",
        "No hay disponibilidad para todas las noches de la estancia.",
      );
    }
    if (nights.some((night) => night.reserved + params.body.quantity > night.capacity)) {
      throw new ApiProblemException(
        "AVAILABILITY_EXHAUSTED",
        "No hay cupo suficiente en una de las noches de la estancia.",
      );
    }

    let total = new Prisma.Decimal(0);
    const nightlyPrices = nights.map((night) => {
      const price = new Prisma.Decimal(night.price_usd.toString());
      total = total.plus(price.times(params.body.quantity));
      return { night: formatValueDate(night.night), price_usd: formatAmount(price) };
    });
    const totalUsd = total.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

    await tx.availability.updateMany({
      where: { id: { in: nights.map((night) => night.id) } },
      data: { reserved: { increment: params.body.quantity } },
    });

    const bookingId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + holdMinutes * 60_000);
    const title = toLocalized(product.title);

    await tx.booking.create({
      data: {
        id: bookingId,
        tenantId: params.tenantId,
        code: params.code,
        userId: params.userId,
        status: "PENDING_PAYMENT",
        totalUsd: new Prisma.Decimal(totalUsd),
        travelers: params.body.travelers as unknown as Prisma.InputJsonValue,
        expiresAt,
        createdAt,
      },
    });

    await tx.bookingItem.create({
      data: {
        id: randomUUID(),
        bookingId,
        tenantId: params.tenantId,
        productId: product.id,
        hotelKey: product.hotelKey,
        roomType: product.roomType,
        checkIn: toDateOnly(params.body.checkIn),
        checkOut: toDateOnly(params.body.checkOut),
        quantity: params.body.quantity,
        nightlyPrices: nightlyPrices as unknown as Prisma.InputJsonValue,
        subtotalUsd: new Prisma.Decimal(totalUsd),
        productTitle: title as unknown as Prisma.InputJsonValue,
        policySnapshot: policySnapshot as unknown as Prisma.InputJsonValue,
      },
    });

    await this.auditService.record(tx, {
      tenantId: params.tenantId,
      actorId: params.userId,
      action: "booking.create",
      entity: "booking",
      entityId: bookingId,
      before: null,
      after: {
        code: params.code,
        status: "PENDING_PAYMENT",
        totalUsd,
        tenantId: params.tenantId,
      },
      ip: params.ip,
    });

    // La respuesta guardada es minima: solo id y codigo, nunca viajeros ni
    // datos de pago (spec booking, "Respuesta guardada minima").
    await tx.idempotencyKey.update({
      where: {
        userId_endpoint_key: {
          userId: params.userId,
          endpoint: BOOKINGS_CREATE_ENDPOINT,
          key: params.key,
        },
      },
      data: { responseStatus: 201, responseBody: { id: bookingId, code: params.code } },
    });

    return {
      id: bookingId,
      code: params.code,
      status: "PENDING_PAYMENT",
      expiresAt: formatTimestamp(expiresAt),
      totalUsd,
      items: [
        {
          productId: product.id,
          hotelKey: product.hotelKey,
          roomType: product.roomType,
          title,
          checkIn: params.body.checkIn,
          checkOut: params.body.checkOut,
          quantity: params.body.quantity,
          nightlyPrices: nightlyPrices.map((night) => ({
            night: night.night,
            priceUsd: night.price_usd,
          })),
          subtotalUsd: totalUsd,
        },
      ],
    };
  }

  /** Producto publicado y sin borrado logico, leido en el contexto publico. */
  private async publicProduct(productId: string): Promise<PublicProductRow> {
    const rows = await this.tenantService.withPublic((tx) =>
      tx.$queryRaw<PublicProductRow[]>(Prisma.sql`
        SELECT p."id" AS id, p."tenant_id" AS tenant_id
          FROM "products" p
         WHERE p."id" = ${productId}
           AND p."status" = 'PUBLISHED'
           AND p."deleted_at" IS NULL
         LIMIT 1
      `),
    );
    const product = rows[0];
    if (!product) {
      throw new ApiProblemException(
        "PRODUCT_INACTIVE",
        "El producto no está disponible para reservar.",
      );
    }
    return product;
  }

  /**
   * Reclama la clave en una transaccion propia (commit antes de procesar). Una
   * clave vencida se descarta y se reutiliza; una clave viva con otro cuerpo es
   * 409 `IDEMPOTENCY_KEY_REUSED`; con el mismo cuerpo y sin respuesta es 409
   * `IDEMPOTENCY_KEY_IN_PROGRESS`; con respuesta guardada es un reintento.
   *
   * El `create` que choca con el unico no se captura dentro de su transaccion:
   * PostgreSQL la deja abortada. Se captura fuera y se consulta la fila en otra
   * transaccion.
   */
  private async claimKey(
    userId: string,
    key: string,
    requestHash: string,
    attempt = 0,
  ): Promise<ClaimOutcome> {
    const now = new Date();
    try {
      await this.tenantService.withOwner(userId, async (tx) => {
        await tx.idempotencyKey.deleteMany({
          where: { userId, endpoint: BOOKINGS_CREATE_ENDPOINT, key, expiresAt: { lte: now } },
        });
        await tx.idempotencyKey.create({
          data: {
            id: randomUUID(),
            userId,
            endpoint: BOOKINGS_CREATE_ENDPOINT,
            key,
            requestHash,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_TTL_MS),
          },
        });
      });
      return { kind: "claimed" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await this.tenantService.withOwner(userId, (tx) =>
      tx.idempotencyKey.findUnique({
        where: {
          userId_endpoint_key: {
            userId,
            endpoint: BOOKINGS_CREATE_ENDPOINT,
            key,
          },
        },
      }),
    );

    // La fila que provoco el conflicto desaparecio (purga concurrente): un
    // reintento acotado vuelve a reclamar.
    if (!existing) {
      if (attempt < 1) return this.claimKey(userId, key, requestHash, attempt + 1);
      return { kind: "in-progress" };
    }

    // Una clave vencida se puede reutilizar como solicitud nueva.
    if (existing.expiresAt.getTime() <= now.getTime()) {
      if (attempt < 1) {
        await this.tenantService.withOwner(userId, (tx) =>
          tx.idempotencyKey.deleteMany({
            where: {
              userId,
              endpoint: BOOKINGS_CREATE_ENDPOINT,
              key,
              expiresAt: { lte: new Date() },
            },
          }),
        );
        return this.claimKey(userId, key, requestHash, attempt + 1);
      }
      return { kind: "in-progress" };
    }

    if (existing.requestHash !== requestHash) return { kind: "reused" };

    const stored = parseStoredBookingResponse(existing.responseBody);
    if (!stored) return { kind: "in-progress" };
    return { kind: "replay", bookingId: stored.id };
  }

  /** Libera una clave reclamada cuya reserva no llego a confirmarse. */
  private async releaseKey(userId: string, key: string): Promise<void> {
    await this.tenantService.withOwner(userId, (tx) =>
      tx.idempotencyKey.deleteMany({
        where: { userId, endpoint: BOOKINGS_CREATE_ENDPOINT, key },
      }),
    );
  }

  /** Detalle de una reserva propia (reintento idempotente). */
  private async detailForUser(userId: string, bookingId: string): Promise<BookingDetailResponse> {
    return this.detail({ userId, activeOrganizationId: null, bookingId });
  }

  /**
   * Detalle de una reserva (T-F1-7b, spec booking "Consulta y propiedad").
   *
   * El dueño la lee sin agencia activa; el personal de una agencia la lee con
   * su agencia activa. La consulta corre en `owner`+`tenant` cuando hay agencia
   * (la política RLS combinada deja ver la fila por dueño o por agencia) y en
   * `owner` cuando no la hay. Una reserva ajena responde 404, nunca 403.
   */
  async detail(input: {
    userId: string;
    activeOrganizationId: string | null;
    bookingId: string;
  }): Promise<BookingDetailResponse> {
    const activeOrganizationId = input.activeOrganizationId;
    const booking = activeOrganizationId
      ? await this.tenantService.withOwnerTenant(input.userId, activeOrganizationId, (tx) =>
          tx.booking.findFirst({
            where: {
              id: input.bookingId,
              OR: [{ userId: input.userId }, { tenantId: activeOrganizationId }],
            },
            include: { items: true },
          }),
        )
      : await this.tenantService.withOwner(input.userId, (tx) =>
          tx.booking.findFirst({
            where: { id: input.bookingId, userId: input.userId },
            include: { items: true },
          }),
        );
    if (!booking) {
      throw new ApiProblemException("NOT_FOUND", "La reserva no existe.");
    }
    return toBookingDetail(booking);
  }

  /**
   * "Mis reservas" (T-F1-7b): las del usuario en todas las agencias cuando no
   * hay agencia activa, o las de su agencia activa cuando la hay (panel). El
   * orden es `created_at DESC, id DESC` y la paginación por cursor opaco.
   */
  async list(input: {
    userId: string;
    activeOrganizationId: string | null;
    query: ListBookingsQuery;
  }): Promise<BookingPage> {
    const limit = input.query.limit ?? BOOKINGS_DEFAULT_LIMIT;
    const cursor = input.query.cursor ? decodeBookingsCursor(input.query.cursor) : null;
    const where: Prisma.BookingWhereInput = {
      ...(input.query.status ? { status: input.query.status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
      ...(input.activeOrganizationId
        ? { tenantId: input.activeOrganizationId }
        : { userId: input.userId }),
    };

    const rows = input.activeOrganizationId
      ? await this.tenantService.withTenant(input.activeOrganizationId, (tx) =>
          tx.booking.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
          }),
        )
      : await this.tenantService.withOwner(input.userId, (tx) =>
          tx.booking.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
          }),
        );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toBookingSummary),
      nextCursor:
        rows.length > limit && last
          ? encodeBookingsCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}

/** Valida y normaliza el encabezado `Idempotency-Key`. */
function requireIdempotencyKey(raw: string | undefined): string {
  const key = raw?.trim() ?? "";
  if (key.length === 0) {
    throw new ApiProblemException(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Falta el encabezado Idempotency-Key.",
    );
  }
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiProblemException(
      "VALIDATION_ERROR",
      "La clave de idempotencia no es válida.",
      [
        {
          path: "Idempotency-Key",
          message: `La clave debe tener entre ${IDEMPOTENCY_KEY_MIN_LENGTH} y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres`,
        },
      ],
    );
  }
  return key;
}

/** P2002: choque con un indice unico. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Noches de `[checkIn, checkOut)` como fechas calendario. */
function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOut}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Fecha calendario YYYY-MM-DD a la medianoche UTC que espera una columna DATE. */
function toDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Fila de reserva con sus líneas, tal como la devuelve Prisma. */
interface BookingRowWithItems {
  id: string;
  code: string;
  status: BookingStatusValue;
  expiresAt: Date;
  totalUsd: DecimalValue;
  items: Parameters<typeof toBookingItem>[0][];
}

/** Detalle completo de una reserva leída de la base. */
function toBookingDetail(booking: BookingRowWithItems): BookingDetailResponse {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    expiresAt: formatTimestamp(booking.expiresAt),
    totalUsd: formatAmount(booking.totalUsd),
    items: booking.items.map(toBookingItem),
  };
}

/** Fila del listado "Mis reservas". */
function toBookingSummary(booking: {
  id: string;
  code: string;
  status: BookingStatusValue;
  expiresAt: Date;
  totalUsd: DecimalValue;
  createdAt: Date;
}): BookingSummaryResponse {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    expiresAt: formatTimestamp(booking.expiresAt),
    totalUsd: formatAmount(booking.totalUsd),
    createdAt: formatTimestamp(booking.createdAt),
  };
}

/** Linea de reserva con los precios congelados al crear. */
function toBookingItem(item: {
  productId: string;
  hotelKey: string;
  roomType: string;
  productTitle: unknown;
  checkIn: Date;
  checkOut: Date;
  quantity: number;
  nightlyPrices: unknown;
  subtotalUsd: DecimalValue;
}): BookingItemResponse {
  return {
    productId: item.productId,
    hotelKey: item.hotelKey,
    roomType: item.roomType,
    title: toLocalized(item.productTitle),
    checkIn: formatValueDate(item.checkIn),
    checkOut: formatValueDate(item.checkOut),
    quantity: item.quantity,
    nightlyPrices: toNightlyPrices(item.nightlyPrices),
    subtotalUsd: formatAmount(item.subtotalUsd),
  };
}

/** `nightly_prices` JSONB `[{ night, price_usd }]` a la respuesta camelCase. */
function toNightlyPrices(value: unknown): BookingNightPrice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const night = record["night"];
    const price = record["price_usd"];
    if (typeof night !== "string") return [];
    if (typeof price !== "string" && typeof price !== "number") return [];
    return [{ night, priceUsd: formatAmount(price) }];
  });
}
