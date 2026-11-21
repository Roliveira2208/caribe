-- Lectura pública de la política de cancelación asociada a un producto
-- publicado. SECURITY DEFINER evita dar acceso directo a cancellation_policies
-- desde el contexto RLS public; la función filtra explícitamente estado y
-- borrado y solo proyecta nombre y reglas. search_path fijo contra secuestro.
CREATE FUNCTION "public_cancellation_policy"(
    p_product_id text
) RETURNS TABLE (
    name TEXT,
    rules JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cp."name", cp."rules"
    FROM "cancellation_policies" cp
    JOIN "products" p ON p."cancellation_policy_id" = cp."id"
   WHERE p."id" = p_product_id
     AND p."status" = 'PUBLISHED'
     AND p."deleted_at" IS NULL
$$;

REVOKE ALL ON FUNCTION "public_cancellation_policy"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public_cancellation_policy"(text) TO caribe_app;
