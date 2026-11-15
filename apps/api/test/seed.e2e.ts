import { afterAll, describe, expect, it } from "vitest";
import { todayInCaracas } from "@caribe/shared";
import { prisma } from "../src/prisma.js";
import {
  demoCancellationPolicy,
  demoDestination,
  demoHotel,
  demoOrganization,
  demoProvider,
  demoUsers,
  seedDemo,
} from "../src/seed.js";

/**
 * E2E del seed de demostracion (T-F0-6b): idempotencia contra PostgreSQL real.
 * No asume una BD limpia (los datos fijos pueden existir de corridas
 * anteriores): la segunda corrida consecutiva debe ser un no-op completo y el
 * estado final debe ser el esperado sin importar el punto de partida.
 */
interface SeedState {
  users: Array<{ id: string; email: string; role: string | null }>;
  organization: {
    id: string;
    members: Array<{ userId: string; role: string; email: string }>;
  } | null;
}

async function readState(): Promise<SeedState> {
  const users = await prisma.user.findMany({
    where: { email: { in: demoUsers.map((user) => user.email) } },
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });
  const organization = await prisma.organization.findUnique({
    where: { slug: demoOrganization.slug },
    select: {
      id: true,
      members: { select: { userId: true, role: true, user: { select: { email: true } } } },
    },
  });
  return {
    users,
    organization:
      organization === null
        ? null
        : {
            id: organization.id,
            members: organization.members
              .map((member) => ({
                userId: member.userId,
                role: member.role,
                email: member.user.email,
              }))
              .sort((a, b) => a.email.localeCompare(b.email)),
          },
  };
}

/** Fecha de Caracas a medianoche UTC, igual que la usa el seed. */
function caracasNight(offsetDays: number): Date {
  return new Date(Date.parse(`${todayInCaracas()}T00:00:00Z`) + offsetDays * 24 * 60 * 60 * 1000);
}

interface InventoryState {
  provider: { name: string; userId: string | null } | null;
  destination: { code: string; country: string; name: unknown } | null;
  policy: { name: string; rules: unknown } | null;
  product: {
    id: string;
    hotelKey: string;
    roomType: string;
    status: string;
    basePriceUsd: string;
    attributes: unknown;
  } | null;
  availability: {
    nights: number;
    firstNight: Date | null;
    lastNight: Date | null;
    wrongRows: number;
  };
  globalRate: { source: string; rate: string } | null;
  paymentMode: string | null;
}

async function readInventory(): Promise<InventoryState> {
  const organization = await prisma.organization.findUnique({
    where: { slug: demoOrganization.slug },
    select: { id: true },
  });
  if (!organization) {
    return {
      provider: null,
      destination: null,
      policy: null,
      product: null,
      availability: { nights: 0, firstNight: null, lastNight: null, wrongRows: 0 },
      globalRate: null,
      paymentMode: null,
    };
  }
  const tenantId = organization.id;

  const [provider, destination, policy, product, settings, globalRate] = await Promise.all([
    prisma.provider.findFirst({
      where: { tenantId, name: demoProvider.name },
      select: { name: true, userId: true },
    }),
    prisma.destination.findFirst({
      where: { tenantId, code: demoDestination.code },
      select: { code: true, country: true, name: true },
    }),
    prisma.cancellationPolicy.findFirst({
      where: { tenantId, name: demoCancellationPolicy.name },
      select: { name: true, rules: true },
    }),
    prisma.product.findFirst({
      where: { tenantId, hotelKey: demoHotel.hotelKey, roomType: demoHotel.roomType },
      select: {
        id: true,
        hotelKey: true,
        roomType: true,
        status: true,
        basePriceUsd: true,
        attributes: true,
      },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { paymentMode: true },
    }),
    prisma.exchangeRate.findFirst({
      where: { tenantId: null, valueDate: caracasNight(0) },
      select: { source: true, rate: true },
    }),
  ]);

  let availability: InventoryState["availability"] = {
    nights: 0,
    firstNight: null,
    lastNight: null,
    wrongRows: 0,
  };
  if (product) {
    // El seed conserva las noches de corridas anteriores (no borra inventario),
    // así que se mira solo la ventana que la corrida de hoy debe garantizar.
    const window = {
      gte: caracasNight(0),
      lte: caracasNight(demoHotel.nights - 1),
    };
    const [aggregate, wrongRows] = await Promise.all([
      prisma.availability.aggregate({
        where: { productId: product.id, night: window },
        _count: { _all: true },
        _min: { night: true },
        _max: { night: true },
      }),
      prisma.availability.count({
        where: {
          productId: product.id,
          night: window,
          OR: [
            { capacity: { not: demoHotel.capacity } },
            { reserved: { not: 0 } },
            { priceUsd: { not: demoHotel.basePriceUsd } },
          ],
        },
      }),
    ]);
    availability = {
      nights: aggregate._count._all,
      firstNight: aggregate._min.night,
      lastNight: aggregate._max.night,
      wrongRows,
    };
  }

  return {
    provider,
    destination,
    policy,
    product:
      product === null
        ? null
        : { ...product, basePriceUsd: product.basePriceUsd.toFixed(2) },
    availability,
    globalRate:
      globalRate === null ? null : { source: globalRate.source, rate: globalRate.rate.toFixed(4) },
    paymentMode: settings?.paymentMode ?? null,
  };
}

