-- Tabla audit_logs (T-F0-7, specs/audit) + Row-Level Security por tenant.
--
-- El CREATE TABLE y el indice replican lo que generaria el CLI de Prisma
-- para el modelo AuditLog de schema.prisma (columnas mapeadas a snake_case
-- igual que el resto de la BD); la parte de RLS es SQL propio que Prisma no
-- modela. Se escribio a mano porque por entonces migrate dev no podia
-- replayear la migracion del rol restringido en su shadow database (REVOKE
-- sobre _prisma_migrations); ese replay quedo arreglado el 2026-11-10 con el
-- REVOKE condicional y migrate dev vuelve a estar disponible.

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- Row-Level Security: caribe_app conecta como NOBYPASSRLS y no es duena de
-- las tablas, asi que las politicas siempre aplican a la aplicacion. FORCE
-- las extiende tambien al rol dueno por si alguna conexion no superusuario
-- llegara a usarlo: nadie lee audit_logs fuera de un contexto explicito.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- Contexto de agencia: solo filas del tenant fijado por TenantService con
-- set_config('app.tenant_id', ..., true) dentro de la transaccion. Sin GUC,
-- current_setting(..., true) devuelve NULL y la comparacion excluye la fila:
-- fallo cerrado. WITH CHECK impide escribir filas de otro tenant.
CREATE POLICY "audit_logs_tenant" ON "audit_logs"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- Contexto de plataforma (super_admin): filas de todas las agencias y las de
-- plataforma (tenant_id NULL). Opt-in explicito con set_config('app.platform',
-- 'on', ...); tambien permite INSERT con tenant_id NULL desde ese contexto.
CREATE POLICY "audit_logs_platform" ON "audit_logs"
    USING (current_setting('app.platform', true) = 'on')
    WITH CHECK (current_setting('app.platform', true) = 'on');
