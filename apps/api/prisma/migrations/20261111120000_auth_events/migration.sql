-- auth_events (T-F1-0b, delta de audit "Registro de intentos y resultados de
-- acciones administrativas"): intentos y resultados de las escrituras
-- administrativas de Better Auth y de los rechazos por segundo factor. Dos
-- filas por intento unidas por correlation_id (phase attempt/result).
--
-- La tabla es append-only: caribe_app solo conserva INSERT y SELECT, y un
-- trigger rechaza UPDATE/DELETE para CUALQUIER rol (incluido el dueno). RLS
-- por tenant_id con visibilidad de plataforma (tenant_id NULL), igual que
-- audit_logs: sin GUC no se ve ninguna fila.

-- CreateTable
CREATE TABLE "auth_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "actor_id" TEXT,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ip" TEXT,
    "outcome" TEXT,
    "error_code" TEXT,
    "error_status" INTEGER,
    "error_name" TEXT,
    "entity" TEXT,
    "entity_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_events_tenant_id_idx" ON "auth_events"("tenant_id");
CREATE INDEX "auth_events_correlation_id_idx" ON "auth_events"("correlation_id");
-- Paginacion por cursor keyset (at, id) en orden descendente.
CREATE INDEX "auth_events_at_id_idx" ON "auth_events"("at", "id");

-- La fila de intento no tiene resultado; la de resultado siempre lo tiene.
ALTER TABLE "auth_events"
    ADD CONSTRAINT "auth_events_phase_check"
    CHECK ("phase" IN ('attempt', 'result'));

ALTER TABLE "auth_events"
    ADD CONSTRAINT "auth_events_outcome_check"
    CHECK (
        ("phase" = 'attempt' AND "outcome" IS NULL)
        OR ("phase" = 'result' AND "outcome" IN ('success', 'error'))
    );

ALTER TABLE "auth_events"
    ADD CONSTRAINT "auth_events_error_status_check"
    CHECK ("error_status" IS NULL OR ("error_status" >= 100 AND "error_status" <= 599));

-- Row-Level Security: mismas politicas que audit_logs. caribe_app conecta
-- como NOBYPASSRLS y no es duena; FORCE extiende las politicas al dueno.
ALTER TABLE "auth_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "auth_events_tenant" ON "auth_events"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

CREATE POLICY "auth_events_platform" ON "auth_events"
    USING (current_setting('app.platform', true) = 'on')
    WITH CHECK (current_setting('app.platform', true) = 'on');

-- Inmutabilidad: la aplicacion solo puede insertar y leer. El trigger cubre
-- tambien a roles con privilegios (defensa en profundidad).
REVOKE UPDATE, DELETE ON "auth_events" FROM caribe_app;

CREATE FUNCTION "auth_events_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'auth_events es inmutable: % no esta permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auth_events_immutable"
    BEFORE UPDATE OR DELETE ON "auth_events"
    FOR EACH ROW EXECUTE FUNCTION "auth_events_reject_change"();
