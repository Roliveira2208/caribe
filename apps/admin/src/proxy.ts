import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next 16 renombro middleware a proxy; next-intl publica el handler como
// createMiddleware y funciona igual como default export de src/proxy.ts.
export default createMiddleware(routing);

export const config = {
  // /api queda fuera: el proxy de reenvios de next.config atiende esas rutas
  // (cookie de primera parte) y no debe recibir redirects de idioma.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
