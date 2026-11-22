# api-errors Specification

## Purpose
Un contrato único de errores y de serialización para la API versionada. Hoy cada módulo improvisa
respuestas; sin un formato estable el frontend no puede distinguir un cupo agotado de un error de
validación, y sin reglas de dinero los montos se cuelan como números de punto flotante. Esta spec fija
el formato, los códigos y la frontera con Better Auth. En F1 se limita a lo que consumen catálogo,
reservas, pagos, tasas y documentos.

## Requirements

### Requirement: Problem Details
Los errores de `/api/v1/*` SHALL responder `application/problem+json` con los campos `type`, `title`,
`status`, `detail`, `instance` y un `code` de aplicación estable. Los errores de validación SHALL
incluir `errors`, una lista de `{ path, message }` con la ruta del campo. Las rutas de `/api/auth/*`
SHALL conservar el formato de Better Auth; el código `TWO_FACTOR_REQUIRED` se mantiene como excepción
documentada.

#### Scenario: Error de validación
- WHEN una solicitud envía un cuerpo inválido
- THEN 422 con `code = VALIDATION_ERROR` y una lista `errors` con el campo en falta

#### Scenario: Recurso inexistente
- WHEN se pide un recurso que no existe o es de otra agencia
- THEN 404 con `code = NOT_FOUND`

#### Scenario: Sin sesión
- WHEN una ruta protegida se llama sin cookie de sesión
- THEN 401 con `code = UNAUTHENTICATED`

#### Scenario: Sin permiso
- WHEN un rol sin permiso llama a una operación
- THEN 403 con `code = FORBIDDEN`

### Requirement: Códigos estables
La API SHALL usar los códigos estables de la tabla siguiente. Un código SHALL NOT cambiar de significado
ni reutilizarse para otra causa. Los códigos nuevos SHALL añadirse a esta spec antes de usarse.

| Código | HTTP | Causa |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Cuerpo, query o parámetros inválidos, o campo calculado enviado por el cliente |
| `UNAUTHENTICATED` | 401 | Falta sesión |
| `FORBIDDEN` | 403 | Rol sin permiso |
| `NOT_FOUND` | 404 | Recurso inexistente o de otro ámbito |
| `ACTIVE_ORGANIZATION_REQUIRED` | 403 | Operación de agencia sin agencia activa |
| `TWO_FACTOR_REQUIRED` | 403 | Rol administrativo sin TOTP (formato de Better Auth) |
| `PRODUCT_INACTIVE` | 409 | Producto no publicado o borrado |
| `AVAILABILITY_UNAVAILABLE` | 409 | Falta una noche o no hay fila de disponibilidad |
| `AVAILABILITY_EXHAUSTED` | 409 | Cupo insuficiente en alguna noche |
| `AVAILABILITY_DUPLICATED` | 409 | Dos filas para el mismo producto, tipo y noche |
| `HOLD_EXPIRED` | 410 | Reserva vencida |
| `BOOKING_CANCELLED` | 409 | Reserva cancelada |
| `BOOKING_ALREADY_PAID` | 409 | Reserva ya confirmada |
| `PAYMENT_IN_REVIEW` | 409 | Cancelación con pago en revisión |
| `PAYMENT_ALREADY_REVIEWED` | 409 | Revisión concurrente perdida |
| `INVALID_STATE_TRANSITION` | 409 | Transición de estado no permitida |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Falta `Idempotency-Key` |
| `INVALID_PATH` | 400 | Ruta de archivo inválida o fuera del directorio permitido |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Misma clave, otro cuerpo |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Clave aún en proceso |
| `DUPLICATE_PAYMENT_REFERENCE` | 409 | Referencia repetida en la agencia y método |
| `REFUND_ALREADY_ISSUED` | 409 | Segundo reembolso sobre el mismo pago |
| `RATE_UNAVAILABLE` | 503 | Sin tasa vigente ni respaldo |
| `DOCUMENT_PENDING` | 409 | Documento aún en generación |
| `DOCUMENT_UNAVAILABLE` | 503 | Documento fallido |
| `PAYLOAD_TOO_LARGE` | 413 | Cuerpo de la solicitud demasiado grande |
| `METHOD_NOT_ALLOWED` | 405 | Método HTTP no permitido para la ruta |
| `CONFLICT` | 409 | Conflicto sin un código de dominio más específico |
| `INTERNAL_ERROR` | 500 | Fallo inesperado |

#### Scenario: Cupo agotado
- WHEN dos reservas compiten por el último cupo
- THEN la perdedora responde 409 con `code = AVAILABILITY_EXHAUSTED`

#### Scenario: Reserva vencida
- WHEN se intenta pagar una reserva `EXPIRED`
- THEN 410 con `code = HOLD_EXPIRED`

