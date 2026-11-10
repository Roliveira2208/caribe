# Inventory Providers Specification

## Purpose
Aislar inventario propio y proveedores externos (Duffel, LiteAPI) tras `InventoryProvider`.

## Requirements

### Requirement: Interfaz común
`InventoryProvider` SHALL ofrecer `search`, `getDetails`, `checkAvailability`, `hold`, `confirm` y `cancel`
con ofertas normalizadas al modelo de producto.

#### Scenario: Búsqueda mezclada
- WHEN se busca en un destino
- THEN `InventoryModule` combina resultados de los proveedores activos y del inventario propio

### Requirement: Tolerancia a fallos
Las llamadas externas SHALL tener tiempo máximo de 5 s, un reintento y circuit breaker; el inventario propio
SHALL seguir disponible si un proveedor falla.

#### Scenario: Duffel no responde
- GIVEN Duffel excede 5 s
- WHEN se busca un vuelo
- THEN se devuelven los resultados propios y se registra el fallo

### Requirement: Sandbox y credenciales
Duffel (token `duffel_test_`) y LiteAPI (clave sandbox) SHALL usarse solo en modo de pruebas, con las
credenciales en variables de entorno.

#### Scenario: Falta la credencial
- GIVEN no hay token configurado
- WHEN arranca la API
- THEN el adaptador queda desactivado sin impedir el arranque

## Casos límite
- Respuesta del proveedor con precio en otra moneda → se descarta la oferta y se registra.
- Rate limit del sandbox (LiteAPI: 5 solicitudes por segundo) → cola con espera.

## Acceptance
- Pruebas de contrato con respuestas grabadas; los adaptadores externos son opcionales y apagados por defecto.

## Out of scope
Emisión real de boletos, pagos a través del proveedor, otros agregadores.
