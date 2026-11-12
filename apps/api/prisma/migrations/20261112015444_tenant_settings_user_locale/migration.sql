-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "locale" TEXT DEFAULT 'es';

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" TEXT NOT NULL,
    "hold_minutes" INTEGER NOT NULL DEFAULT 30,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'AUTO',
    "base_currency" TEXT NOT NULL DEFAULT 'USD',
    "legal_name" TEXT,
    "rif" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Limites de negocio en la base, no solo en Zod (T-F1-1a, design §2.1):
-- defensa en profundidad si algun dia se escribe por otra via.
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_hold_minutes_check" CHECK ("hold_minutes" BETWEEN 5 AND 1440);
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_base_currency_check" CHECK ("base_currency" ~ '^[A-Z]{3}$');

-- Row-Level Security por tenant (T-F1-1a, design §3.1). La tabla no tiene
-- dueno: solo la agencia activa (GUC app.tenant_id) puede leer y escribir su
-- fila, y el contexto de plataforma (app.platform='on') solo puede leer.
-- caribe_app conecta como NOBYPASSRLS y no es duena, asi que las politicas
-- siempre aplican; FORCE las extiende tambien al dueno.
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_tenant" ON "tenant_settings"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

CREATE POLICY "tenant_settings_platform" ON "tenant_settings"
  FOR SELECT
  USING (current_setting('app.platform', true) = 'on');
