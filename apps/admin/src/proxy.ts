import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { buildContentSecurityPolicy } from "./lib/csp";

const intlMiddleware = createMiddleware(routing);

/**
 * Next 16 renombró middleware a proxy; next-intl publica el handler como
 * createMiddleware. Antes de delegar se genera un nonce por petición y se
 * publica en la cabecera CSP y en `x-nonce`, que Next usa para marcar sus
 * scripts. La CSP se fija también en la respuesta (redirects y páginas de
 * error incluidas), no solo en la petición.
 */
export default async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );

  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const response = await intlMiddleware(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // /api queda fuera: el proxy de reenvíos de next.config atiende esas rutas
  // (cookie de primera parte) y no debe recibir redirects de idioma.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
