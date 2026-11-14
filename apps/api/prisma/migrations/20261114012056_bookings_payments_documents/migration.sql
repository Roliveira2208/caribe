-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAGO_MOVIL', 'ZELLE', 'BINANCE_PAY', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('VOUCHER', 'RECEIPT', 'REFUND_NOTE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentLanguage" AS ENUM ('es', 'en');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_usd" DECIMAL(14,2) NOT NULL,
    "travelers" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "hotel_key" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "nightly_prices" JSONB NOT NULL,
    "subtotal_usd" DECIMAL(14,2) NOT NULL,
    "product_title" JSONB NOT NULL,
    "policy_snapshot" JSONB NOT NULL,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "source" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value_date" DATE NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_by" TEXT,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_usd" DECIMAL(14,2) NOT NULL,
    "amount_ves" DECIMAL(14,2) NOT NULL,
    "exchange_rate_id" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value_date" DATE NOT NULL,
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reported_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "amount_usd" DECIMAL(14,2) NOT NULL,
    "amount_ves" DECIMAL(14,2) NOT NULL,
    "exchange_rate_id" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "refund_id" TEXT,
    "type" "DocumentType" NOT NULL,
    "number" INTEGER NOT NULL,
    "file_url" TEXT,
    "language" "DocumentLanguage" NOT NULL DEFAULT 'es',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "issued_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counters" (
    "tenant_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("tenant_id","type")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_tenant_id_status_created_at_idx" ON "bookings"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "booking_items_booking_id_idx" ON "booking_items"("booking_id");

-- CreateIndex
CREATE INDEX "booking_items_tenant_id_idx" ON "booking_items"("tenant_id");

-- CreateIndex
CREATE INDEX "booking_items_product_id_idx" ON "booking_items"("product_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_endpoint_key_key" ON "idempotency_keys"("user_id", "endpoint", "key");

-- CreateIndex
CREATE INDEX "exchange_rates_value_date_idx" ON "exchange_rates"("value_date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_tenant_id_value_date_key" ON "exchange_rates"("tenant_id", "value_date");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_created_at_idx" ON "payments"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payments_exchange_rate_id_idx" ON "payments"("exchange_rate_id");

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_tenant_id_idx" ON "refunds"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_key" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "documents_booking_id_idx" ON "documents"("booking_id");

-- CreateIndex
CREATE INDEX "documents_payment_id_idx" ON "documents"("payment_id");

-- CreateIndex
CREATE INDEX "documents_refund_id_idx" ON "documents"("refund_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_status_idx" ON "documents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenant_id_type_number_key" ON "documents"("tenant_id", "type", "number");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_logs_tenant_id_status_idx" ON "notification_logs"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Reglas de negocio de reservas, pagos, reembolsos, documentos y avisos
-- (T-F1-1c, design §2.3–2.7). Prisma no modela CHECK, índices parciales,
-- triggers ni políticas RLS: esta parte es SQL propio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Únicos parciales. Los NULL no colisionan en un índice único normal, así que
-- la unicidad global de las tasas y de las referencias de pago necesita un
-- índice parcial explícito. Los documentos tienen un único por entidad y tipo.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "documents_voucher_unique"
  ON "documents"("booking_id") WHERE "type" = 'VOUCHER';
CREATE UNIQUE INDEX "documents_receipt_unique"
  ON "documents"("payment_id") WHERE "type" = 'RECEIPT';
CREATE UNIQUE INDEX "documents_refund_note_unique"
  ON "documents"("refund_id") WHERE "type" = 'REFUND_NOTE';
CREATE UNIQUE INDEX "payments_reference_unique"
  ON "payments"("tenant_id", "method", "reference") WHERE "reference" IS NOT NULL;
CREATE UNIQUE INDEX "exchange_rates_global_value_date_unique"
  ON "exchange_rates"("value_date") WHERE "tenant_id" IS NULL;

-- ----------------------------------------------------------------------------
-- Límites de la reserva y sus líneas: código Crockford, viajeros 1–9, dinero
-- positivo, cantidad positiva, estancia [check_in, check_out) de 1 a 30 noches
-- y copias coherentes del producto al reservar.
-- ----------------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_code_check"
    CHECK ("code" ~ '^CRB-[0-9A-HJKMNP-TV-Z]{8}$'),
  ADD CONSTRAINT "bookings_total_usd_check" CHECK ("total_usd" > 0),
  ADD CONSTRAINT "bookings_travelers_check"
    CHECK (jsonb_typeof("travelers") = 'array'
           AND jsonb_array_length("travelers") BETWEEN 1 AND 9);

ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "booking_items_dates_check" CHECK ("check_out" > "check_in"),
  ADD CONSTRAINT "booking_items_max_nights_check"
    CHECK (("check_out" - "check_in") <= 30),
  ADD CONSTRAINT "booking_items_subtotal_usd_check" CHECK ("subtotal_usd" > 0),
  ADD CONSTRAINT "booking_items_hotel_key_check"
    CHECK ("hotel_key" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  ADD CONSTRAINT "booking_items_room_type_check"
    CHECK ("room_type" ~ '^[a-z][a-z0-9_-]*$'),
  ADD CONSTRAINT "booking_items_nightly_prices_check"
    CHECK (jsonb_typeof("nightly_prices") = 'array'),
  ADD CONSTRAINT "booking_items_product_title_check"
    CHECK (jsonb_typeof("product_title") = 'object');

-- ----------------------------------------------------------------------------
-- Idempotencia (design §2.3): clave de 8 a 128 caracteres y estado HTTP
-- válido cuando la respuesta ya se guardó.
-- ----------------------------------------------------------------------------
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_key_length_check"
    CHECK (char_length("key") BETWEEN 8 AND 128),
  ADD CONSTRAINT "idempotency_keys_response_status_check"
    CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599);

-- ----------------------------------------------------------------------------
-- Tasas (design §2.4): tasa positiva, fuente no vacía y motivo obligatorio en
-- los overrides.
-- ----------------------------------------------------------------------------
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" > 0),
  ADD CONSTRAINT "exchange_rates_source_check" CHECK (length(btrim("source")) > 0),
  ADD CONSTRAINT "exchange_rates_override_reason_check"
    CHECK (NOT "is_override"
           OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));

-- ----------------------------------------------------------------------------
-- Pagos y reembolsos: dinero positivo y motivo de rechazo obligatorio.
-- ----------------------------------------------------------------------------
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_usd_check" CHECK ("amount_usd" > 0),
  ADD CONSTRAINT "payments_amount_ves_check" CHECK ("amount_ves" > 0),
  ADD CONSTRAINT "payments_rate_check" CHECK ("rate" > 0),
  ADD CONSTRAINT "payments_rejection_reason_check"
    CHECK ("status" <> 'REJECTED'
           OR ("rejection_reason" IS NOT NULL AND length(btrim("rejection_reason")) > 0));

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_usd_check" CHECK ("amount_usd" > 0),
  ADD CONSTRAINT "refunds_amount_ves_check" CHECK ("amount_ves" > 0),
  ADD CONSTRAINT "refunds_rate_check" CHECK ("rate" > 0),
  ADD CONSTRAINT "refunds_reason_check" CHECK (length(btrim("reason")) > 0);

-- ----------------------------------------------------------------------------
-- Documentos (design §2.6): número positivo, entidad coherente con el tipo y
-- ruta relativa no manipulable (sin esquema de URL, sin .. y sin ruta
-- absoluta). La descarga vuelve a validar la ruta.
-- ----------------------------------------------------------------------------
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_number_check" CHECK ("number" > 0),
  ADD CONSTRAINT "documents_entity_check"
    CHECK (
      ("type" = 'VOUCHER' AND "payment_id" IS NULL AND "refund_id" IS NULL)
      OR ("type" = 'RECEIPT' AND "payment_id" IS NOT NULL AND "refund_id" IS NULL)
      OR ("type" = 'REFUND_NOTE' AND "refund_id" IS NOT NULL)
    ),
  ADD CONSTRAINT "documents_file_url_check"
    CHECK (
      "file_url" IS NULL
      OR ("file_url" !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
          AND "file_url" NOT LIKE '%..%'
          AND left("file_url", 1) <> '/')
    );

ALTER TABLE "document_counters"
  ADD CONSTRAINT "document_counters_next_value_check" CHECK ("next_value" >= 1);

ALTER TABLE "notification_logs"
  ADD CONSTRAINT "notification_logs_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "notification_logs_locale_check" CHECK ("locale" IN ('es', 'en'));

-- ----------------------------------------------------------------------------
-- Triggers de validación e inmutabilidad.
-- ----------------------------------------------------------------------------

-- Los viajeros son un arreglo de objetos; el esquema Zod de la API valida los
-- campos personales, la base refuerza la forma y el tamaño.
CREATE FUNCTION "bookings_validate_travelers"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  traveler jsonb;
BEGIN
  IF jsonb_typeof(NEW."travelers") <> 'array'
     OR jsonb_array_length(NEW."travelers") < 1
     OR jsonb_array_length(NEW."travelers") > 9 THEN
    RAISE EXCEPTION 'travelers debe ser un arreglo de 1 a 9 viajeros'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR traveler IN SELECT value FROM jsonb_array_elements(NEW."travelers") LOOP
    IF jsonb_typeof(traveler) <> 'object' THEN
      RAISE EXCEPTION 'cada viajero debe ser un objeto'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "bookings_validate_travelers"
  BEFORE INSERT OR UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "bookings_validate_travelers"();

-- La identidad de la reserva y los datos del viajero no cambian después de
-- crearla; el estado sí (PENDING_PAYMENT -> CONFIRMED/CANCELLED/EXPIRED).
CREATE FUNCTION "bookings_identity_immutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."travelers" IS DISTINCT FROM OLD."travelers"
     OR NEW."total_usd" IS DISTINCT FROM OLD."total_usd"
     OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'bookings: identidad, viajeros, total y vencimiento son inmutables'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "bookings_identity_immutable"
  BEFORE UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "bookings_identity_immutable"();

-- Copias del producto y precios congelados al reservar (design §2.3).
CREATE FUNCTION "booking_items_frozen"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."policy_snapshot" IS DISTINCT FROM OLD."policy_snapshot"
     OR NEW."nightly_prices" IS DISTINCT FROM OLD."nightly_prices"
     OR NEW."subtotal_usd" IS DISTINCT FROM OLD."subtotal_usd"
     OR NEW."product_title" IS DISTINCT FROM OLD."product_title"
     OR NEW."hotel_key" IS DISTINCT FROM OLD."hotel_key"
     OR NEW."room_type" IS DISTINCT FROM OLD."room_type"
     OR NEW."check_in" IS DISTINCT FROM OLD."check_in"
     OR NEW."check_out" IS DISTINCT FROM OLD."check_out"
     OR NEW."quantity" IS DISTINCT FROM OLD."quantity" THEN
    RAISE EXCEPTION 'booking_items: política, precios y datos del producto son inmutables'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_items_frozen"
  BEFORE UPDATE ON "booking_items"
  FOR EACH ROW EXECUTE FUNCTION "booking_items_frozen"();

-- El par congelado del pago no se recalcula nunca (design §2.5 y §6).
CREATE FUNCTION "payments_frozen"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."exchange_rate_id" IS DISTINCT FROM OLD."exchange_rate_id"
     OR NEW."amount_usd" IS DISTINCT FROM OLD."amount_usd"
     OR NEW."amount_ves" IS DISTINCT FROM OLD."amount_ves"
     OR NEW."rate" IS DISTINCT FROM OLD."rate"
     OR NEW."value_date" IS DISTINCT FROM OLD."value_date" THEN
    RAISE EXCEPTION 'payments: tasa y montos congelados son inmutables'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_frozen"
  BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_frozen"();

-- La identidad del documento (entidad, tipo, número e idioma) es inmutable;
-- el estado, la ruta y el error los actualiza el trabajo de renderizado.
CREATE FUNCTION "documents_identity_immutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
     OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id"
     OR NEW."refund_id" IS DISTINCT FROM OLD."refund_id"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."language" IS DISTINCT FROM OLD."language"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'documents: identidad y número son inmutables'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_identity_immutable"
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "documents_identity_immutable"();

-- Los reembolsos son append-only: ni UPDATE ni DELETE, para ningún rol.
CREATE FUNCTION "refunds_append_only"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'refunds es append-only: % no está permitido', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "refunds_append_only"
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_append_only"();

-- El reembolso usa la tasa congelada del pago original, calcula el VES con esa
-- tasa y la suma de reembolsos no supera el monto del pago (design §2.5).
CREATE FUNCTION "refunds_limit_sum"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment_amount numeric(14,2);
  payment_tenant text;
  payment_booking text;
  payment_rate numeric(18,4);
  payment_value_date date;
  payment_rate_id text;
  already_refunded numeric(14,2);
BEGIN
  SELECT "amount_usd", "tenant_id", "booking_id", "rate", "value_date", "exchange_rate_id"
    INTO payment_amount, payment_tenant, payment_booking, payment_rate, payment_value_date,
         payment_rate_id
    FROM "payments"
   WHERE "id" = NEW."payment_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refunds: el pago no existe'
      USING ERRCODE = 'check_violation';
  END IF;

  IF payment_tenant <> NEW."tenant_id" OR payment_booking <> NEW."booking_id" THEN
    RAISE EXCEPTION 'refunds: pago y reserva deben ser de la misma agencia'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."exchange_rate_id" IS DISTINCT FROM payment_rate_id
     OR NEW."rate" IS DISTINCT FROM payment_rate
     OR NEW."value_date" IS DISTINCT FROM payment_value_date THEN
    RAISE EXCEPTION 'refunds: debe usar la tasa congelada del pago'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."amount_ves" <> round(NEW."amount_usd" * NEW."rate", 2) THEN
    RAISE EXCEPTION 'refunds: amount_ves no corresponde a la tasa congelada'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM("amount_usd"), 0)
    INTO already_refunded
    FROM "refunds"
   WHERE "payment_id" = NEW."payment_id";

  IF already_refunded + NEW."amount_usd" > payment_amount THEN
    RAISE EXCEPTION 'refunds: la suma de reembolsos supera el monto del pago'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "refunds_limit_sum"
  BEFORE INSERT ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_limit_sum"();

-- ----------------------------------------------------------------------------
-- Coherencia de tenant: las FK no respetan RLS y no comparan tenant_id. El
-- trigger impide colgar una línea, un pago o un documento de otra agencia, y
-- exige que el pago lo reporte el dueño de la reserva.
-- ----------------------------------------------------------------------------
CREATE FUNCTION "booking_items_tenant_coherence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bookings" b
     WHERE b."id" = NEW."booking_id" AND b."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'booking no pertenece a la agencia de la línea'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "products" p
     WHERE p."id" = NEW."product_id" AND p."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'product no pertenece a la agencia de la línea'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_items_tenant_coherence"
  BEFORE INSERT OR UPDATE ON "booking_items"
  FOR EACH ROW EXECUTE FUNCTION "booking_items_tenant_coherence"();

CREATE FUNCTION "payments_tenant_coherence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bookings" b
     WHERE b."id" = NEW."booking_id"
       AND b."tenant_id" = NEW."tenant_id"
       AND b."user_id" = NEW."reported_by"
  ) THEN
    RAISE EXCEPTION 'el pago debe ser de la reserva y del dueño que lo reporta'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "exchange_rates" er
     WHERE er."id" = NEW."exchange_rate_id"
       AND (er."tenant_id" IS NULL OR er."tenant_id" = NEW."tenant_id")
  ) THEN
    RAISE EXCEPTION 'la tasa del pago debe ser global o de la agencia'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_tenant_coherence"
  BEFORE INSERT OR UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_tenant_coherence"();

