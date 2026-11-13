-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('HOTEL');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('OWN');

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "country" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "hotel_key" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "destination_id" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "base_price_usd" DECIMAL(14,2) NOT NULL,
    "cancellation_policy_id" TEXT,
    "source" "ProductSource" NOT NULL DEFAULT 'OWN',
    "external_ref" TEXT,
    "attributes" JSONB NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "night" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "price_usd" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providers_tenant_id_idx" ON "providers"("tenant_id");

-- CreateIndex
CREATE INDEX "destinations_tenant_id_idx" ON "destinations"("tenant_id");

-- CreateIndex
CREATE INDEX "cancellation_policies_tenant_id_idx" ON "cancellation_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_type_destination_id_status_idx" ON "products"("tenant_id", "type", "destination_id", "status");

-- CreateIndex
CREATE INDEX "products_type_destination_id_status_deleted_at_idx" ON "products"("type", "destination_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "products_hotel_key_idx" ON "products"("hotel_key");

-- CreateIndex
CREATE INDEX "availability_night_product_id_idx" ON "availability"("night", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "availability_product_id_night_key" ON "availability"("product_id", "night");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_cancellation_policy_id_fkey" FOREIGN KEY ("cancellation_policy_id") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability" ADD CONSTRAINT "availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability" ADD CONSTRAINT "availability_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Reglas de negocio del catálogo (T-F1-1b, design §2.2). Prisma no modela
-- CHECK, triggers ni políticas RLS: esta parte es SQL propio.
-- ============================================================================

-- Un producto es un tipo de habitación vendible: hotel_key es el UUID del
-- hotel (se repite en cada tipo), room_type un código estable en minúsculas y
-- el precio base siempre positivo.
ALTER TABLE "products"
  ADD CONSTRAINT "products_base_price_usd_check" CHECK ("base_price_usd" > 0),
  ADD CONSTRAINT "products_hotel_key_check"
    CHECK ("hotel_key" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  ADD CONSTRAINT "products_room_type_check" CHECK ("room_type" ~ '^[a-z][a-z0-9_-]*$');

-- Una fila por producto y noche: la noche de salida no se ocupa y no se
-- cobra. capacity y reserved se cuentan en habitaciones del producto.
ALTER TABLE "availability"
  ADD CONSTRAINT "availability_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "availability_reserved_check"
    CHECK ("reserved" >= 0 AND "reserved" <= "capacity"),
  ADD CONSTRAINT "availability_price_usd_check" CHECK ("price_usd" > 0);

-- ----------------------------------------------------------------------------
-- Coherencia de tenant: el tenant de la fila hija debe ser el del padre. Las
-- FK de PostgreSQL no respetan RLS, así que el trigger es la defensa que
-- impide colgar un producto del proveedor/destino/política de otra agencia y
-- una disponibilidad del producto de otra agencia.
-- ----------------------------------------------------------------------------
CREATE FUNCTION "products_tenant_coherence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "providers" p
     WHERE p."id" = NEW."provider_id" AND p."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'provider no pertenece a la agencia del producto'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "destinations" d
     WHERE d."id" = NEW."destination_id" AND d."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'destination no pertenece a la agencia del producto'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."cancellation_policy_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cancellation_policies" cp
     WHERE cp."id" = NEW."cancellation_policy_id" AND cp."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'cancellation policy no pertenece a la agencia del producto'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_tenant_coherence"
  BEFORE INSERT OR UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION "products_tenant_coherence"();

CREATE FUNCTION "availability_tenant_coherence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "products" p
     WHERE p."id" = NEW."product_id" AND p."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'product no pertenece a la agencia de la disponibilidad'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "availability_tenant_coherence"
  BEFORE INSERT OR UPDATE ON "availability"
  FOR EACH ROW EXECUTE FUNCTION "availability_tenant_coherence"();

-- ----------------------------------------------------------------------------
-- Reglas de cancelación: de 1 a 10 reglas, horas enteras no negativas
-- estrictamente descendentes y porcentajes enteros 0–100. El esquema Zod lo
-- valida en la API; el trigger es la defensa de la base.
-- ----------------------------------------------------------------------------
CREATE FUNCTION "cancellation_policies_validate_rules"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rule jsonb;
  previous_hours integer := NULL;
  current_hours integer;
  current_percentage integer;
BEGIN
  IF jsonb_typeof(NEW."rules") <> 'array' THEN
    RAISE EXCEPTION 'cancellation rules debe ser un arreglo'
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_array_length(NEW."rules") < 1 OR jsonb_array_length(NEW."rules") > 10 THEN
    RAISE EXCEPTION 'cancellation rules debe tener entre 1 y 10 reglas'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR rule IN SELECT value FROM jsonb_array_elements(NEW."rules") LOOP
    IF jsonb_typeof(rule) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(rule)) <> 2
       OR NOT (rule ? 'hours_before')
       OR NOT (rule ? 'percentage') THEN
      RAISE EXCEPTION 'cada regla debe tener solo hours_before y percentage'
        USING ERRCODE = 'check_violation';
    END IF;

    IF jsonb_typeof(rule->'hours_before') <> 'number'
       OR jsonb_typeof(rule->'percentage') <> 'number'
       OR (rule->>'hours_before') !~ '^[0-9]+$'
       OR (rule->>'percentage') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'hours_before y percentage deben ser enteros no negativos'
        USING ERRCODE = 'check_violation';
    END IF;

    current_hours := (rule->>'hours_before')::integer;
    current_percentage := (rule->>'percentage')::integer;

    IF current_percentage > 100 THEN
      RAISE EXCEPTION 'percentage debe estar entre 0 y 100'
        USING ERRCODE = 'check_violation';
    END IF;

    IF previous_hours IS NOT NULL AND current_hours >= previous_hours THEN
      RAISE EXCEPTION 'hours_before debe ser estrictamente descendente'
        USING ERRCODE = 'check_violation';
    END IF;

    previous_hours := current_hours;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "cancellation_policies_rules_valid"
  BEFORE INSERT OR UPDATE ON "cancellation_policies"
  FOR EACH ROW EXECUTE FUNCTION "cancellation_policies_validate_rules"();

-- ----------------------------------------------------------------------------
-- Row-Level Security. caribe_app conecta como NOBYPASSRLS y no es dueña de las
-- tablas; FORCE extiende las políticas al dueño. Sin GUC, current_setting(...,
-- true) devuelve NULL y la comparación excluye la fila: fallo cerrado.
-- ----------------------------------------------------------------------------
ALTER TABLE "providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "providers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "providers_tenant" ON "providers"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "providers_platform" ON "providers"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

ALTER TABLE "destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "destinations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "destinations_tenant" ON "destinations"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "destinations_platform" ON "destinations"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');
-- Catálogo público: solo los destinos referenciados por un producto publicado
-- y no borrado; nunca destinos de borradores.
CREATE POLICY "destinations_public" ON "destinations"
    FOR SELECT
    USING (
        current_setting('app.public', true) = 'on'
        AND EXISTS (
            SELECT 1 FROM "products" p
             WHERE p."destination_id" = "destinations"."id"
               AND p."status" = 'PUBLISHED'
               AND p."deleted_at" IS NULL
        )
    );

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "products_tenant" ON "products"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "products_platform" ON "products"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');
-- Catálogo público: solo productos publicados y sin borrado lógico, de
-- cualquier agencia. Política de solo lectura: el contexto público no escribe.
CREATE POLICY "products_public" ON "products"
    FOR SELECT
    USING (
        current_setting('app.public', true) = 'on'
        AND "status" = 'PUBLISHED'
        AND "deleted_at" IS NULL
    );

ALTER TABLE "availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY "availability_tenant" ON "availability"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "availability_platform" ON "availability"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');
-- La disponibilidad pública solo existe para productos publicados y no
-- borrados. La API la lee con la función public_availability, que devuelve
-- remaining y no capacity ni reserved.
CREATE POLICY "availability_public" ON "availability"
    FOR SELECT
    USING (
        current_setting('app.public', true) = 'on'
        AND EXISTS (
            SELECT 1 FROM "products" p
             WHERE p."id" = "availability"."product_id"
               AND p."status" = 'PUBLISHED'
               AND p."deleted_at" IS NULL
        )
    );

ALTER TABLE "cancellation_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cancellation_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "cancellation_policies_tenant" ON "cancellation_policies"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "cancellation_policies_platform" ON "cancellation_policies"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

-- ----------------------------------------------------------------------------
-- Disponibilidad pública: única vía de lectura anónima. SECURITY DEFINER
-- permite leer las filas sin depender del rol, pero la función filtra
-- explícitamente productos publicados y sin borrado y solo proyecta night,
-- remaining y price_usd: capacity y reserved no salen nunca. search_path fijo
-- para evitar secuestro de nombres.
-- ----------------------------------------------------------------------------
CREATE FUNCTION "public_availability"(
    p_product_id text,
    p_from date,
    p_to date
) RETURNS TABLE (
    night DATE,
    remaining INTEGER,
    price_usd DECIMAL(14,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a."night",
         (a."capacity" - a."reserved")::integer AS remaining,
         a."price_usd"
    FROM "availability" a
    JOIN "products" p ON p."id" = a."product_id"
   WHERE a."product_id" = p_product_id
     AND a."night" >= p_from
     AND a."night" < p_to
     AND p."status" = 'PUBLISHED'
     AND p."deleted_at" IS NULL
   ORDER BY a."night"
$$;

REVOKE ALL ON FUNCTION "public_availability"(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public_availability"(text, date, date) TO caribe_app;
