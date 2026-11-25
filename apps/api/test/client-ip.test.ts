import { describe, expect, it } from "vitest";
import { resolveClientIp } from "../src/security/client-ip.js";

/**
 * Unitarios de la resolución de IP (T-F2-2, spec security). La cadena solo se
 * recorre desde el socket cuando el emisor inmediato es de confianza; el caso
 * `null` existe y ningún consumidor debe asumir que siempre hay dirección.
 */
describe("resolveClientIp", () => {
  const proxy = "10.0.0.5";
  const client = "203.0.113.9";
  const trusted = ["10.0.0.0/8"];

  it("recorre la cadena hasta el primer salto que no es proxy", () => {
    expect(
      resolveClientIp({
        socketAddress: proxy,
        forwardedFor: `${client}, 10.0.0.6, ${proxy}`,
        trustedProxies: trusted,
      }),
    ).toBe(client);
  });

  it("ignora la cabecera cuando el socket no es de confianza", () => {
    expect(
      resolveClientIp({
        socketAddress: "198.51.100.5",
        forwardedFor: `${client}, ${proxy}`,
        trustedProxies: trusted,
      }),
    ).toBe("198.51.100.5");
  });

  it("ignora una cadena cuyo último salto no es el socket", () => {
    expect(
      resolveClientIp({
        socketAddress: proxy,
        forwardedFor: `${client}, 198.51.100.5`,
        trustedProxies: trusted,
      }),
    ).toBe(proxy);
  });

  it("devuelve null cuando todos los saltos son proxies de confianza", () => {
    expect(
      resolveClientIp({
        socketAddress: proxy,
        forwardedFor: `10.0.0.6, ${proxy}`,
        trustedProxies: trusted,
      }),
    ).toBeNull();
  });

  it("devuelve null sin dirección de socket", () => {
    expect(
      resolveClientIp({ socketAddress: null, forwardedFor: client, trustedProxies: trusted }),
    ).toBeNull();
  });

  it("normaliza un socket IPv4 mapeado a IPv6", () => {
    expect(resolveClientIp({ socketAddress: "::ffff:10.0.0.5", trustedProxies: trusted })).toBe(
      "10.0.0.5",
    );
  });
});
