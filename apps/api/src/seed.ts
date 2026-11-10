import { randomUUID } from "node:crypto";
import { auth } from "./auth.js";
import { prisma } from "./prisma.js";

/**
 * Seed de demostracion (T-F0-6b): una agencia y un usuario por rol. Es
 * idempotente (correrlo de nuevo no duplica nada) y usa las mismas vias que
 * el sistema: usuarios por la API de servidor de Better Auth, agencia como
 * accion de sistema (userId, sin sesion) y membresias directas en BD (id y
 * createdAt no tienen default en el modelo: Better Auth los genera en la
 * capa de aplicacion y aqui se aportan a mano, misma leccion que el e2e).
 *
 * La logica vive aqui y no en el CLI para que test/seed.e2e.ts la importe
 * y pruebe la idempotencia sin procesos ni consola.
 *
 * TODO(F1): inventario basico cuando exista la tabla de catalogo
 * (specs/catalog); F0 no tiene tablas de negocio (decision del dueno,
 * anotada como pregunta abierta en la propuesta).
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
}

/**
 * Crea (o completa) los datos de demostracion. Cada entidad se busca antes
 * de crearse, asi que la segunda corrida consecutiva es un no-op completo.
 */
export async function seedDemo(): Promise<SeedSummary> {
  const summary: SeedSummary = {
    organizationCreated: false,
    createdUserEmails: [],
    createdMembershipEmails: [],
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

  return summary;
}
