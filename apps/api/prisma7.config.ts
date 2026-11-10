// Configuracion del CLI de Prisma 7. En Prisma 7 la URL del datasource vive
// aqui (no en schema.prisma) y el CLI no carga .env por si solo.
// Carga el .env del paquete y luego el del monorepo; dotenv no sobrescribe
// variables que ya existan en el entorno, asi que el orden da precedencia al
// .env mas cercano.
import { join } from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    // BD vacia para el replay de migraciones (migrate dev / migrate diff).
    // Opcional: sin esta variable el CLI crea y borra una shadow automatica,
    // lo que exige CREATEDB en el rol de migraciones (cierto en local y CI,
    // superusuario del contenedor/servicio). Los hostings gestionados suelen
    // dar roles sin CREATEDB: alli se apunta a una BD vacia dedicada.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
