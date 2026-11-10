import { join } from "node:path";
import dotenv from "dotenv";

// Misma precedencia que prisma7.config.ts: el .env del paquete primero y
// luego el del monorepo. dotenv no sobrescribe variables ya presentes, asi
// que el entorno real (CI, produccion) siempre gana sobre los archivos.
dotenv.config({ path: join(process.cwd(), ".env") });
dotenv.config({ path: join(process.cwd(), "../../.env") });

/**
 * Lee una variable de entorno obligatoria. El proposito es fallar pronto y
 * con un mensaje claro en el arranque, nunca leer secretos de otro sitio.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `La variable de entorno ${name} es obligatoria. Copia .env.example a .env y ajusta los valores.`,
    );
  }
  return value;
}
