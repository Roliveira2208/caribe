import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";
import { demoOrganization, demoUsers, seedDemo } from "../src/seed.js";

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

describe("seed de demostracion (T-F0-6b)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("una segunda corrida consecutiva no crea nada", async () => {
    await seedDemo();
    const first = await readState();
    const summary = await seedDemo();
    expect(summary.organizationCreated).toBe(false);
    expect(summary.createdUserEmails).toEqual([]);
    expect(summary.createdMembershipEmails).toEqual([]);
    // Mismos usuarios (mismos ids, ni recreacion ni duplicado) y mismas
    // membresias: la segunda corrida no toco nada.
    expect(await readState()).toEqual(first);
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
});
