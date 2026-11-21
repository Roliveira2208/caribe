# Delta: catalog — catalog-public-cancellation-policy

## ADDED Requirements

### Requirement: Política de cancelación pública
El detalle público SHALL incluir `cancellationPolicy` con `name` y `rules` cuando el producto
`PUBLISHED` tenga una política asociada, y `null` cuando no la tenga. Cada regla SHALL usar
`hoursBefore` y `percentage`, con `hoursBefore` entero no negativo y `percentage` entero entre 0 y
100, ordenadas de mayor a menor horas. La respuesta SHALL NOT exponer identificadores internos,
`tenantId`, fechas de auditoría, JSONB crudo ni políticas vinculadas solo a productos no públicos.

#### Scenario: Detalle con política
- GIVEN un producto `PUBLISHED` con una política de 48 horas al 100 % y 24 horas al 50 %
- WHEN se pide `GET /products/:id`
- THEN `cancellationPolicy` contiene `name` y `rules` con `[{ hoursBefore: 48, percentage: 100 }, { hoursBefore: 24, percentage: 50 }]`

#### Scenario: Detalle sin política
- GIVEN un producto `PUBLISHED` sin `cancellationPolicyId`
- WHEN se pide `GET /products/:id`
- THEN `cancellationPolicy` es `null`

#### Scenario: Producto no público
- GIVEN un producto en borrador, archivado o borrado lógicamente
- WHEN se pide `GET /products/:id`
- THEN 404 y no se devuelve ningún dato de política

#### Scenario: Política de otro producto
- GIVEN una política vinculada solo a un producto `DRAFT`
- WHEN se pide el detalle de un producto `PUBLISHED` distinto
- THEN la respuesta no contiene esa política

#### Scenario: Reglas corruptas no se exponen
- GIVEN una política con reglas que no pasan `cancellationRulesSchema`
- WHEN se pide `GET /products/:id`
- THEN `cancellationPolicy.rules` es una lista vacía y no se devuelve el JSONB original

#### Scenario: Sin acceso directo a la tabla
- GIVEN una conexión con el contexto RLS `public`
- WHEN consulta directamente `cancellation_policies`
- THEN no ve ninguna fila
