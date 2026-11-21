import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const apiUrl = process.env.API_URL ?? "http://localhost:3002";

// Las imágenes del catálogo ya pasan por el esquema de la API, que solo admite
// HTTPS en los hosts de ALLOWED_IMAGE_HOSTS. La web usa la misma lista para no
// ampliar la superficie de next/image.
const imageHosts = (process.env.ALLOWED_IMAGE_HOSTS ?? "images.caribe.test")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: imageHosts.map((hostname) => ({
      protocol: "https",
      hostname,
      pathname: "/**",
    })),
  },
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
