import { PrismaPg } from "@prisma/adapter-pg";
import { requiredEnv } from "./env.js";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: requiredEnv("DATABASE_URL") });

/**
 * Cliente Prisma unico del proceso. Prisma 7 exige un driver adapter; con el
 * driver pg nativo se podran fijar GUC de tenant (SET LOCAL app.tenant_id)
 * dentro de transacciones interactivas cuando llegue el TenantModule (T-F0-6).
 */
export const prisma = new PrismaClient({ adapter });
