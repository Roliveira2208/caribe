# Delta: catalog — f2-admin-rates

## ADDED Requirements

### Requirement: Gestión del catálogo desde el panel de administración
El panel SHALL usar los endpoints de escritura ya existentes en `apps/api/src/catalog` para alta,
edición, publicación, archivado y disponibilidad; SHALL NOT implementar escrituras propias ni duplicar
la validación de negocio. Un Proveedor SHALL ver y editar solo los productos cuyo registro de proveedor
tiene `providers.user_id` igual a su usuario; un producto ajeno SHALL responder 404 sin revelar si
pertenece a otra agencia o a otro proveedor, según el criterio de no revelación de `tenant-isolation`.
El Admin de agencia SHALL
gestionar los productos de su agencia y el Super Admin SHALL ser de solo lectura: SHALL NOT crear,
editar, publicar ni archivar productos de una agencia. La interfaz SHALL NOT ofrecer acciones que la API
vaya a rechazar.

Los precios SHALL enviarse como texto decimal, nunca como `number`, y SHALL persistirse en columnas
`DECIMAL`; los campos calculados por el cliente (`totalUsd`, `totalVes`, `exchangeRate` o equivalentes)
SHALL rechazarse con 422 `VALIDATION_ERROR`, porque el servidor SHALL calcular siempre importes y tasas.
La disponibilidad SHALL guardarse por `(product_id, night)` con `capacity`, `reserved` y `price_usd`, en
`America/Caracas`; una noche solapada o duplicada SHALL responder 409 con `AVAILABILITY_DUPLICATED` y
SHALL NOT crear una segunda fila. Título y descripción SHALL enviarse en JSONB con `es` y `en` en las
escrituras del panel; la falta de una traducción SHALL responder 422 `VALIDATION_ERROR`, sin contradecir
el fallback a `es` de la spec base en las lecturas públicas. Las etiquetas y mensajes del panel SHALL
salir de los catálogos es/en y todos los controles SHALL ser accesibles por teclado.

#### Scenario: Alta de producto en el panel
- GIVEN un Proveedor con agencia activa, o un Admin de agencia con agencia activa y segundo factor activo
- WHEN da de alta un tipo de habitación en el panel
- THEN el panel llama a los endpoints de escritura existentes de `apps/api/src/catalog` y el producto queda `DRAFT` en su agencia
- AND la UI no implementa escritura propia ni envía campos calculados por el cliente

#### Scenario: Edición de producto de la agencia
- GIVEN un producto `DRAFT` o `PUBLISHED` de la agencia activa
- WHEN el Admin de la agencia edita sus campos desde el panel
- THEN la API existente aplica el cambio tras la validación Zod y la UI refleja el estado devuelto por el servidor
- AND los importes y totales no se calculan ni se envían desde el cliente

#### Scenario: Proveedor edita solo sus productos
- GIVEN un Proveedor con registro en `providers.user_id`
- WHEN edita un producto propio, uno de otro proveedor de su agencia y uno de otra agencia
- THEN el propio responde 200 y tanto el de otro proveedor de la misma agencia como el de otra agencia responden 404, sin revelar a quién pertenecen
- AND el panel no muestra botones de edición sobre productos que la API rechazaría

#### Scenario: Publicar y archivar producto
- GIVEN un producto `DRAFT` de la agencia activa y un Super Admin en modo plataforma
- WHEN el Admin publica, archiva y vuelve a publicar el producto desde el panel
- THEN los endpoints existentes cambian el estado a `PUBLISHED` y `ARCHIVED` y solo `PUBLISHED` aparece en el catálogo público
- AND el Super Admin solo puede listar y leer; publicar o archivar responde 403 y el estado no cambia

#### Scenario: Disponibilidad por noche
- GIVEN un producto con filas de disponibilidad por `(product_id, night)` en `America/Caracas`
- WHEN el panel crea o ajusta una noche ya existente o solapada con cupo y precio
- THEN la noche solapada responde 409 con código `AVAILABILITY_DUPLICATED` y no se crea una segunda fila
- AND cada fila conserva `capacity`, `reserved` y `price_usd` válidos, sin ocupar la noche de salida de la estancia

#### Scenario: Precio como texto decimal
- GIVEN el formulario de producto o de disponibilidad del panel
- WHEN envía `priceUsd` como texto decimal, por ejemplo `"120.50"`, e incluye `totalUsd`, `totalVes` o `exchangeRate` calculados por el cliente
- THEN el precio se acepta como texto decimal y se persiste en `DECIMAL`, nunca como `number`
- AND los campos calculados por el cliente responden 422 `VALIDATION_ERROR` y el servidor calcula siempre totales y equivalentes

#### Scenario: Traducciones es y en
- GIVEN un formulario de alta o edición con `title` y `description` en JSONB
- WHEN falta la clave `en` en cualquiera de los dos campos
- THEN la API responde 422 `VALIDATION_ERROR` y señala el campo sin traducir
- AND con ambas claves el panel muestra el idioma activo y la lectura pública sin `en` cae a `es`, según la spec base
- AND las etiquetas y mensajes salen de los catálogos es/en y los controles son accesibles por teclado
