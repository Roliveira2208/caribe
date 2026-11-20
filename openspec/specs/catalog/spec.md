# Catalog Specification

## Purpose
Catálogo unificado de productos (hotel, tour, paquete, vuelo) con disponibilidad y precios en USD.

## Requirements

### Requirement: Producto unificado
El catálogo SHALL usar un único tipo `products` con `type` y `attributes` (JSONB validado con un esquema Zod por tipo).

#### Scenario: Atributos inválidos
- WHEN un proveedor guarda un hotel sin `attributes.stars` requerido por su esquema
- THEN 422 con el campo en falta

### Requirement: Búsqueda y filtros
`GET /products` SHALL filtrar por destino, fechas, personas y tipo, con paginación por cursor.

#### Scenario: Filtro por destino y fechas
- WHEN se busca "Mérida" del 10 al 15 con 2 personas
- THEN solo vuelven productos con disponibilidad suficiente en esas fechas

#### Scenario: Sin resultados
- WHEN ningún producto coincide
- THEN 200 con lista vacía

### Requirement: Precios
Los precios SHALL almacenarse en USD; el VES mostrado SHALL ser informativo (USD × tasa vigente, 2 decimales).

#### Scenario: Sin tasa disponible
- GIVEN no hay tasa disponible
- WHEN se lista el catálogo
- THEN se muestran solo precios en USD

### Requirement: Internacionalización de contenido
Título y descripción SHALL guardarse en JSONB con claves `es` y `en`; si falta `en` SHALL mostrarse `es`.

#### Scenario: Falta traducción
- GIVEN un producto sin `en`
- WHEN un usuario navega en inglés
- THEN ve el texto en español

### Requirement: Estados
Solo los productos `PUBLISHED` SHALL aparecer en el catálogo público, con borrado lógico.

#### Scenario: Producto en borrador
- WHEN un cliente pide un producto `DRAFT`
- THEN 404

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

## Casos límite
- Precio <= 0 → 422. Fechas de disponibilidad solapadas para el mismo producto → 409.
- Imágenes: máximo 10 por producto, formatos AVIF o WebP servidos con `next/image`.

## Acceptance
- Índices compuestos descritos en el SDD §11 presentes en las migraciones.

## Out of scope
Reseñas, mapas, recomendaciones, precios dinámicos.
