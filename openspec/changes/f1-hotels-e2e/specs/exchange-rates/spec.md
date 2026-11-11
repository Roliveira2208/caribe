# Delta: exchange-rates — f1-hotels-e2e

## MODIFIED Requirements

### Requirement: Fuente y respaldo de la tasa
El sistema SHALL obtener la tasa oficial mediante `ExchangeRateProvider` (primaria: DolarAPI) y, si
falla, usar la última tasa válida guardada. La tasa se cachea 1 hora y se refresca una vez al día por un
trabajo programado. La llamada al proveedor SHALL tener un tiempo máximo de 5 segundos, un reintento y
un circuit breaker que se abre tras 3 fallos consecutivos y se reintenta a los 60 segundos. La tasa
SHALL recibirse y parsearse como texto decimal, con más de 0 y como máximo 4 decimales; un valor
inválido SHALL rechazarse. `value_date` SHALL expresarse en la zona `America/Caracas`; `fetched_at`
SHALL guardarse en UTC.

#### Scenario: Fuente disponible
- GIVEN DolarAPI responde con una tasa válida
- WHEN se pide la tasa actual
- THEN se guarda en `exchange_rates` con su `value_date` y se devuelve

#### Scenario: Fuente caída
- GIVEN DolarAPI no responde dentro de 5 s
- WHEN se pide la tasa actual
- THEN se devuelve la última tasa guardada y se registra una advertencia

#### Scenario: Sin ninguna tasa guardada y fuente caída
- GIVEN no existe ninguna tasa
- WHEN se pide la tasa
- THEN la API responde 503 `RATE_UNAVAILABLE` y el checkout en VES queda deshabilitado (USD sigue disponible)

#### Scenario: Tasa inválida del proveedor
- WHEN el proveedor devuelve 0, un número negativo, un valor con más de 4 decimales o un texto no numérico
- THEN se rechaza la respuesta y se usa el respaldo

#### Scenario: Circuit breaker
- GIVEN 3 fallos consecutivos del proveedor
- WHEN llega una nueva solicitud antes de 60 segundos
- THEN no se llama al proveedor y se usa la última tasa guardada

### Requirement: Fines de semana y feriados
El BCV publica una tasa por día hábil; fuera de ellos SHALL usarse la última `value_date` publicada.

#### Scenario: Sábado
- GIVEN la última tasa publicada es del viernes
- WHEN un cliente paga el sábado
- THEN se usa la tasa del viernes y el pago guarda esa `value_date`

#### Scenario: Zona horaria de la fecha valor
- GIVEN un pago a las 21:00 del 10 de noviembre en Caracas
- WHEN se selecciona la tasa
- THEN se usa la tasa con `value_date` 10 de noviembre, no la del 11 en UTC

### Requirement: Ajuste manual
Un Admin de agencia SHALL poder fijar una tasa de su agencia indicando un motivo; queda con
`is_override = true` y en auditoría. El Super Admin SHALL poder fijar una tasa global con
`tenant_id` NULL y el mismo requisito de motivo y auditoría. Un override SHALL ganar para su
`value_date` y su ámbito, y el proveedor SHALL NOT sobrescribirlo. Para una agencia y una fecha SHALL
existir como máximo una fila; para las filas globales la unicidad SHALL aplicarse también aunque
`tenant_id` sea NULL.

#### Scenario: Override con motivo
- WHEN un admin fija 900,0000 con motivo "BCV no publicó"
- THEN se crea la tasa con `is_override` y un registro de auditoría con antes y después

#### Scenario: Override sin motivo o sin permiso
- WHEN falta el motivo, o quien llama no es admin
- THEN 422 en el primer caso y 403 en el segundo

#### Scenario: Precedencia del override
- GIVEN una tasa BCV global de 900,0000 y un override de la agencia A de 950,0000 para la misma fecha
- WHEN la agencia A pide la tasa
- THEN se usa 950,0000; la agencia B sigue usando 900,0000

#### Scenario: El proveedor no pisa el override
- GIVEN un override guardado para una fecha
- WHEN el trabajo diario obtiene una tasa nueva del proveedor para esa misma fecha
- THEN el override se conserva y la tasa del proveedor no lo sobrescribe

#### Scenario: Override global
- GIVEN un Super Admin
- WHEN fija una tasa global con motivo
- THEN se guarda con `tenant_id` NULL y queda auditada

