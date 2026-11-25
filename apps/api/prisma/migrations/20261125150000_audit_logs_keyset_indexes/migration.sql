-- Índices para el visor de auditoría con filtros y paginación keyset (T-F2-15).
-- (tenant_id, at, id) sirve al alcance por agencia y (at, id) al modo
-- plataforma; PostgreSQL puede recorrer ambos índices en orden descendente.
CREATE INDEX "audit_logs_tenant_id_at_id_idx" ON "audit_logs"("tenant_id", "at", "id");
CREATE INDEX "audit_logs_at_id_idx" ON "audit_logs"("at", "id");