#### Scenario: Sin tasa
- WHEN no hay tasa disponible
- THEN 503 con `code = RATE_UNAVAILABLE`

### Requirement: Validación con esquemas compartidos
La API SHALL validar cuerpo, query y parámetros con los esquemas Zod de `packages/shared`. Los esquemas
SHALL ser estrictos: una clave desconocida SHALL responder 422. La validación SHALL ejecutarse antes de
la lógica de negocio. Los campos que calcula el servidor (`tenant_id`, `user_id`, `total_usd`,
`amount_usd`, `amount_ves`, `rate`, `code`, estados y fechas derivadas) SHALL NOT declararse en los
esquemas de entrada; enviarlos SHALL responder 422 `VALIDATION_ERROR` y su valor SHALL NOT usarse. El
servidor SHALL NOT ignorar campos calculados.

#### Scenario: Campo desconocido
- WHEN el cuerpo incluye `cardNumber` o un campo que el esquema no declara
- THEN 422 con `code = VALIDATION_ERROR` y la ruta del campo

#### Scenario: Monto, tasa o campo calculado enviado por el cliente
- WHEN el cuerpo incluye `amount_usd`, `amount_ves`, `total_usd`, `rate`, `tenant_id`, `user_id` o `code`
- THEN 422 con `code = VALIDATION_ERROR` y el valor no se usa

#### Scenario: Query o parámetro inválido
- WHEN `limit` está fuera de rango o un `:id` no tiene el formato esperado
- THEN 422 con `code = VALIDATION_ERROR`

### Requirement: Serialización de dinero y fechas
Los montos SHALL serializarse como cadenas con 2 decimales y las tasas como cadenas con 4 decimales. El
servidor SHALL NOT usar números de punto flotante para dinero. Las marcas de tiempo SHALL serializarse
en ISO 8601 UTC; `value_date` SHALL serializarse como `YYYY-MM-DD` en `America/Caracas`.

#### Scenario: Monto con dos decimales
- WHEN se devuelve un pago
- THEN `amount_usd` es `"100.00"` y `amount_ves` es `"90000.00"`

#### Scenario: Tasa con cuatro decimales
- WHEN se devuelve una tasa
- THEN `rate` es `"900.0000"`

#### Scenario: Fecha valor
- WHEN se devuelve una tasa
- THEN `value_date` es `"2026-11-10"` y no incluye hora

#### Scenario: Marca de tiempo
- WHEN se devuelve `created_at`
- THEN es una cadena ISO 8601 en UTC terminada en `Z`

### Requirement: Mapeo y no filtración
Una excepción de dominio SHALL mapearse a su estado y código de la tabla. Un error inesperado SHALL
responder 500 con `code = INTERNAL_ERROR`, sin mensaje interno, sin traza, sin SQL y sin nombres de
tabla; el detalle SHALL quedar en el log del servidor con un identificador de correlación que también
viaje en la respuesta. Un recurso de otro ámbito SHALL responder 404, no 403, para no revelar su
existencia.

#### Scenario: Error inesperado
- WHEN una consulta lanza un error no controlado
- THEN 500 con `code = INTERNAL_ERROR` y un identificador de correlación, sin detalles internos

#### Scenario: Recurso de otra agencia
- WHEN se pide un recurso de otra agencia
- THEN 404 con `code = NOT_FOUND`

#### Scenario: Sin traza en la respuesta
- WHEN ocurre un error
- THEN la respuesta no contiene `stack`, `sql`, nombres de tabla ni rutas del servidor

## Casos límite

- Una clave desconocida en cuerpo, query o parámetros se rechaza con 422 antes de cualquier efecto.
- Un campo calculado por el servidor nunca se acepta del cliente, aunque el valor sea correcto.
- Los errores de `/api/auth/*` conservan el formato de Better Auth; solo `TWO_FACTOR_REQUIRED` se
  documenta como excepción.
- Un recurso de otra agencia o de otro usuario responde 404, no 403.

## Acceptance

- Todo error de `/api/v1/*` usa `application/problem+json` con `type`, `title`, `status`, `detail`,
  `instance` y `code`.
- La tabla de códigos es la única fuente de códigos estables; ningún código cambia de significado.
- Los esquemas Zod compartidos son estrictos y validan antes de la lógica de negocio.
- Dinero y tasas se serializan como cadenas decimales; nunca como punto flotante.

## Out of scope

- Contratos de errores de Proveedores externos o de Better Auth distintos de `TWO_FACTOR_REQUIRED`.
- Documentación OpenAPI/Swagger y catálogo público de códigos para terceros.
- Cálculo de montos o tasas a partir de datos enviados por el cliente.
