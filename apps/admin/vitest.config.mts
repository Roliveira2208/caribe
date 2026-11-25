import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // next-intl importa `next/server` sin extensión; el resolver de Vite no
      // lo alcanza desde su carpeta aislada de pnpm. Next publica el archivo
      // como `next/server.js` (la guía de Next 16 usa el mismo subpath).
      { find: /^next\/server$/, replacement: "next/server.js" },
    ],
  },
  test: {
    // Sin esto Vitest externaliza next-intl y Node resuelve el import por su
    // cuenta, sin aplicar el alias anterior.
    server: { deps: { inline: ["next-intl"] } },
  },
});