#### Scenario: Override global gana a la tasa BCV
- GIVEN una tasa BCV global de 900,0000 y un override global de 920,0000 para la misma fecha
- WHEN una agencia sin override propio pide la tasa
- THEN se usa 920,0000

## ADDED Requirements

### Requirement: Tenencia de las tasas
`exchange_rates` SHALL tener filas globales con `tenant_id` NULL (tasa BCV) y filas de override con el
`tenant_id` de la agencia. La lectura de una agencia SHALL ver las filas globales y las suyas, nunca las
de otra agencia. La escritura de una agencia SHALL limitarse a sus overrides. El contexto `public` del
catálogo SHALL leer solo las filas globales; los overrides de una agencia SHALL aplicarse al crear el
pago de esa agencia. El contexto `rates_global` SHALL escribir solo filas con `tenant_id` NULL y SHALL
NOT leer ni escribir overrides de agencia ni ninguna otra tabla.

#### Scenario: Agencia no ve el override de otra
- GIVEN overrides de las agencias A y B
- WHEN la agencia A consulta sus tasas
- THEN no ve el override de B

#### Scenario: Catálogo público usa la tasa global
- GIVEN un override de la agencia A y una tasa global distinta
- WHEN un visitante anónimo ve el catálogo
- THEN el equivalente en VES usa la tasa global

#### Scenario: Pago usa el override de la agencia
- GIVEN un producto de la agencia A y un override de A vigente
- WHEN se crea el pago
- THEN el pago usa el override de A

#### Scenario: El trabajo BCV no escribe overrides
- GIVEN el contexto `rates_global`
- WHEN el trabajo diario intenta escribir una fila con `tenant_id` de una agencia
- THEN la base rechaza la escritura y el override queda intacto

### Requirement: Congelar al pagar
Al iniciar un pago SHALL guardarse `exchange_rate_id`, `amount_usd`, `amount_ves` y una copia de
`rate` y `value_date` en el pago. `amount_usd` SHALL ser el total de la reserva y `amount_ves` SHALL ser
`round(amount_usd × rate, 2)` con redondeo half-up. Ese par SHALL NOT recalcularse ni modificarse
después; la base SHALL rechazar cualquier `UPDATE` de esos campos.

#### Scenario: La tasa cambia después
- GIVEN un pago creado con tasa 897,5383
- WHEN el BCV publica una tasa nueva
- THEN el pago conserva 897,5383 y su `amount_ves`

#### Scenario: Cálculo del monto en VES
- GIVEN una reserva de 100,00 USD y una tasa de 900,0000
- WHEN se inicia el pago
- THEN `amount_ves` es 90000,00 y el pago guarda la tasa y la fecha valor

#### Scenario: Redondeo half-up
- GIVEN un monto en USD que produce 0,005 en VES
- WHEN se calcula el monto
- THEN se redondea hacia arriba a 2 decimales

#### Scenario: Modificación directa del par congelado
- GIVEN un pago guardado
- WHEN se intenta actualizar `rate`, `amount_usd`, `amount_ves`, `exchange_rate_id` o `value_date`
- THEN la base rechaza la escritura

#### Scenario: Reembolso con la tasa congelada
- GIVEN un pago con tasa congelada 900,0000
- WHEN se reembolsa el 50 %
- THEN el reembolso usa 900,0000 aunque la tasa vigente sea otra

## Casos límite
- Tasa <= 0 o con más de 4 decimales de entrada → se rechaza la respuesta del proveedor.
- Redondeo: half-up a 2 decimales en VES; la tasa se guarda con 4 decimales (DECIMAL 18,4).
- En catálogo el VES es informativo y usa la tasa global; solo el pago la congela con el override de la
  agencia.
- Sin tasa global no se muestra VES en el catálogo; sin tasa para la agencia no se puede pagar en VES,
  pero sí en USD.
- Un override de una fecha futura no aplica antes de esa fecha.

## Acceptance
- Tests unitarios del cálculo con casos de redondeo; test del respaldo con el proveedor simulado caído.
- Prueba de tenencia: la agencia A no lee el override de B y el catálogo público solo usa la global.
- Prueba de que un `UPDATE` directo del par congelado falla en la base.

## Out of scope
Tasa paralela o cripto. Histórico gráfico de tasas. Overrides por producto. Sincronización en tiempo
real con el BCV.