CREATE FUNCTION "documents_tenant_coherence"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bookings" b
     WHERE b."id" = NEW."booking_id" AND b."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'booking no pertenece a la agencia del documento'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."payment_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "payments" p
     WHERE p."id" = NEW."payment_id"
       AND p."tenant_id" = NEW."tenant_id"
       AND p."booking_id" = NEW."booking_id"
  ) THEN
    RAISE EXCEPTION 'payment no pertenece a la reserva y agencia del documento'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."refund_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "refunds" r
     WHERE r."id" = NEW."refund_id"
       AND r."tenant_id" = NEW."tenant_id"
       AND r."booking_id" = NEW."booking_id"
  ) THEN
    RAISE EXCEPTION 'refund no pertenece a la reserva y agencia del documento'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_tenant_coherence"
  BEFORE INSERT OR UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "documents_tenant_coherence"();

-- ----------------------------------------------------------------------------
-- Row-Level Security. caribe_app conecta como NOBYPASSRLS y no es dueña de las
-- tablas; FORCE extiende las políticas al dueño. Sin GUC, current_setting(...,
-- true) devuelve NULL (o cadena vacía tras una transacción) y la comparación
-- excluye la fila: fallo cerrado.
-- ----------------------------------------------------------------------------

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "bookings_tenant_owner" ON "bookings"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR "user_id" = current_setting('app.user_id', true)
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR "user_id" = current_setting('app.user_id', true)
    );

