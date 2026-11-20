# Delta: catalog — public-rate-and-price-filters

## ADDED Requirements

### Requirement: Filtro de precio en USD
`GET /products` SHALL aceptar los límites opcionales e inclusivos `minPriceUsd` y `maxPriceUsd`. El
precio contrastado SHALL ser el que se muestra en la oferta: el total de la estancia cuando se envían
`checkIn` y `checkOut`, y el precio base en caso contrario. Los límites SHALL aplicarse antes de la
paginación por cursor, sin alterar el orden por precio e identificador ni los equivalentes en VES.

#### Scenario: Rango sin fechas
- GIVEN tres productos publicados a 60, 95 y 120 USD
- WHEN se busca con `minPriceUsd=90` y `maxPriceUsd=120`
- THEN vuelven solo los de 95 y 120 USD, en ese orden

#### Scenario: Rango con fechas
- GIVEN una estancia cuyo total visible es 300 USD
- WHEN se busca con `checkIn`/`checkOut` y `minPriceUsd=250`
- THEN la oferta vuelve; con `minPriceUsd=350` no vuelve

#### Scenario: Un solo extremo
- GIVEN productos a 60, 95 y 120 USD
- WHEN se busca solo con `maxPriceUsd=100`
- THEN vuelve el de 60 y el de 95 USD

#### Scenario: Límites inválidos
- WHEN se busca con `minPriceUsd` mayor que `maxPriceUsd`, con cero, con un negativo o con más de dos decimales
- THEN 422 `VALIDATION_ERROR` con el campo responsable

#### Scenario: Paginación dentro del filtro
- GIVEN 30 productos que cumplen el rango y un límite de página de 20
- WHEN se busca con un rango de precio y se sigue el cursor devuelto
- THEN la segunda página contiene solo productos del mismo rango y el último cursor es `null`

#### Scenario: Sin filtro de precio
- GIVEN la misma búsqueda sin `minPriceUsd` ni `maxPriceUsd`
- WHEN se envía la consulta
- THEN la respuesta es idéntica a la del contrato anterior, sin cambios en orden ni en campos

#### Scenario: Producto sin disponibilidad completa
- GIVEN un producto cuyo precio base está en el rango pero no tiene cupo en todas las noches pedidas
- WHEN se busca con fechas y el rango de precio
- THEN el producto no vuelve y el equivalente VES de los que vuelven usa la misma tasa global de siempre
