import { AuthApiError } from "@caribe/shared";

/**
 * Cliente de usuarios y roles (T-F2-21). Solo llama a rutas ya existentes de
 * Better Auth: no añade plugins, tokens ni endpoints propios. La organización
 * objetivo se elige entre las membresías del actor y el token de sesión viaja
 * solo en el cuerpo de la revocación, nunca en la URL ni en texto visible.
 */

export type UsersMode = "agency" | "platform";

export interface UsersPanelAccess {
  visible: boolean;
  canRead: boolean;
  canInvite: boolean;
  canChangeRole: boolean;
  canRevokeSession: boolean;
  scope: UsersMode;
}

/** Matriz de la UI, fallo cerrado. La API sigue siendo la autoridad. */
export function resolveUsersPanelAccess(mode: UsersMode, role: string | null): UsersPanelAccess {
  if (mode === "platform") {
    return {
      visible: true,
      canRead: true,
      canInvite: false,
      canChangeRole: false,
      canRevokeSession: true,
      scope: "platform",
    };
  }
  if (role === "owner" || role === "admin") {
    return {
      visible: true,
      canRead: true,
      canInvite: true,
      canChangeRole: true,
      canRevokeSession: false,
      scope: "agency",
    };
  }
  return {
    visible: false,
    canRead: false,
    canInvite: false,
    canChangeRole: false,
    canRevokeSession: false,
    scope: "agency",
  };
}

export interface OrganizationOption {
  id: string;
  name: string;
}

export interface MemberItem {
  id: string;
  userId: string;
  role: string;
  name: string | null;
  email: string | null;
  twoFactorEnabled: boolean | null;
}

export interface SessionItem {
  id: string;
  token: string | null;
  device: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface UsersApiOptions {
  fetchImpl?: typeof globalThis.fetch;
}

const ROLES = new Set(["owner", "admin", "agent", "provider", "member"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validationError(field: string): AuthApiError {
  return new AuthApiError(422, `Solicitud no válida: ${field}`, "VALIDATION_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readError(response: Response): Promise<AuthApiError> {
  const body = (await response.json().catch(() => null)) as
    | { message?: unknown; code?: unknown }
    | null;
  const message =
    typeof body?.message === "string" && body.message !== ""
      ? body.message
      : response.statusText;
  const code = typeof body?.code === "string" ? body.code : undefined;
  return new AuthApiError(response.status, message, code);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function listFrom(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body[key])) return body[key] as unknown[];
  return [];
}

/** GET /api/auth/organization/list: solo las membresías del actor. */
export async function listTargetOrganizations(
  options: UsersApiOptions = {},
): Promise<OrganizationOption[]> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/auth/organization/list", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return listFrom(await response.json().catch(() => null), "organizations").flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry["id"]);
    const name = text(entry["name"]);
    return id && name ? [{ id, name }] : [];
  });
}

/**
 * Falla cerrado si el objetivo no está entre las organizaciones ofrecidas por
 * Better Auth al actor; impide que la UI envíe una agencia ajena.
 */
export function resolveTargetOrganization(
  organizations: OrganizationOption[],
  organizationId: string,
): OrganizationOption {
  const found = organizations.find((organization) => organization.id === organizationId);
  if (!found) throw validationError("organizationId");
  return found;
}

/** GET /api/auth/organization/list-members de la organización objetivo. */
export async function listMembers(
  organizationId: string,
  options: UsersApiOptions = {},
): Promise<MemberItem[]> {
  if (organizationId === "") throw validationError("organizationId");
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const query = new URLSearchParams({ organizationId });
  const response = await doFetch(`/api/auth/organization/list-members?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  return listFrom(await response.json().catch(() => null), "members").flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry["id"]);
    const userId = text(entry["userId"]);
    const role = text(entry["role"]);
    if (!id || !userId || !role) return [];
    const user = isRecord(entry["user"]) ? entry["user"] : {};
    const twoFactor = user["twoFactorEnabled"];
    return [
      {
        id,
        userId,
        role,
        name: text(user["name"]),
        email: text(user["email"]),
        twoFactorEnabled: typeof twoFactor === "boolean" ? twoFactor : null,
      },
    ];
  });
}

export interface InviteMemberInput {
  organizationId: string;
  email: string;
  role: string;
}

/** POST /api/auth/organization/invite-member (ruta existente con TOTP). */
export async function inviteMember(
  payload: InviteMemberInput,
  options: UsersApiOptions = {},
): Promise<void> {
  if (payload.organizationId === "") throw validationError("organizationId");
  if (!EMAIL_PATTERN.test(payload.email)) throw validationError("email");
  if (!ROLES.has(payload.role)) throw validationError("role");
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/auth/organization/invite-member", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: payload.organizationId,
      email: payload.email,
      role: payload.role,
    }),
  });
  if (!response.ok) throw await readError(response);
}

export interface ChangeMemberRoleInput {
  organizationId: string;
  memberId: string;
  role: string;
}

/** POST /api/auth/organization/update-member-role (ruta existente con TOTP). */
export async function changeMemberRole(
  payload: ChangeMemberRoleInput,
  options: UsersApiOptions = {},
): Promise<void> {
  if (payload.organizationId === "") throw validationError("organizationId");
  if (payload.memberId === "") throw validationError("memberId");
  if (!ROLES.has(payload.role)) throw validationError("role");
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/auth/organization/update-member-role", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: payload.organizationId,
      memberId: payload.memberId,
      role: payload.role,
    }),
  });
  if (!response.ok) throw await readError(response);
}

/** POST /api/auth/admin/list-user-sessions (solo lectura, modo plataforma). */
export async function listSessions(
  userId: string,
  options: UsersApiOptions = {},
): Promise<SessionItem[]> {
  if (userId === "") throw validationError("userId");
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/auth/admin/list-user-sessions", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw await readError(response);
  return listFrom(await response.json().catch(() => null), "sessions").flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = text(entry["id"]);
    if (!id) return [];
    return [
      {
        id,
        token: text(entry["token"]),
        device: text(entry["userAgent"]) ?? text(entry["userAgentString"]),
        createdAt: text(entry["createdAt"]),
        expiresAt: text(entry["expiresAt"]),
      },
    ];
  });
}

/** POST /api/auth/admin/revoke-user-session (Super Admin con TOTP). */
export async function revokeSession(
  sessionToken: string,
  options: UsersApiOptions = {},
): Promise<void> {
  if (sessionToken === "") throw validationError("sessionToken");
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const response = await doFetch("/api/auth/admin/revoke-user-session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!response.ok) throw await readError(response);
}

/** El error de agencia activa tiene un mensaje propio en el panel. */
export function isUsersOrganizationError(cause: unknown): boolean {
  return cause instanceof AuthApiError && cause.code === "ACTIVE_ORGANIZATION_REQUIRED";
}
