# Delta: exchange-rates — f2-admin-rates

## ADDED Requirements

### Requirement: Panel de tasas
El panel de tasas de `apps/admin` SHALL mostrar la tasa vigente aplicable a la agencia activa y su fecha
valor como texto decimal calculado en el servidor, sin que la UI calcule ni envíe montos. Solo un owner
o admin de agencia con TOTP activo SHALL poder fijar un override de agencia; el Super Admin SHALL tener
solo lectura sobre los datos de negocio de las agencias y SHALL NOT fijar overrides con `tenant_id` de
agencia, pero conserva la fijación de la tasa global de la base con `tenant_id` NULL. Los agentes y
proveedores SHALL ver únicamente la tasa vigente, sin historial ni acciones de override; un `member` sin
permiso SHALL recibir 403 sin filas ni resumen. El formulario SHALL aceptar únicamente `rate` como texto
decimal y `reason`; todo texto visible SHALL salir de mensajes es/en
y los controles SHALL tener etiquetas accesibles y foco visible. Un cuerpo con campos calculados SHALL
responder 422 `VALIDATION_ERROR`.

#### Scenario: Ver tasa vigente
- GIVEN una agencia activa con una tasa vigente y un owner con TOTP activo
- WHEN abre el panel de tasas
- THEN ve la tasa vigente y su fecha valor con el texto decimal del servidor, sin controles de cálculo
- THEN un agente o proveedor ve solo esa tasa vigente, sin historial, motivos ni controles de override
- AND las etiquetas y los mensajes salen de es/en y el foco es visible al navegar con teclado

#### Scenario: Override con motivo desde el panel
- GIVEN un owner o admin de agencia con TOTP activo y una fecha valor
- WHEN fija un `rate` "950.0000" con `reason` "BCV no publicó" desde el panel
- THEN el modal muestra el valor antes y el valor después antes de guardar
- AND se crea el override con `is_override = true` para esa agencia y fecha, con auditoría

#### Scenario: Sin segundo factor
- GIVEN un admin de agencia autenticado sin TOTP activo
- WHEN intenta abrir el panel o enviar un override
- THEN la interfaz lo mantiene en la pantalla de activación de TOTP
- AND la API responde 403 `TWO_FACTOR_REQUIRED` y no se escribe ninguna tasa

#### Scenario: Sin permiso de tasa
- GIVEN un `member` con agencia activa y sin permiso de tasa
- WHEN abre el panel de tasas de la agencia
- THEN responde 403 `FORBIDDEN`, sin filas ni resumen
- AND un Super Admin que intenta fijar un override con `tenant_id` de agencia recibe 403 `FORBIDDEN`

#### Scenario: Confirmación de override vigente
- GIVEN un override vigente de la agencia para la misma fecha valor y un admin con TOTP activo
- WHEN abre el modal para fijar otro `rate` con su `reason`
- THEN el modal muestra antes → después y exige una confirmación explícita adicional antes de escribir
- AND si cancela, no se escribe nada y la tasa vigente queda intacta

#### Scenario: Override de otra agencia
- GIVEN un override de la agencia B
- WHEN un admin de la agencia A intenta verlo o reemplazarlo desde el panel
- THEN responde 404 y el panel de A no muestra la fila ni su motivo

#### Scenario: Auditoría del override
- GIVEN un override fijado desde el panel
- WHEN se consulta su registro en `audit_logs`
- THEN constan el actor, el valor antes y el después, el motivo y la IP de la petición cuando puede resolverse de forma confiable
- AND la IP puede ser null detrás de un proxy no confiable

#### Scenario: Campos calculados del cliente
- GIVEN el formulario de override
- WHEN la petición incluye `amountUsd`, `amountVes`, `amount_ves`, `exchange_rate_id`, una tasa calculada o cualquier otro campo calculado
- THEN responde 422 `VALIDATION_ERROR` y no se escribe la tasa
- AND la UI solo envía `rate` como texto decimal y `reason`

#### Scenario: Membresía revocada
- GIVEN una sesión que conserva `activeOrganizationId` de una agencia cuya membresía fue revocada
- WHEN abre el panel de tasas o envía un override
- THEN responde 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

#### Scenario: Tasa global del Super Admin
- GIVEN un Super Admin con TOTP activo en modo plataforma
- WHEN fija una tasa global con `rate` "920.0000" y `reason`
- THEN se guarda con `tenant_id` NULL y `is_override = true`, con auditoría, según la base
- AND el panel no revela tasas ni motivos de ninguna agencia

#### Scenario: Fecha valor futura
- GIVEN un override fijado para una fecha valor futura
- WHEN se consulta la tasa vigente antes de esa fecha
- THEN el panel muestra la tasa actual y el override como pendiente de esa fecha valor
- AND el override futuro no se aplica ni aparece como vigente antes de la fecha

#### Scenario: Historial de overrides
- GIVEN varios overrides de la agencia activa en fechas distintas
- WHEN un owner o admin con TOTP activo abre el historial del panel
- THEN ve solo los overrides de su agencia, ordenados por fecha valor, con actor, motivo y antes → después
- AND no aparecen overrides de otras agencias ni la tasa global se presenta como override de la agencia
