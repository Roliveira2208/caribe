import { randomUUID } from "node:crypto";
import { todayInCaracas } from "@caribe/shared";
import { auth } from "./auth.js";
import { prisma } from "./prisma.js";

/**
 * Seed de demostracion: una agencia y un usuario por rol (T-F0-6b) mas el
 * inventario basico de F1 (T-F1-1d): proveedor, destino, politica de
 * cancelacion, un tipo de habitacion publicado, su disponibilidad por noche,
 * una tasa global y los ajustes de la agencia en modo de pago manual.
 *
 * Es idempotente (correrlo de nuevo no duplica nada ni pisa cambios hechos
 * desde el panel) y usa las mismas vias que el sistema: usuarios por la API
 * de servidor de Better Auth, agencia como accion de sistema (userId, sin
 * sesion) y el resto por Prisma con busquedas por clave natural. Las tablas
 * de negocio llevan RLS, pero el seed conecta como rol de migraciones
 * (superusuario), exento de RLS, igual que las migraciones.
 *
 * La logica vive aqui y no en el CLI para que test/seed.e2e.ts la importe
 * y pruebe la idempotencia sin procesos ni consola.
 *
 * TODO(T-F0-8): owner/admin/superadmin necesitaran TOTP activo cuando el
 * segundo factor sea obligatorio; hoy nacen sin el y lo activan por la UI.
 */

/**
 * Contrasena fija de los usuarios de demostracion. Es un dato publico de
 * desarrollo, no un secreto: el seed es para la BD local y las credenciales
 * se imprimen al terminar (los secretos van solo a variables de entorno).
 */
export const DEMO_PASSWORD = "CaribeDemo123!";

export const demoOrganization = {
  name: "Agencia Caribe Demo",
  slug: "caribe-demo",
} as const;

interface DemoUser {
  email: string;
  name: string;
  /** Rol de agencia; null si el usuario no es miembro. */
  memberRole: "owner" | "admin" | "agent" | "provider" | null;
  /** Rol de sistema; null deja el "user" por defecto del plugin admin. */
  systemRole: "super_admin" | null;
}

/** Un usuario por rol: cuatro membresias en la agencia y dos usuarios sueltos. */
export const demoUsers: readonly DemoUser[] = [
  {
    email: "owner@caribe-demo.example.com",
    name: "Dueno de la agencia",
    memberRole: "owner",
    systemRole: null,
  },
  {
    email: "admin@caribe-demo.example.com",
    name: "Admin de la agencia",
    memberRole: "admin",
    systemRole: null,
  },
  { email: "agent@caribe-demo.example.com", name: "Agente", memberRole: "agent", systemRole: null },
  {
    email: "provider@caribe-demo.example.com",
    name: "Proveedor",
    memberRole: "provider",
    systemRole: null,
  },
  { email: "cliente@caribe-demo.example.com", name: "Cliente", memberRole: null, systemRole: null },
  {
    email: "superadmin@caribe-demo.example.com",
    name: "Super Admin",
    memberRole: null,
    systemRole: "super_admin",
  },
];

export interface SeedSummary {
  organizationCreated: boolean;
  /** Emails de usuarios creados en esta corrida. */
  createdUserEmails: string[];
  /** Emails de membresias creadas en esta corrida. */
  createdMembershipEmails: string[];
  /** Inventario de demostracion de F1. */
  createdProvider: boolean;
  createdDestination: boolean;
  createdPolicy: boolean;
  createdProduct: boolean;
  createdAvailabilityNights: number;
  createdExchangeRate: boolean;
  createdTenantSettings: boolean;
}

/**
 * Inventario de demostracion (T-F1-1d, design §2.2). Un solo hotel con un
 * tipo de habitacion publicado y 60 noches de disponibilidad a partir de hoy
 * en America/Caracas: suficiente para una estancia de hasta 30 noches.
 *
 * `hotel_key` es fijo para que la segunda corrida reconozca el producto; no
 * se usa como clave de base (no hay tabla `hotels` en F1). Las imagenes van
 * vacias porque la lista de dominios permitidos (`ALLOWED_IMAGE_HOSTS`) se
 * configura en T-F1-4; el esquema admite el arreglo vacio.
 */
export const demoProvider = {
  name: "Hotelera Caribe Demo",
  contact: "reservas@caribe-demo.example.com",
};

