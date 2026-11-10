-- Inmutabilidad de audit_logs (T-F0-9, spec audit "Inmutabilidad"): el rol
-- de la aplicacion pierde UPDATE y DELETE (solo le quedan INSERT y SELECT,
-- como pide el SDD) y un trigger rechaza la modificacion para CUALQUIER rol,
-- incluido el dueno de las tablas: si un rol con privilegios intentara
-- cambiar o borrar el rastro, la base de datos lo rechaza igual (defensa en
-- profundidad). TRUNCATE no se bloquea: caribe_app nunca recibio ese GRANT y
-- la spec solo nombra UPDATE y DELETE. Las migraciones no tocan filas
-- existentes, asi que el trigger no interfiere con prisma migrate.

-- La tabla existe en este punto del orden de migraciones (la creo la
-- migracion anterior), tambien durante el replay de la shadow database.
REVOKE UPDATE, DELETE ON "audit_logs" FROM caribe_app;

CREATE FUNCTION "audit_logs_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es inmutable: % no esta permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_immutable"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_reject_change"();
