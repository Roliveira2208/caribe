-- CreateEnum
CREATE TYPE "RefundDispatchStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "refund_dispatches" (
    "refund_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "status" "RefundDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "provider_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_dispatches_pkey" PRIMARY KEY ("refund_id")
);

-- CreateIndex
CREATE INDEX "refund_dispatches_tenant_id_status_created_at_idx" ON "refund_dispatches"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "refund_dispatches_payment_id_idx" ON "refund_dispatches"("payment_id");

-- AddForeignKey
ALTER TABLE "refund_dispatches" ADD CONSTRAINT "refund_dispatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_dispatches" ADD CONSTRAINT "refund_dispatches_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: misma política que `refunds` (F-FINAL-003). El despacho
-- es la intención de un reembolso, así que hereda su regla de visibilidad: la
-- agencia del reembolso o el dueño de la reserva. caribe_app conecta como
-- NOBYPASSRLS y no es dueña de la tabla; FORCE extiende la política al dueño.
ALTER TABLE "refund_dispatches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund_dispatches" FORCE ROW LEVEL SECURITY;
CREATE POLICY "refund_dispatches_tenant_owner" ON "refund_dispatches"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "refund_dispatches"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "refund_dispatches"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    );
