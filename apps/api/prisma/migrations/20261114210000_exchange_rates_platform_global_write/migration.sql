-- T-F1-5: el Super Admin (contexto `platform`) fija overrides globales de tasa.
--
-- Antes `exchange_rates_platform` era solo FOR SELECT: plataforma leía todas las
-- filas pero no podía escribir. Ahora:
--   - lectura: plataforma sigue viendo todas las agencias y las filas globales;
--   - escritura: solo INSERT/UPDATE de filas globales (`tenant_id IS NULL`).
-- Sin DELETE (las tasas no se borran) y sin escritura de filas de agencia: el
-- job BCV conserva `exchange_rates_rates_global` y ninguno de los dos contextos
-- puede tocar filas de agencia.

DROP POLICY "exchange_rates_platform" ON "exchange_rates";

CREATE POLICY "exchange_rates_platform_read" ON "exchange_rates"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

CREATE POLICY "exchange_rates_platform_insert" ON "exchange_rates"
    FOR INSERT
    WITH CHECK (
      current_setting('app.platform', true) = 'on'
      AND "tenant_id" IS NULL
    );

CREATE POLICY "exchange_rates_platform_update" ON "exchange_rates"
    FOR UPDATE
    USING (
      current_setting('app.platform', true) = 'on'
      AND "tenant_id" IS NULL
    )
    WITH CHECK (
      current_setting('app.platform', true) = 'on'
      AND "tenant_id" IS NULL
    );
