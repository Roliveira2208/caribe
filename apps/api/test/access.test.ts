import { describe, expect, it } from "vitest";
import type { Role } from "better-auth/plugins/access";
import {
  accessControl,
  adminRole,
  agentRole,
  memberRole,
  ownerRole,
  providerRole,
  superAdminRole,
  systemUserRole,
} from "../src/access.js";

/**
 * Matriz rol × permiso (T-F0-6): cada celda del universo de permisos se
 * comprueba contra cada rol. `allows` es la matriz aprobada por el dueño; un
 * permiso concedido o denegado fuera de ella falla aqui, y una accion mal
 * escrita en la tabla deja de coincidir y tambien falla.
 */

type AllStatements = typeof accessControl.statements;
type Resource = keyof AllStatements & string;
type AllActions = AllStatements[Resource][number];
type ExpectedMatrix = Partial<Record<Resource, AllActions[]>>;

interface RoleExpectation {
  name: string;
  role: Role;
  allows: ExpectedMatrix;
}

const expectations: RoleExpectation[] = [
  { name: "sistema: user (Cliente)", role: systemUserRole, allows: {} },
  {
    name: "sistema: super_admin",
    role: superAdminRole,
    allows: {
      organization: ["create", "read", "update"],
      user: ["create", "list", "get", "update", "set-role", "ban", "set-password"],
      session: ["list", "revoke"],
      product: ["read"],
      booking: ["read"],
      payment: ["read"],
      "exchange-rate": ["read"],
      report: ["read"],
      audit: ["read"],
    },
  },
  {
    name: "agencia: owner",
    role: ownerRole,
    allows: {
      product: ["create", "read", "update", "delete"],
      booking: ["create", "read", "update", "cancel"],
      payment: ["read", "review"],
      "exchange-rate": ["read", "update"],
      report: ["read"],
      audit: ["read"],
      organization: ["update", "delete"],
      member: ["create", "update", "delete"],
      invitation: ["create", "cancel"],
    },
  },
  {
    name: "agencia: admin",
    role: adminRole,
    allows: {
      product: ["create", "read", "update", "delete"],
      booking: ["create", "read", "update", "cancel"],
      payment: ["read", "review"],
      "exchange-rate": ["read", "update"],
      report: ["read"],
      audit: ["read"],
      organization: ["update"],
      member: ["create", "update", "delete"],
      invitation: ["create", "cancel"],
    },
  },
  {
    name: "agencia: agent",
    role: agentRole,
    allows: { booking: ["create", "read"], payment: ["read"] },
  },
  {
    name: "agencia: provider",
    role: providerRole,
    allows: { product: ["create", "read", "update", "delete"], booking: ["read"] },
  },
  { name: "agencia: member (default neutralizado)", role: memberRole, allows: {} },
];

describe("matriz rol × permiso (T-F0-6)", () => {
  for (const { name, role, allows } of expectations) {
    it(name, () => {
      const mismatches: string[] = [];
      for (const [resource, actions] of Object.entries(accessControl.statements)) {
        for (const action of actions) {
          const expected = allows[resource as Resource]?.includes(action) ?? false;
          const granted = role.authorize({ [resource]: [action] }).success;
          if (granted !== expected) mismatches.push(`${action} ${resource}`);
        }
      }
      expect(
        mismatches,
        `permisos que no coinciden con la matriz: ${mismatches.join(", ")}`,
      ).toEqual([]);
    });
  }
});