ALTER TABLE "booking_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "booking_items_tenant_owner" ON "booking_items"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "booking_items"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "booking_items"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    );

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "payments_tenant_owner" ON "payments"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR "reported_by" = current_setting('app.user_id', true)
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR "reported_by" = current_setting('app.user_id', true)
    );

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "refunds_tenant_owner" ON "refunds"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "refunds"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "refunds"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    );

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "documents_tenant_owner" ON "documents"
    FOR ALL
    USING (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "documents"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    )
    WITH CHECK (
      "tenant_id" = current_setting('app.tenant_id', true)
      OR EXISTS (
        SELECT 1 FROM "bookings" b
         WHERE b."id" = "documents"."booking_id"
           AND b."user_id" = current_setting('app.user_id', true)
      )
    );

-- Excepción al aislamiento por agencia: la clave es del usuario, no de una
-- agencia, y la agencia se resuelve después de consumirla (design §2.3).
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "idempotency_keys_owner" ON "idempotency_keys"
    FOR ALL
    USING ("user_id" = current_setting('app.user_id', true))
    WITH CHECK ("user_id" = current_setting('app.user_id', true));

-- Tasas: la agencia lee y escribe sus overrides; toda agencia, el dueño y el
-- catálogo público leen las filas globales; solo rates_global escribe las
-- globales. Plataforma lee todo.
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rates_tenant" ON "exchange_rates"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "exchange_rates_global_read" ON "exchange_rates"
    FOR SELECT
    USING (
      "tenant_id" IS NULL
      AND (
        current_setting('app.tenant_id', true) <> ''
        OR current_setting('app.user_id', true) <> ''
        OR current_setting('app.public', true) = 'on'
      )
    );
CREATE POLICY "exchange_rates_rates_global" ON "exchange_rates"
    FOR ALL
    USING (
      current_setting('app.rates_global', true) = 'on'
      AND "tenant_id" IS NULL
    )
    WITH CHECK (
      current_setting('app.rates_global', true) = 'on'
      AND "tenant_id" IS NULL
    );
CREATE POLICY "exchange_rates_platform" ON "exchange_rates"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

ALTER TABLE "document_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "document_counters_tenant" ON "document_counters"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "document_counters_platform" ON "document_counters"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_logs_tenant" ON "notification_logs"
    FOR ALL
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
CREATE POLICY "notification_logs_platform" ON "notification_logs"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

-- Reembolsos inmutables también a nivel de privilegios para el rol de la
-- aplicación (el trigger cubre a cualquier rol, incluido el dueño).
REVOKE UPDATE, DELETE ON "refunds" FROM caribe_app;