export const demoDestination = {
  name: { es: "Isla de Margarita", en: "Margarita Island" },
  country: "VE",
  code: "PMV",
};

export const demoCancellationPolicy = {
  name: "Cancelacion flexible",
  rules: [
    { hours_before: 72, percentage: 100 },
    { hours_before: 24, percentage: 50 },
  ],
};

export const demoHotel = {
  hotelKey: "6f1c1a2e-6a8b-4c1e-9f2a-1b2c3d4e5f60",
  roomType: "standard",
  title: { es: "Habitacion estandar", en: "Standard room" },
  description: {
    es: "Habitacion doble con vista al mar en la Isla de Margarita.",
    en: "Double room with ocean view on Margarita Island.",
  },
  basePriceUsd: "120.00",
  capacity: 5,
  /** Noches de disponibilidad desde hoy (cubre la estancia maxima de 30). */
  nights: 60,
  attributes: {
    stars: 4,
    maxGuests: 2,
    amenities: ["wifi", "piscina", "desayuno"],
    images: [] as string[],
  },
};

/** Tasa global de demostracion (USD -> VES) si no hay una para hoy. */
export const demoExchangeRate = {
  source: "SEED",
  rate: "900.0000",
};

/** La agencia de demostracion nace en modo de pago manual (design §2.7). */
export const demoPaymentMode = "MANUAL" as const;

/**
 * Crea (o completa) los datos de demostracion. Cada entidad se busca antes
 * de crearse, asi que la segunda corrida consecutiva es un no-op completo.
 */
