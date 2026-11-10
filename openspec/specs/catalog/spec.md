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

## Casos límite
- Precio <= 0 → 422. Fechas de disponibilidad solapadas para el mismo producto → 409.
- Imágenes: máximo 10 por producto, formatos AVIF o WebP servidos con `next/image`.

## Acceptance
- Índices compuestos descritos en el SDD §11 presentes en las migraciones.

## Out of scope
Reseñas, mapas, recomendaciones, precios dinámicos.
