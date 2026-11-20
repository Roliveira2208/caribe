# Delta: exchange-rates — public-rate-and-price-filters

## ADDED Requirements

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
