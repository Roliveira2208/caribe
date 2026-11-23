# Delta: audit — f2-admin-rates

## ADDED Requirements

### Requirement: Consulta y trazabilidad de auditoría en el panel
El panel de administración SHALL exponer la auditoría y los eventos de autenticación solo a Admin de
agencia y Super Admin, respetando el alcance definido en la spec base: el Admin de agencia SHALL leer
únicamente las filas de su agencia; el Super Admin SHALL leer las filas de plataforma (`tenant_id` NULL)
y las de todas las agencias en modo lectura. Agentes y `member` SHALL recibir 403 en la API y SHALL NOT
ver el resumen ni la pestaña de auditoría en la interfaz. La consulta de `audit_logs` SHALL filtrar por
acción, entidad, actor y rango de fechas, con paginación por cursor; la pestaña de `auth_events` SHALL
usar el mismo alcance por agencia y su consulta de solo lectura SHALL mantener los filtros por ruta,
`outcome` y rango de fechas con cursor.

Las nuevas filas de auditoría SHALL registrar actor, acción, entidad, estado anterior y posterior cuando
la spec base lo permita, IP y fecha, y SHALL compartir transacción con la escritura sensible atendida por
la API. El override de tasa, la revisión de pagos y el cambio de rol SHALL dejar rastro imputado a la
agencia correspondiente; las acciones de plataforma SHALL conservar `tenant_id` NULL. La respuesta y la
exportación CSV SHALL exponer solo campos de negocio y códigos de error estables, nunca secretos,
cuerpos completos, cookies ni mensajes internos; la IP SHALL poder ser `null` cuando la petición provenga
de un proxy no confiable y la API SHALL NOT confiar en cabeceras reenviadas. Los textos visibles SHALL
salir de los mensajes es/en y los controles SHALL ser accesibles por teclado.

#### Scenario: Filtros y cursor
- GIVEN un Admin de agencia con agencia activa y filas de auditoría de su agencia
- WHEN consulta `GET /admin/audit-logs` con filtros por acción, entidad, actor y rango de fechas y sigue el cursor devuelto
- THEN recibe solo las filas de su agencia que cumplen todos los filtros, sin duplicados ni huecos entre páginas
- AND el cursor es opaco y el último cursor es `null` cuando se agotan los resultados

#### Scenario: Pestaña de eventos de autenticación
- GIVEN eventos de `auth_events` de plataforma y de dos agencias
- WHEN el Admin de una agencia abre la pestaña de eventos y el Super Admin la abre en modo plataforma
- THEN el Admin recibe solo los eventos de su agencia y el Super Admin los de plataforma y todas las agencias
- AND la consulta sigue siendo de solo lectura, con cursor y filtros por ruta, `outcome` y rango de fechas

#### Scenario: Alcance del admin de agencia
- GIVEN filas de auditoría de las agencias A y B y filas de plataforma
- WHEN el Admin de A consulta el resumen y el detalle de auditoría
- THEN solo recibe las filas de la agencia A
- AND la interfaz no muestra totales ni resumen que incluyan datos de otra agencia o de plataforma

#### Scenario: Modo plataforma del Super Admin
- GIVEN un Super Admin autenticado sin organización activa
- WHEN consulta auditoría y eventos de autenticación en modo plataforma
- THEN recibe en lectura las filas con `tenant_id` NULL y las de todas las agencias
- AND no puede modificar ni borrar ninguna fila de `audit_logs` ni de `auth_events`

#### Scenario: Sin permiso de auditoría
- GIVEN un agente o un `member` autenticado con agencia activa
- WHEN intenta consultar el resumen, `GET /admin/audit-logs` o la pestaña de eventos de autenticación
- THEN la API responde 403
- AND su interfaz no muestra el resumen ni los enlaces a la auditoría o a los eventos

#### Scenario: Sin secretos ni mensajes internos
- GIVEN filas de auditoría y eventos de autenticación de acciones administrativas
- WHEN se consultan en el panel o se exportan a CSV
- THEN solo se exponen actor, acción, entidad, estados de negocio, ruta, IP, fecha, código y estado del error
- AND no se incluyen contraseñas, tokens, cookies, cuerpos completos ni mensajes de error internos
- AND `ip` puede ser `null` tras un proxy no confiable, sin que la API acepte cabeceras de reenvío suplantadas

#### Scenario: Auditoría del override de tasa
- GIVEN un Admin de agencia con segundo factor activo y una tasa vigente
- WHEN fija manualmente una tasa de override para su agencia
- THEN existe una fila en `audit_logs` con actor, acción, entidad de tasa, valor anterior y nuevo, IP, fecha y el `tenant_id` de la agencia
- AND los pagos existentes conservan su `exchange_rate_id` y su `amount_ves` congelados, sin recalcularse

#### Scenario: Auditoría de la revisión de pagos
- GIVEN un pago `IN_REVIEW` reportado por otro usuario de la agencia
- WHEN el Admin de la agencia lo aprueba o rechaza desde el panel
- THEN existe una fila de auditoría con el estado anterior y el nuevo, el revisor y el `tenant_id` de la agencia
- AND la fila se escribe en la misma transacción que el cambio de estado, de modo que un fallo de auditoría revierte la revisión

#### Scenario: Auditoría del cambio de rol
- GIVEN un Admin de agencia con segundo factor activo y un miembro de su agencia
- WHEN cambia el rol del miembro por `/api/auth/organization/update-member-role`
- THEN existe una fila en `audit_logs` con el cambio de rol, el actor, la entidad miembro y el `tenant_id` de la agencia
- AND el par `attempt`/`result` de `auth_events` comparte `correlation_id` y no contiene secretos ni mensajes internos

#### Scenario: Exportación CSV de auditoría
- GIVEN un Admin de agencia con permiso de auditoría y filtros activos
- WHEN exporta a CSV desde el panel
- THEN el archivo contiene solo las filas de su agencia que cumplen los mismos filtros y las columnas permitidas
- AND las cabeceras y los estados usan los mensajes es/en y el control de exportación es accesible por teclado
