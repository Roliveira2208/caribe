# Delta: catalog — f1-hotels-e2e

## MODIFIED Requirements

### Requirement: Producto unificado
El catálogo SHALL usar un único tipo `products` con `type` y `attributes` (JSONB validado con un
esquema Zod por tipo). El esquema SHALL rechazar claves desconocidas. En F1 el único tipo implementado
es `hotel`; los demás tipos quedan fuera de alcance.

Cada fila de `products` SHALL ser un tipo de habitación vendible de un hotel, identificado por
`room_type` (código estable en minúsculas) y agrupado por `hotel_key` (UUID del hotel). El título SHALL
ser el del hotel y la descripción la del tipo de habitación, ambos en JSONB `es`/`en`. No existe una
tabla `hotels` separada en F1: los datos de hotel (`stars`, `amenities`, `images`) se repiten en cada
tipo. La normalización en una tabla `hotels` queda como deuda conocida para F2.

#### Scenario: Atributos inválidos
- WHEN un proveedor guarda un tipo de habitación sin `attributes.stars` requerido por su esquema
- THEN 422 con el campo en falta

#### Scenario: Clave desconocida en los atributos
- WHEN un proveedor guarda un tipo de habitación con una clave que el esquema no declara
- THEN 422 con el campo desconocido señalado

### Requirement: Búsqueda y filtros
`GET /products` SHALL filtrar por `destinationId`, fechas (`checkIn`, `checkOut`), personas (`guests`) y
tipo, con búsqueda opcional `q` sobre el título i18n y paginación por cursor. Cada resultado SHALL ser
una oferta de un tipo de habitación (`roomType`, `hotelKey`); la web MAY agruparlas por `hotelKey`. El
orden SHALL ser explícito y estable: precio ascendente y, a igualdad, identificador ascendente. El
cursor SHALL ser opaco y codificar la última fila devuelta; el tamaño de página por defecto SHALL ser
20 y el máximo 50. La estancia SHALL cubrir las noches `[checkIn, checkOut)` en `America/Caracas`; la
noche de salida no se ocupa.

#### Scenario: Filtro por destino y fechas
- WHEN se busca "Mérida" del 10 al 15 con 2 personas
- THEN solo vuelven productos con una fila de disponibilidad por cada noche del rango y capacidad
  suficiente para 2 personas

#### Scenario: Una noche sin cupo
- GIVEN un producto con cupo en todas las noches menos una del rango
- WHEN se busca ese rango
- THEN el producto no aparece

#### Scenario: Sin resultados
- WHEN ningún producto coincide
- THEN 200 con lista vacía

#### Scenario: Paginación sin duplicados ni huecos
- GIVEN un resultado de más de una página con el mismo orden
- WHEN se recorre con el cursor hasta el final
- THEN ningún producto se repite y no falta ninguno

#### Scenario: Cursor inválido
- WHEN el cursor no se puede decodificar o no corresponde al orden solicitado
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Límite fuera de rango
- WHEN `limit` es menor que 1 o mayor que 50
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Personas por encima de la capacidad
- GIVEN un tipo de habitación con `maxGuests` 2
- WHEN se busca para 3 personas
- THEN el tipo de habitación no aparece

### Requirement: Precios
Los precios SHALL almacenarse en USD; el VES mostrado SHALL ser informativo (USD × tasa vigente,
redondeo half-up a 2 decimales). El servidor SHALL calcular siempre el precio y el total. Un precio,
monto o tasa enviados por el cliente SHALL rechazarse con 422 `VALIDATION_ERROR`; el servidor SHALL NOT
ignorar esos campos.

#### Scenario: Sin tasa disponible
- GIVEN no hay tasa disponible
- WHEN se lista el catálogo
- THEN se muestran solo precios en USD

#### Scenario: Equivalente en VES
- GIVEN un producto de 100 USD y una tasa vigente de 900,0000
- WHEN se lista el catálogo
- THEN el equivalente informativo es 90000,00 VES

#### Scenario: Precio enviado por el cliente
- WHEN la solicitud de reserva incluye un precio, un monto o una tasa
- THEN 422 con código `VALIDATION_ERROR` y el valor no se usa

### Requirement: Internacionalización de contenido
Título y descripción SHALL guardarse en JSONB con claves `es` y `en`; si falta `en` SHALL mostrarse
`es`. Los nombres de destino y los códigos de amenidades SHALL seguir la misma regla cuando sean
visibles al usuario. Los tipos de habitación SHALL ser códigos estables traducidos por la web en `es` y
`en`; no se guardan cadenas visibles por tipo.

