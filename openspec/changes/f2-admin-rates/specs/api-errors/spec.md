# Delta: api-errors — f2-admin-rates

## ADDED Requirements

### Requirement: Código estable para límite excedido
La tabla de códigos de aplicación SHALL incluir `RATE_LIMITED` con estado HTTP 429 y un título corto
estable, para que los límites de seguridad respondan Problem Details con un `code` que el cliente
pueda reconocer sin depender del mensaje del proveedor. El detalle SHALL ser un mensaje público fijo
que no incluya IP, ruta interna ni número de intentos. Ningún otro código SHALL cambiar de estado.

#### Scenario: Límite excedido
- GIVEN una ruta con límite de peticiones y un cliente que lo supera
- WHEN la API rechaza la petición
- THEN responde 429 con `Content-Type: application/problem+json` y `code = RATE_LIMITED`
- THEN el cuerpo no incluye la IP del cliente, la ruta interna del proveedor ni mensajes internos