export async function seedDemo(): Promise<SeedSummary> {
  const summary: SeedSummary = {
    organizationCreated: false,
    createdUserEmails: [],
    createdMembershipEmails: [],
    createdProvider: false,
    createdDestination: false,
    createdPolicy: false,
    createdProduct: false,
    createdAvailabilityNights: 0,
    createdExchangeRate: false,
    createdTenantSettings: false,
  };

  // Usuarios. El alta va por la API de servidor de Better Auth, la misma via
  // que usan los tests e2e: el HTTP de registro tiene rate limit por IP y
  // crear datos de demostracion no es su caso de uso. signUpEmail rechaza
  // emails duplicados, por eso se busca primero.
  const userIdByEmail = new Map<string, string>();
  for (const user of demoUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });
    if (existing) {
      userIdByEmail.set(user.email, existing.id);
      continue;
    }
    const { user: created } = await auth.api.signUpEmail({
      body: { name: user.name, email: user.email, password: DEMO_PASSWORD },
    });
    userIdByEmail.set(user.email, created.id);
    summary.createdUserEmails.push(user.email);
  }

  const userIdOf = (email: string): string => {
    const id = userIdByEmail.get(email);
    if (!id) throw new Error(`El seed no encontro al usuario ${email}`);
    return id;
  };

  // Rol de plataforma del Super Admin, por update directo: no hay endpoint
  // de servidor para cambiar roles y el seed actua como sistema. El resto
  // nacio como "user" (defaultRole del plugin admin).
  for (const user of demoUsers) {
    if (user.systemRole) {
      await prisma.user.update({
        where: { email: user.email },
        data: { role: user.systemRole },
      });
    }
  }

  // Agencia como accion de sistema: sin sesion y con userId, la unica via
  // que queda con allowUserToCreateOrganization: false. El owner queda de
  // miembro owner al crearse (creatorRole); el bucle de membresias tambien
  // lo cubre por si la agencia preexistia sin su membresia.
  const existingOrganization = await prisma.organization.findUnique({
    where: { slug: demoOrganization.slug },
    select: { id: true },
  });
  let organizationId: string;
  if (existingOrganization) {
    organizationId = existingOrganization.id;
  } else {
    const owner = demoUsers.find((user) => user.memberRole === "owner");
    if (!owner) throw new Error("El seed define un usuario owner de la agencia");
    const organization = await auth.api.createOrganization({
      body: {
        name: demoOrganization.name,
        slug: demoOrganization.slug,
        userId: userIdOf(owner.email),
      },
    });
    organizationId = organization.id;
    summary.organizationCreated = true;
  }

  // Membresias de agencia por Prisma: no hay endpoint de servidor para
  // anadirlas y el flujo de invitacion (email) se prueba en auth.e2e.ts.
  for (const user of demoUsers) {
    if (!user.memberRole) continue;
    const userId = userIdOf(user.email);
    const membership = await prisma.member.findFirst({
      where: { organizationId, userId },
      select: { id: true },
    });
    if (membership) continue;
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId,
        role: user.memberRole,
        createdAt: new Date(),
      },
    });
    summary.createdMembershipEmails.push(user.email);
  }

  // --- Inventario de demostracion (T-F1-1d) --------------------------------
  // Se busca por clave natural antes de crear para que la segunda corrida sea
  // un no-op y no pise lo que el panel haya cambiado.
  const today = todayInCaracas();
  const caracasNight = (offsetDays: number): Date =>
    new Date(Date.parse(`${today}T00:00:00Z`) + offsetDays * 24 * 60 * 60 * 1000);

  let provider = await prisma.provider.findFirst({
    where: { tenantId: organizationId, name: demoProvider.name },
    select: { id: true },
  });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        id: randomUUID(),
        tenantId: organizationId,
        userId: userIdOf("provider@caribe-demo.example.com"),
        name: demoProvider.name,
        contact: demoProvider.contact,
      },
      select: { id: true },
    });
    summary.createdProvider = true;
  }

  let destination = await prisma.destination.findFirst({
    where: { tenantId: organizationId, code: demoDestination.code },
    select: { id: true },
  });
  if (!destination) {
    destination = await prisma.destination.create({
      data: {
        id: randomUUID(),
        tenantId: organizationId,
        name: demoDestination.name,
        country: demoDestination.country,
        code: demoDestination.code,
      },
      select: { id: true },
    });
    summary.createdDestination = true;
  }

  let policy = await prisma.cancellationPolicy.findFirst({
    where: { tenantId: organizationId, name: demoCancellationPolicy.name },
    select: { id: true },
  });
  if (!policy) {
    policy = await prisma.cancellationPolicy.create({
      data: {
        id: randomUUID(),
        tenantId: organizationId,
        name: demoCancellationPolicy.name,
        rules: demoCancellationPolicy.rules,
      },
      select: { id: true },
    });
    summary.createdPolicy = true;
  }

  let product = await prisma.product.findFirst({
    where: {
      tenantId: organizationId,
      hotelKey: demoHotel.hotelKey,
      roomType: demoHotel.roomType,
    },
    select: { id: true },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        id: randomUUID(),
        tenantId: organizationId,
        providerId: provider.id,
        type: "HOTEL",
        hotelKey: demoHotel.hotelKey,
        roomType: demoHotel.roomType,
        title: demoHotel.title,
        description: demoHotel.description,
        destinationId: destination.id,
        status: "PUBLISHED",
        basePriceUsd: demoHotel.basePriceUsd,
        cancellationPolicyId: policy.id,
        source: "OWN",
        attributes: demoHotel.attributes,
      },
      select: { id: true },
    });
    summary.createdProduct = true;
  }

  for (let offset = 0; offset < demoHotel.nights; offset += 1) {
    const night = caracasNight(offset);
    const existingNight = await prisma.availability.findUnique({
      where: { productId_night: { productId: product.id, night } },
      select: { id: true },
    });
    if (existingNight) continue;
    await prisma.availability.create({
      data: {
        id: randomUUID(),
        tenantId: organizationId,
        productId: product.id,
        night,
        capacity: demoHotel.capacity,
        reserved: 0,
        priceUsd: demoHotel.basePriceUsd,
      },
    });
    summary.createdAvailabilityNights += 1;
  }

  const valueDate = caracasNight(0);
  const globalRate = await prisma.exchangeRate.findFirst({
    where: { tenantId: null, valueDate },
    select: { id: true },
  });
  if (!globalRate) {
    await prisma.exchangeRate.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        source: demoExchangeRate.source,
        rate: demoExchangeRate.rate,
        valueDate,
        fetchedAt: new Date(),
        isOverride: false,
      },
    });
    summary.createdExchangeRate = true;
  }

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: organizationId },
    select: { tenantId: true },
  });
  if (!settings) {
    await prisma.tenantSettings.create({
      data: { tenantId: organizationId, paymentMode: demoPaymentMode },
    });
    summary.createdTenantSettings = true;
  }

  return summary;
}