#### Scenario: Falta traducción
- GIVEN un producto sin `en`
- WHEN un usuario navega en inglés
- THEN ve el texto en español

### Requirement: Estados
Los productos SHALL tener los estados `DRAFT`, `PUBLISHED` y `ARCHIVED`, más borrado lógico con
`deleted_at`. Solo los productos `PUBLISHED` y sin borrado lógico SHALL aparecer en el catálogo público
y en su detalle. El personal de la agencia SHALL ver también sus `DRAFT` y `ARCHIVED` en el panel. Un
producto borrado lógicamente SHALL responder 404 en todas las lecturas públicas y del panel.

#### Scenario: Producto en borrador
- WHEN un cliente pide un producto `DRAFT`
- THEN 404

#### Scenario: Producto archivado
- WHEN un cliente pide un producto `ARCHIVED`
- THEN 404

#### Scenario: Producto con borrado lógico
- WHEN un cliente o el panel piden un producto con `deleted_at`
- THEN 404

#### Scenario: El proveedor ve su borrador
- GIVEN un producto `DRAFT` del proveedor
- WHEN el proveedor lo consulta en el panel
- THEN 200

## ADDED Requirements

### Requirement: Atributos de hotel
El esquema de hotel SHALL exigir `stars` (entero de 1 a 5) y `maxGuests` (entero de 1 a 20), y SHALL
aceptar `amenities` (lista de códigos estables, máximo 30) e `images` (lista de URLs, máximo 10). Cada
imagen SHALL ser una URL `https` absoluta cuyo dominio esté en la lista de dominios permitidos; no se
aceptan rutas locales, `data:` ni otros esquemas. Las imágenes SHALL usarse en el orden recibido y su
texto alternativo accesible SHALL ser el título del producto. `stars`, `amenities` e `images` son del
hotel y se repiten en cada tipo de habitación; `maxGuests` es la ocupación del tipo.

#### Scenario: Hotel válido
- WHEN un proveedor guarda un tipo de habitación de un hotel con 4 estrellas, 2 personas, 5 amenidades y 3 imágenes `https` de un dominio permitido
- THEN 201 y el producto queda en `DRAFT`

#### Scenario: Más de diez imágenes
- WHEN un proveedor envía 11 imágenes
- THEN 422 con el campo `attributes.images` señalado

#### Scenario: Imagen con esquema no permitido
- WHEN una imagen usa `http://`, `data:` o una ruta relativa
- THEN 422 con el campo `attributes.images` señalado

#### Scenario: Imagen de un dominio no permitido
- WHEN una imagen apunta a un dominio fuera de la lista permitida
- THEN 422 con el campo `attributes.images` señalado

#### Scenario: Estrellas o capacidad fuera de rango
- WHEN `stars` es 0 o 6, o `maxGuests` es 0 o 21
- THEN 422 con el campo señalado

### Requirement: Disponibilidad por noche
La disponibilidad SHALL guardarse en una fila por `(product_id, night)` con `capacity`, `reserved` y
`price_usd` por noche. `capacity` y `reserved` SHALL contarse en habitaciones del producto, y `quantity`
de una reserva SHALL expresarse en habitaciones. `room_type` SHALL ser un código estable en minúsculas
en `products`; un mismo `hotel_key` SHALL agrupar como máximo 5 productos (el límite se valida en el
panel, no en la base). La noche SHALL ser una fecha calendario en `America/Caracas`. Una estancia SHALL
cubrir las noches `[checkIn, checkOut)`: la noche de salida no se ocupa. Un producto SHALL estar
disponible para un rango cuando exista una fila para cada noche del rango y en todas se cumpla
`reserved + quantity <= capacity`. El total SHALL ser la suma de `price_usd_de_la_noche × quantity` de
todas las noches; con precio constante equivale a `precio por noche × habitaciones × noches`. La base
SHALL imponer `UNIQUE (product_id, night)`, `reserved >= 0`, `reserved <= capacity` y
`price_usd > 0`. Las fechas SHALL ser válidas (`checkIn < checkOut`), no pasadas y con un máximo de 30
noches.

#### Scenario: Hay cupo en todas las noches
- GIVEN un producto con capacity 5 y reserved 3 en cada noche del rango
- WHEN se consulta disponibilidad para quantity 2
- THEN el producto está disponible

#### Scenario: Falta una noche
- GIVEN un rango con una noche sin fila de disponibilidad para el producto
- WHEN se consulta la disponibilidad
- THEN 409 con código `AVAILABILITY_UNAVAILABLE`

