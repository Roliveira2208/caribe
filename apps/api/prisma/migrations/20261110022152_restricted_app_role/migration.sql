-- Rol de base de datos restringido para la aplicacion (soporte de RLS).
-- La aplicacion nunca conecta como duena de las tablas: el dueno (rol de
-- migraciones) ignora RLS; ota_app, sin BYPASSRLS, siempre la respeta.
-- La contrasena no vive en el repositorio: se asigna fuera de bandas con
-- ALTER ROLE ota_app PASSWORD '...' leyendo una variable de entorno.
-- T-F0-6 dejara audit_logs en INSERT/SELECT unicamente para este rol.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ota_app') THEN
    CREATE ROLE ota_app LOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ota_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ota_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ota_app;

-- La tabla interna de control de prisma no es de la aplicacion.
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM ota_app;

-- Tablas y secuencias creadas despues (p. ej. audit_logs en F0) heredan los
-- mismos permisos DML; T-F0-6 recortara audit_logs a INSERT/SELECT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ota_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ota_app;