describe("seed de demostracion (T-F0-6b)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una segunda corrida consecutiva no crea nada", async () => {
    await seedDemo();
    const first = await readState();
    const firstInventory = await readInventory();
    const summary = await seedDemo();
    expect(summary.organizationCreated).toBe(false);
    expect(summary.createdUserEmails).toEqual([]);
    expect(summary.createdMembershipEmails).toEqual([]);
    expect(summary.createdProvider).toBe(false);
    expect(summary.createdDestination).toBe(false);
    expect(summary.createdPolicy).toBe(false);
    expect(summary.createdProduct).toBe(false);
    expect(summary.createdAvailabilityNights).toBe(0);
    expect(summary.createdExchangeRate).toBe(false);
    expect(summary.createdTenantSettings).toBe(false);
    // Mismos usuarios (mismos ids, ni recreacion ni duplicado), mismas
    // membresias y mismo inventario: la segunda corrida no toco nada.
    expect(await readState()).toEqual(first);
    expect(await readInventory()).toEqual(firstInventory);
  });

  it("deja una agencia con un usuario por rol", async () => {
    await seedDemo(); // auto-suficiente: no depende del orden de los tests.
    const state = await readState();
    expect(state.users.map((user) => user.email)).toEqual(
      demoUsers.map((user) => user.email).sort(),
    );
    const userByEmail = new Map(state.users.map((user) => [user.email, user]));
    expect(userByEmail.get("cliente@caribe-demo.example.com")?.role).toBe("user");
    expect(userByEmail.get("superadmin@caribe-demo.example.com")?.role).toBe("super_admin");
    expect(state.organization).not.toBeNull();
    expect(state.organization?.members).toHaveLength(4);
    const memberRoleByEmail = new Map(
      state.organization?.members.map((member) => [member.email, member.role]),
    );
    expect(memberRoleByEmail.get("owner@caribe-demo.example.com")).toBe("owner");
    expect(memberRoleByEmail.get("admin@caribe-demo.example.com")).toBe("admin");
    expect(memberRoleByEmail.get("agent@caribe-demo.example.com")).toBe("agent");
    expect(memberRoleByEmail.get("provider@caribe-demo.example.com")).toBe("provider");
    // El Cliente y el Super Admin no son miembros de la agencia.
    expect(memberRoleByEmail.has("cliente@caribe-demo.example.com")).toBe(false);
    expect(memberRoleByEmail.has("superadmin@caribe-demo.example.com")).toBe(false);
  });

  it("deja el inventario de demostracion publicado, con disponibilidad, politica, tasa y pago manual", async () => {
    await seedDemo(); // auto-suficiente: no depende del orden de los tests.
    const inventory = await readInventory();

    expect(inventory.provider).toEqual({
      name: demoProvider.name,
      userId: expect.any(String),
    });
    expect(inventory.destination).toEqual({
      code: demoDestination.code,
      country: demoDestination.country,
      name: demoDestination.name,
    });
    expect(inventory.policy).toEqual({
      name: demoCancellationPolicy.name,
      rules: demoCancellationPolicy.rules,
    });
    expect(inventory.product).toMatchObject({
      hotelKey: demoHotel.hotelKey,
      roomType: demoHotel.roomType,
      status: "PUBLISHED",
      basePriceUsd: demoHotel.basePriceUsd,
      attributes: demoHotel.attributes,
    });

    // 60 noches consecutivas desde hoy en Caracas, todas con el mismo cupo,
    // sin reservas y al precio base.
    expect(inventory.availability.nights).toBe(demoHotel.nights);
    expect(inventory.availability.firstNight).toEqual(caracasNight(0));
    expect(inventory.availability.lastNight).toEqual(caracasNight(demoHotel.nights - 1));
    expect(inventory.availability.wrongRows).toBe(0);

    expect(inventory.globalRate).toEqual({
      source: "SEED",
      rate: "900.0000",
    });
    expect(inventory.paymentMode).toBe("MANUAL");
  });
});