#### Scenario: Una noche sin cupo
- GIVEN un producto con capacity 5 y reserved 4 en una de las noches
- WHEN se consulta disponibilidad para quantity 2
- THEN el producto no está disponible en ese rango

#### Scenario: Noche duplicada
- WHEN un proveedor intenta crear dos filas para el mismo producto y noche
- THEN 409 con código `AVAILABILITY_DUPLICATED` y solo existe una fila

#### Scenario: Precio o fechas inválidos
- WHEN `price_usd` es 0 o negativo, `checkIn` es igual o posterior a `checkOut`, o las fechas son pasadas
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Estancia demasiado larga
- WHEN el rango supera 30 noches
- THEN 422 con código `VALIDATION_ERROR`

#### Scenario: Total por noche y habitación
- GIVEN un precio de 100 USD por noche y una reserva de 2 habitaciones del producto para 3 noches
- WHEN se crea la reserva
- THEN el total es 600,00 USD

#### Scenario: Precio distinto por noche
- GIVEN precios de 100, 120 y 90 USD en tres noches y una habitación
- WHEN se crea la reserva
- THEN el total es 310,00 USD

### Requirement: Detalle y disponibilidad públicos
`GET /products/:id` y `GET /products/:id/availability` SHALL ser públicos para productos `PUBLISHED` y
sin borrado lógico. El detalle SHALL incluir `roomType`, `hotelKey`, los atributos de hotel, las imágenes
y el destino; la disponibilidad SHALL devolver las noches del producto con cupo restante
(`capacity - reserved`) y el precio de cada noche. La respuesta pública SHALL NOT incluir `capacity` ni
`reserved` exactos, solo `remaining`. Un producto no público SHALL responder 404, no 403.

#### Scenario: Detalle de un producto publicado
- WHEN un visitante anónimo pide un producto `PUBLISHED`
- THEN 200 con `roomType`, `hotelKey`, atributos, imágenes y precio en USD

#### Scenario: Disponibilidad de un producto publicado
- WHEN un visitante anónimo pide la disponibilidad de un producto `PUBLISHED`
- THEN 200 con las noches del producto y el cupo restante de cada una, sin `capacity` ni `reserved`

#### Scenario: Detalle de un producto no público
- WHEN un visitante anónimo pide un producto `DRAFT`, `ARCHIVED` o borrado
- THEN 404

### Requirement: Lectura pública entre agencias
El contexto público SHALL ver los productos `PUBLISHED` y sin borrado lógico de todas las agencias, no
solo de una. La respuesta pública SHALL limitarse a los campos de catálogo (título, descripción, `roomType`,
`hotelKey`, atributos, imágenes, destino, precio y disponibilidad) y SHALL NOT exponer datos internos de
la agencia, del proveedor ni de otras tablas. El contexto público SHALL ser de solo lectura.

#### Scenario: Catálogo de dos agencias
- GIVEN productos publicados de las agencias A y B
- WHEN un visitante anónimo lista el catálogo
- THEN aparecen los productos de ambas agencias

#### Scenario: Sin datos internos
- WHEN un visitante anónimo pide el detalle de un producto
- THEN la respuesta no incluye identificadores de membresía, contactos del proveedor ni ajustes de la agencia

#### Scenario: Escritura anónima
- WHEN un visitante anónimo intenta crear o modificar un producto o una disponibilidad
- THEN 401

## Casos límite
- Precio <= 0 → 422. Dos filas para el mismo producto y noche → 409 `AVAILABILITY_DUPLICATED`.
- Imágenes: máximo 10 por producto, URLs `https` de dominios permitidos; la UI las sirve con
  `next/image`.
- Un producto sin disponibilidad se muestra en el catálogo pero no se puede reservar.
- Un `destinationId` inexistente devuelve lista vacía, no 404.
- La noche de salida no se ocupa ni se cobra; una estancia de una noche ocupa solo `checkIn`.

## Acceptance
- Índices `products (tenant_id, type, destination_id, status)`, `products (type, destination_id, status,
  deleted_at)` y `availability (night, product_id)` presentes, con único por producto y noche.
- Prueba de lectura pública con productos de dos agencias y de que un borrador no aparece.
- Pruebas de validación de atributos e imágenes con el esquema Zod compartido.
- Prueba del total con precios constantes y con precios distintos por noche.

## Out of scope
Reseñas, mapas, recomendaciones, precios dinámicos, tours, paquetes y vuelos. Búsqueda por texto
completo o ranking; en F1 `q` es una coincidencia simple sobre el título i18n. Calendario de tarifas
por temporada y cierre de ventas por fecha.
