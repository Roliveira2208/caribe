import { isIP } from "node:net";

/**
 * Resolución de la IP real (T-F2-2, spec security).
 *
 * Better Auth sabe leer `x-forwarded-for`, pero no puede comprobar quién
 * emitió la cabecera: confiaría en un cliente que se la inventa. Esta capa sí
 * conoce la dirección del socket, así que decide primero si el emisor es un
 * proxy de confianza y solo entonces recorre la cadena hacia la izquierda.
 * El resultado se publica en `request.ip` y en una cabecera interna que Better
 * Auth consume; auditoría y rate limit ven exactamente el mismo valor.
 */

/** Cabecera interna: la escribe solo el middleware, nunca el cliente. */
export const CLIENT_IP_HEADER = "x-caribe-client-ip";

export interface ClientIpResolution {
  /** Dirección del socket (o de la conexión) tal como la ve el servidor. */
  socketAddress?: string | null;
  /** Cabeceras de reenvío; Express puede entregarla como cadena o arreglo. */
  forwardedFor?: string | string[] | null;
  /** Direcciones o rangos CIDR de los proxies de confianza. */
  trustedProxies?: readonly string[];
}

interface Cidr {
  version: 4 | 6;
  bytes: readonly number[];
  prefix: number;
}

/** Quita el prefijo IPv4-mapeado y valida; devuelve null si no es una IP. */
function normalizeAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const candidate = mapped?.[1] ?? trimmed;
  return isIP(candidate) ? candidate : null;
}

/** Expande un IPv6 a 16 bytes; devuelve [] si la forma no es válida. */
function ipv6Bytes(address: string): number[] {
  const lower = address.toLowerCase();
  const marker = lower.indexOf("::");
  let groups: string[];
  if (marker >= 0) {
    const left = lower.slice(0, marker).split(":").filter(Boolean);
    const right = lower.slice(marker + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 0) return [];
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = lower.split(":").filter(Boolean);
  }
  if (groups.length !== 8) return [];

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return [];
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function addressBytes(address: string, version: 4 | 6): number[] {
  if (version === 4) return address.split(".").map(Number);
  return ipv6Bytes(address);
}

function parseCidr(entry: string): Cidr | null {
  const parts = entry.trim().split("/");
  if (parts.length > 2) return null;
  const address = normalizeAddress(parts[0]);
  if (!address) return null;
  const version = isIP(address) as 4 | 6;
  const maxPrefix = version === 4 ? 32 : 128;
  const prefix = parts[1] === undefined ? maxPrefix : Number(parts[1]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  const bytes = addressBytes(address, version);
  if (bytes.length === 0) return null;
  return { version, bytes, prefix };
}

function matchesCidr(cidr: Cidr, address: string): boolean {
  if (isIP(address) !== cidr.version) return false;
  const bytes = addressBytes(address, cidr.version);
  const wholeBytes = Math.floor(cidr.prefix / 8);
  for (let i = 0; i < wholeBytes; i += 1) {
    if (bytes[i] !== cidr.bytes[i]) return false;
  }
  const remaining = cidr.prefix % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (bytes[wholeBytes]! & mask) === (cidr.bytes[wholeBytes]! & mask);
}

function forwardedTokens(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((part) => part.split(",")).map((ip) => ip.trim());
  if (typeof value !== "string") return [];
  return value.split(",").map((ip) => ip.trim()).filter(Boolean);
}

/**
 * Devuelve la IP del cliente, o `null` cuando no puede determinarse. Nunca
 * acepta una cabecera de reenvío si el socket no es de confianza.
 */
export function resolveClientIp(input: ClientIpResolution): string | null {
  const socket = normalizeAddress(input.socketAddress);
  if (!socket) return null;

  const proxies = (input.trustedProxies ?? [])
    .map(parseCidr)
    .filter((cidr): cidr is Cidr => cidr !== null);
  const socketTrusted = proxies.some((cidr) => matchesCidr(cidr, socket));
  const tokens = forwardedTokens(input.forwardedFor);
  if (!socketTrusted || tokens.length === 0) return socket;

  // El proxy inmediato debe aparecer como último salto: si no, la cadena fue
  // manipulada y se descarta completa.
  if (normalizeAddress(tokens[tokens.length - 1]) !== socket) return socket;

  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    const candidate = normalizeAddress(tokens[i]);
    if (!candidate) return socket;
    if (proxies.some((cidr) => matchesCidr(cidr, candidate))) continue;
    return candidate;
  }
  // Todos los saltos son proxies de confianza: no hay cliente identificable.
  return null;
}

/** Lo que el middleware necesita de la petición de Express. */
export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string } | null;
  connection?: { remoteAddress?: string } | null;
  method?: string;
  originalUrl?: string;
  path?: string;
}

/**
 * Fija `request.ip` y publica el valor en la cabecera interna usada por
 * Better Auth. Borra primero cualquier valor que el cliente haya enviado en
 * esa cabecera: es la única forma de que la librería no pueda ser engañada.
 * El valor no se devuelve en la respuesta: solo importa dentro del proceso.
 */
export function clientIpMiddleware(options: { trustedProxies: readonly string[] }) {
  return (request: ClientIpRequest, _response: unknown, next: () => void): void => {
    const socketAddress = request.socket?.remoteAddress ?? request.connection?.remoteAddress;
    const ip = resolveClientIp({
      socketAddress,
      forwardedFor: request.headers["x-forwarded-for"],
      trustedProxies: options.trustedProxies,
    });

    delete request.headers[CLIENT_IP_HEADER];
    if (ip) {
      request.headers[CLIENT_IP_HEADER] = ip;
    }

    Object.defineProperty(request, "ip", {
      value: ip,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
