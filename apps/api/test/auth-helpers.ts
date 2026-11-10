import { createHmac, randomUUID } from "node:crypto";
import { auth } from "../src/auth.js";
import { prisma } from "../src/prisma.js";

/**
 * Helpers compartidos de los e2e de auth (auth.e2e.ts y two-factor.e2e.ts).
 *
 * Los usuarios y agencias se dan de alta por la API de servidor de Better
 * Auth (accion de sistema; el registro por HTTP tiene rate limit y crear
 * datos no es el comportamiento bajo prueba), y el inicio de sesion si va
 * por HTTP para ejercitar la cookie real. El TOTP (RFC 6238) se calcula con
 * node:crypto para no anadir dependencias solo para los tests.
 */

export const TEST_PASSWORD = "Password123!";
export const authOrigin = process.env.BETTER_AUTH_URL ?? "http://localhost:3002";

/** Alta de usuario por la API de servidor (accion de sistema). */
export async function createUser(email: string): Promise<string> {
  const { user } = await auth.api.signUpEmail({
    body: { name: `Usuario ${email.split("@")[0]}`, email, password: TEST_PASSWORD },
  });
  return user.id;
}

/** Inicio de sesion por HTTP; devuelve la cookie de sesion. */
export async function signIn(baseUrl: string, email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: authOrigin },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`sign-in falló: ${await res.text()}`);
  }
  const cookie = sessionCookieOf(res);
  if (!cookie) {
    throw new Error("sign-in no fijó la cookie de sesión");
  }
  return cookie;
}

/** Cookie de sesion (better-auth.session_token) de un Response; "" si no viene. */
export function sessionCookieOf(res: Response): string {
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((cookie) => cookie.startsWith("better-auth.session_token"));
  return session?.split(";")[0] ?? "";
}

/**
 * Accion de sistema (matriz T-F0-6): sin sesion y con userId es la unica via
 * de alta de agencias con allowUserToCreateOrganization: false.
 */
export async function createAgency(
  userId: string,
  name: string,
  slug: string,
): Promise<{ id: string }> {
  return auth.api.createOrganization({ body: { name, slug, userId } });
}

/**
 * Membresia directa para fijar el rol; el flujo de invitacion se prueba
 * aparte. id y createdAt los genera Better Auth en la capa de aplicacion (el
 * modelo no tiene defaults de BD), asi que aqui se aportan a mano.
 */
export async function addMember(
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  await prisma.member.create({
    data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
  });
}

/** Fija la organizacion activa de la sesion (falla ruidoso si no la fija). */
export async function setActiveOrg(
  baseUrl: string,
  cookie: string,
  organizationId: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: authOrigin },
    body: JSON.stringify({ organizationId }),
  });
  if (!res.ok) {
    throw new Error(`set-active falló: ${await res.text()}`);
  }
  // El endpoint responde 200 con null cuando no fija nada (cuerpo sin
  // clave reconocida): que falle ruidoso y no silencioso.
  const org = (await res.json()) as { id: string } | null;
  if (!org || org.id !== organizationId) {
    throw new Error("set-active no fijó la organización activa");
  }
}

/** Secreto base32 del otpauth:// que devuelve /two-factor/enable. */
export function totpSecretFromUri(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) {
    throw new Error(`el totpURI no trae secreto: ${totpURI}`);
  }
  return secret;
}

/**
 * Codigo TOTP de 6 digitos y 30 s (RFC 6238, HMAC-SHA-1), igual que los
 * autenticadores que usara la UI. Solo para tests: la activacion real la
 * escanea el usuario desde la pantalla de T-F0-10.
 */
export function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counterBytes).digest();
  // Truncado dinamico del RFC 4226.
  const last = digest[digest.length - 1];
  const offset = last === undefined ? 0 : last & 0xf;
  const word =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(word % 1_000_000).padStart(6, "0");
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`caracter base32 inválido: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
