# Exchange Rates Specification

## Purpose
Obtener la tasa BCV del día, mostrar equivalentes en VES y congelar la tasa al pagar.

## Requirements

### Requirement: Fuente y respaldo de la tasa
El sistema SHALL obtener la tasa oficial mediante `ExchangeRateProvider` (primaria: DolarAPI) y, si falla,
usar la última tasa válida guardada. La tasa se cachea 1 hora y se refresca una vez al día por un trabajo.

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

### Requirement: Fines de semana y feriados
El BCV publica una tasa por día hábil; fuera de ellos SHALL usarse la última `value_date` publicada.

#### Scenario: Sábado
- GIVEN la última tasa publicada es del viernes
- WHEN un cliente paga el sábado
- THEN se usa la tasa del viernes y el pago guarda esa `value_date`

### Requirement: Ajuste manual
Un Admin de agencia SHALL poder fijar una tasa indicando un motivo; queda con `is_override = true` y en auditoría.

#### Scenario: Override con motivo
- WHEN un admin fija 900,0000 con motivo "BCV no publicó"
- THEN se crea la tasa con `is_override` y un registro de auditoría con antes y después

#### Scenario: Override sin motivo o sin permiso
- WHEN falta el motivo, o quien llama no es admin
- THEN 422 en el primer caso y 403 en el segundo

### Requirement: Congelar al pagar
Al iniciar un pago SHALL guardarse `exchange_rate_id` y `amount_ves = round(amount_usd × rate, 2)`; ese par no cambia.

#### Scenario: La tasa cambia después
- GIVEN un pago creado con tasa 897,5383
- WHEN el BCV publica una tasa nueva
- THEN el pago conserva 897,5383 y su `amount_ves`

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

## Casos límite
- Tasa <= 0 o con más de 4 decimales de entrada → se rechaza la respuesta del proveedor.
- Redondeo: half-up a 2 decimales en VES; la tasa se guarda con 4 decimales (DECIMAL 18,4).
- En catálogo el VES es informativo y usa la tasa vigente; solo el pago la congela.

## Acceptance
- Tests unitarios del cálculo con casos de redondeo; test del respaldo con el proveedor simulado caído.

## Out of scope
Tasa paralela o cripto. Histórico gráfico de tasas.
