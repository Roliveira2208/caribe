import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no esta definida. Copia .env.example a .env y ajusta los valores.");
}

const adapter = new PrismaPg({ connectionString });

/**
 * Cliente Prisma unico del proceso. Prisma 7 exige un driver adapter; con el
 * driver pg nativo se podran fijar GUC de tenant (SET LOCAL app.tenant_id)
 * dentro de transacciones interactivas cuando llegue el TenantModule (T-F0-6).
 */
export const prisma = new PrismaClient({ adapter });
