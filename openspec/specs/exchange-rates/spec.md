# Exchange Rates Specification

## Purpose
Obtener la tasa BCV del día, mostrar equivalentes en VES y congelar la tasa al pagar.

## Requirements

### Requirement: Fuente y respaldo de la tasa
El sistema SHALL obtener la tasa oficial del BCV mediante `ExchangeRateProvider` contra Cotizave
(`GET /v2/fx/VE/rates`, tasa `ve-bcv`, cabecera `X-API-Key` con `COTIZAVE_API_KEY`) y, si falla o no
está configurado, usar la última tasa válida guardada. La consulta SHALL ser perezosa y como máximo una
vez al día: se comprueba al crear una sesión (login) y antes de crear un pago, y solo se llama al
proveedor si no existe una fila global de `exchange_rates` consultada ese día (`fetched_at` en
`America/Caracas`). No SHALL existir un trabajo programado que consulte la tasa. La consulta del login
SHALL ejecutarse en segundo plano y SHALL NOT bloquear ni hacer fallar el login. La llamada al proveedor
SHALL tener un tiempo máximo de 5 segundos, un reintento y un circuit breaker que se abre tras 3 fallos
consecutivos y se reintenta a los 60 segundos. La tasa SHALL recibirse y parsearse como texto decimal,
con más de 0 y como máximo 4 decimales; un valor inválido SHALL rechazarse. `value_date` SHALL
expresarse en la zona `America/Caracas`; `fetched_at` SHALL guardarse en UTC. La fila global escrita por
el proveedor SHALL llevar `source = 'COTIZAVE'`.

#### Scenario: Fuente disponible
- GIVEN Cotizave responde con una tasa válida para `ve-bcv`
- WHEN un usuario inicia sesión y no hay una tasa consultada hoy
- THEN se guarda la fila global con `source = 'COTIZAVE'`, su `value_date` y `fetched_at` de hoy, y el login no espera la respuesta

#### Scenario: Fuente caída
- GIVEN Cotizave no responde dentro de 5 s o falta `COTIZAVE_API_KEY`
- WHEN un usuario inicia sesión o se crea un pago
- THEN el login responde igual, se registra una advertencia y se usa la última tasa guardada

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
La comprobación de "una vez al día" SHALL usar la fecha de consulta (`fetched_at`), no la `value_date`,
para no repetir la llamada el sábado y el domingo.

#### Scenario: Sábado
- GIVEN la última tasa publicada es del viernes y no hay una fila consultada hoy
- WHEN el sábado se consulta la tasa y el domingo un usuario inicia sesión
- THEN el sábado se guarda la tasa del viernes con `fetched_at` del sábado y el domingo no se llama al proveedor: se sigue usando esa tasa

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
- WHEN el refresco perezoso obtiene una tasa nueva del proveedor para esa misma fecha
- THEN el override se conserva y la tasa del proveedor no lo sobrescribe

#### Scenario: Override global
- GIVEN un Super Admin
- WHEN fija una tasa global con motivo
- THEN se guarda con `tenant_id` NULL y queda auditada

#### Scenario: Override global gana a la tasa BCV
- GIVEN una tasa BCV global de 900,0000 y un override global de 920,0000 para la misma fecha
- WHEN una agencia sin override propio pide la tasa
- THEN se usa 920,0000

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

### Requirement: Lectura pública de la tasa vigente
El sistema SHALL ofrecer una lectura anónima de la tasa global vigente que devuelva su texto decimal y
su fecha valor efectiva, sin exigir sesión, sin consultar al proveedor externo y sin exponer tasas de
agencia. Cuando no exista tasa global SHALL responder 200 indicando que no hay tasa disponible, en vez
de 503, para que la web pueda mostrar solo USD.

#### Scenario: Visitante sin sesión
- GIVEN una tasa global vigente de 36.0000 con fecha valor 10/11/2026
- WHEN un visitante sin sesión pide la tasa del día
- THEN responde 200 con `rate` "36.0000" y `valueDate` "2026-11-10", sin datos de agencia

#### Scenario: Feriado o fin de semana
- GIVEN la última tasa global publicada es del viernes y hoy es sábado
- WHEN un visitante pide la tasa del día
- THEN devuelve la tasa del viernes con su fecha valor, no la del sábado, y no llama al proveedor

#### Scenario: Override global
- GIVEN un override global vigente para hoy
- WHEN un visitante pide la tasa del día
- THEN devuelve el override global porque es la misma tasa que usa el catálogo público

#### Scenario: Override de una agencia
- GIVEN la agencia A tiene un override propio y la tasa global es distinta
- WHEN un visitante pide la tasa del día
- THEN devuelve la tasa global; el override de la agencia A no se revela

#### Scenario: Sin tasa global
- GIVEN no existe ninguna fila global de tasa
- WHEN un visitante pide la tasa del día
- THEN responde 200 con `available: false`, `rate: null` y `valueDate: null`

#### Scenario: Consulta perezosa
- GIVEN no se ha consultado la tasa hoy y el proveedor está configurado
- WHEN un visitante pide la tasa del día
- THEN no se llama al proveedor ni se escribe ninguna fila

#### Scenario: Visitante con sesión de agencia
- GIVEN un visitante autenticado en la agencia A con override propio
- WHEN pide la tasa del día
- THEN recibe la misma lectura global y en texto decimal que un visitante anónimo, sin `fetched_at`

### Requirement: Refresco perezoso de la tasa
El refresco SHALL comprobarse al crear una sesión y antes de crear un pago. Si la fila global más
reciente se consultó hoy (`fetched_at` en `America/Caracas`), SHALL NOT llamarse al proveedor. Si se
llama y falla, la fila guardada SHALL conservarse y el flujo SHALL continuar. El refresco SHALL NOT
pisar una fila `is_override` de la fecha y SHALL NOT escribir overrides de agencia. Varias
comprobaciones simultáneas en el mismo proceso SHALL compartir una sola llamada al proveedor.

#### Scenario: Segundo login del mismo día no consulta
- GIVEN una fila global consultada hoy
- WHEN otro usuario inicia sesión el mismo día
- THEN no se llama al proveedor y se usa la fila guardada

#### Scenario: Alta de pago asegura la tasa del día
- GIVEN una sesión abierta desde ayer y sin una fila global consultada hoy
- WHEN el cliente crea un pago
- THEN antes de congelar la tasa se consulta al proveedor y el pago usa la tasa del día

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

#### Scenario: El refresco de la tasa no escribe overrides
- GIVEN el contexto `rates_global`
- WHEN el refresco intenta escribir una fila con `tenant_id` de una agencia
- THEN la base rechaza la escritura y el override queda intacto

## Casos límite
- Tasa <= 0 o con más de 4 decimales de entrada → se rechaza la respuesta del proveedor.
- Redondeo: half-up a 2 decimales en VES; la tasa se guarda con 4 decimales (DECIMAL 18,4).
- En catálogo el VES es informativo y usa la tasa vigente; solo el pago la congela.

## Acceptance
- Tests unitarios del cálculo con casos de redondeo; test del respaldo con el proveedor simulado caído.

## Out of scope
Tasa paralela o cripto. Histórico gráfico de tasas.
