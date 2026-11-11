import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const apiUrl = process.env.API_URL ?? "http://localhost:3002";

const nextConfig: NextConfig = {
  // Proxy de primera parte: /api/:path* se reenvia a la API NestJS para que
  // la cookie de sesion quede en el origen de la web (sin CORS). El proxy.ts
  // de next-intl excluye /api de su matcher.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

// Carga src/i18n/request.ts para resolver mensajes por request.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
