-- T-F1-9: el Super Admin (contexto `platform`) lee las tablas de negocio de
-- todas las agencias.
--
-- La spec tenant-isolation exige que el contexto `platform` "vea todas las
-- agencias y las filas de plataforma" y que escriba únicamente overrides
-- globales de `exchange_rates`. Las tablas del catálogo y `audit_logs` ya
-- tenían su política `*_platform`; las de reservas, pagos, reembolsos y
-- documentos nacieron en T-F1-1c sin ella, así que el panel de pagos no podía
-- leer nada sin agencia activa.
--
-- Se añade SOLO SELECT: sin INSERT/UPDATE/DELETE, el contexto de plataforma no
-- puede modificar reservas, pagos, reembolsos ni documentos de una agencia. La
-- escritura sigue siendo del personal de la agencia (`app.tenant_id`) o del
-- dueño (`app.user_id`).

CREATE POLICY "bookings_platform" ON "bookings"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

CREATE POLICY "booking_items_platform" ON "booking_items"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

CREATE POLICY "payments_platform" ON "payments"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

CREATE POLICY "refunds_platform" ON "refunds"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');

CREATE POLICY "documents_platform" ON "documents"
    FOR SELECT
    USING (current_setting('app.platform', true) = 'on');
