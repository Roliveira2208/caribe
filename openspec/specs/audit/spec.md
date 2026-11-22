# Audit Specification

## Purpose
Rastro inmutable de acciones sensibles.

## Requirements

### Requirement: Registro de acciones sensibles
SHALL registrarse actor, acción, entidad, antes, después, IP y fecha para: aprobar o rechazar pagos,
fijar tasas, crear, cancelar, expirar o reembolsar reservas, cambiar roles, revocar sesiones y cambiar
los ajustes de una agencia. La creación de una reserva SHALL registrar `before` NULL y un `after` con
código, estado, total y agencia; la expiración SHALL registrar actor NULL (sistema) y el cambio de
estado; el reembolso SHALL registrar los montos y la tasa congelada.

Las acciones sensibles atendidas por handlers de la API SHALL compartir transacción con su fila de
auditoría: si la escritura de auditoría falla, la acción no se confirma. Las escrituras administrativas
del middleware de Better Auth SHALL auditar después de que la acción se confirme, en una transacción
propia con el contexto RLS de la acción, porque el middleware no puede unirse a la transacción interna
de la lib; en ellas el estado anterior queda NULL (el middleware solo observa el resultado) y, si la
escritura de auditoría falla, el fallo SHALL quedar registrado en el log del servidor sin deshacer la
acción ya confirmada.

#### Scenario: Admin aprueba un pago
- WHEN un admin aprueba un pago
- THEN existe una fila de auditoría con el estado anterior y el nuevo

#### Scenario: Cliente crea una reserva
- WHEN un cliente crea una reserva
- THEN existe una fila de auditoría con la agencia, el actor, el código y el total

#### Scenario: Expiración de una reserva
- WHEN el trabajo de expiración marca una reserva `EXPIRED`
- THEN existe una fila de auditoría con actor NULL y el cambio de estado

#### Scenario: Cambio de ajustes de la agencia
- GIVEN un admin de agencia
- WHEN cambia `hold_minutes` o `payment_mode`
- THEN existe una fila de auditoría con el valor anterior y el nuevo

#### Scenario: Escritura de Better Auth deja fila tras confirmarse
- GIVEN un rol administrativo autenticado con TOTP activo
- WHEN su escritura administrativa en el middleware de Better Auth se confirma con 2xx
- THEN existe una fila de auditoría con el estado resultante escrita en una transacción propia

### Requirement: Inmutabilidad
Las filas de `audit_logs` SHALL NOT poder modificarse ni borrarse desde la aplicación.

#### Scenario: Intento de borrado
- WHEN el rol de la aplicación intenta `UPDATE` o `DELETE` sobre `audit_logs`
- THEN la base de datos lo rechaza

### Requirement: Consulta
Solo Admin de agencia y Super Admin SHALL poder consultar la auditoría de su alcance. El Admin de
agencia SHALL ver solo las filas de su agencia; el Super Admin SHALL ver las de plataforma y las de
todas las agencias. La consulta SHALL permitir filtrar por acción, entidad, actor y rango de fechas, con
paginación por cursor.

#### Scenario: Agente consulta auditoría
- WHEN un agente llama a `GET /admin/audit-logs`
- THEN 403

#### Scenario: Filtro por acción
- GIVEN filas de auditoría de pago y de tasa en la agencia A
- WHEN el admin de A filtra por acción de pago
- THEN solo recibe las de pago

### Requirement: Auditoría de acciones de plataforma
Las acciones sensibles ejecutadas fuera del alcance de una agencia SHALL registrarse en `audit_logs` con
`tenant_id` NULL. Las filas con `tenant_id` NULL SHALL ser legibles únicamente por el rol de plataforma de
la base de datos; Row-Level Security SHALL impedir que el rol de aplicación de una agencia las lea.

#### Scenario: Super Admin crea una agencia
- GIVEN un Super Admin autenticado sin organización activa
- WHEN crea una agencia
- THEN existe una fila de auditoría con `tenant_id` NULL, actor, acción y estados antes y después

#### Scenario: Agencia no lee auditoría de plataforma
- GIVEN filas de auditoría con `tenant_id` NULL
- WHEN el rol de aplicación de una agencia consulta `audit_logs`
- THEN obtiene cero resultados

### Requirement: Alcance de lectura de la auditoría
El alcance de lectura de `audit_logs` SHALL ser: el Admin de agencia solo las filas de su agencia; el
Super Admin las filas de plataforma (`tenant_id` NULL) y las de todas las agencias. Ningún otro rol SHALL
leer la tabla.

#### Scenario: Super Admin consulta la auditoría
- GIVEN filas de auditoría con `tenant_id` NULL y filas de dos agencias
- WHEN un Super Admin consulta la auditoría
- THEN recibe las filas de plataforma y las de ambas agencias

#### Scenario: Admin de agencia solo lee su agencia
- GIVEN filas de auditoría de las agencias A y B, además de filas de plataforma
- WHEN el Admin de la agencia A consulta la auditoría
- THEN solo recibe las filas de la agencia A

### Requirement: Auditoría de las escrituras administrativas de Better Auth
Las escrituras administrativas atendidas por el middleware de Better Auth —las rutas de
`/api/auth/admin/*` y las escrituras administrativas de `/api/auth/organization/*`— SHALL dejar fila en
`audit_logs` con actor, acción, entidad, identificador de la entidad afectada, estado resultante, IP y
fecha. Las acciones del plugin admin SHALL registrarse con `tenant_id` NULL (plataforma) y las de
organización con el `tenant_id` de la agencia afectada. La agencia afectada SHALL resolverse de la
organización objetivo de la escritura y no solo de la organización activa de la sesión: la del cuerpo o
la query cuando la ruta declara que su agencia objetivo sale de la petición, la de la entidad afectada
o, en su defecto, la activa. En las rutas que no aceptan `organizationId` en su esquema (cancelar una
invitación), el cuerpo SHALL ignorarse para atribuir la fila: un `organizationId` de otra agencia en el
cuerpo SHALL NOT desviar la fila, que SHALL quedar con la agencia de la entidad afectada devuelta. Las
acciones de sistema ejecutadas por la API de servidor (`auth.api`) sin sesión HTTP quedan fuera de este
registro.

#### Scenario: Owner invita a un miembro
- GIVEN un owner de agencia autenticado con TOTP activo
- WHEN invita a un miembro por `/api/auth/organization/invite-member`
- THEN existe una fila de auditoría con la agencia como `tenant_id`, el owner como actor y la invitación como entidad afectada

#### Scenario: Owner invita sin organización activa
- GIVEN un owner de agencia autenticado con TOTP activo y sin organización activa
- WHEN invita a un miembro por `/api/auth/organization/invite-member` con `organizationId` de su agencia en el cuerpo
- THEN existe una fila de auditoría con esa agencia como `tenant_id` y el owner como actor

#### Scenario: Owner cancela una invitación sin organización activa
- GIVEN un owner de agencia autenticado con TOTP activo y sin organización activa
- WHEN cancela una invitación de su agencia por `/api/auth/organization/cancel-invitation`
- THEN existe una fila de auditoría con la agencia de la invitación como `tenant_id` y el owner como actor

#### Scenario: Owner cancela una invitación con organizationId ajeno en el cuerpo
- GIVEN un owner de agencia autenticado con TOTP activo y sin organización activa
- WHEN cancela una invitación de su agencia por `/api/auth/organization/cancel-invitation` con un `organizationId` de otra agencia en el cuerpo
- THEN la invitación se cancela
- AND existe una fila de auditoría con la agencia de la invitación como `tenant_id` y el owner como actor
- AND no queda fila de auditoría imputada a la agencia del cuerpo

#### Scenario: Super Admin revoca una sesión
- GIVEN un Super Admin autenticado con TOTP activo
- WHEN revoca la sesión de un usuario por `/api/auth/admin/revoke-user-session`
- THEN existe una fila de auditoría con `tenant_id` NULL, el Super Admin como actor y la sesión revocada como entidad afectada

### Requirement: Registro de intentos y resultados de acciones administrativas
Los intentos de escritura administrativa de Better Auth y los rechazos por segundo factor SHALL
registrarse en una tabla `auth_events` separada, append-only, con dos filas por intento unidas por un
`correlation_id`: una de fase `attempt` y otra de fase `result`. `audit_logs` SHALL conservar su
semántica de acción sensible confirmada con antes/después; un intento SHALL NOT escribirse en
`audit_logs`.

El registro de alcance F1 SHALL cubrir las escrituras administrativas de `/api/auth/admin/*` y de
`/api/auth/organization/*` y los rechazos por segundo factor. Los fallos de credenciales de inicio de
sesión quedan fuera y se especificarán en una change propia.

La fila de intento SHALL guardar actor (o NULL si no hay sesión), ruta, método, IP, fecha, agencia
objetivo si se conoce y `correlation_id`. La fila de resultado SHALL guardar el mismo `correlation_id`,
`outcome` (`success` o `error`), código de aplicación estable, estado HTTP y nombre del error; SHALL NOT
guardar mensajes libres, cuerpos completos, cookies, tokens, contraseñas ni secretos. El error SHALL
tener la forma `{ code, status, name }`. Si el hook `before` rechaza la acción o lanza, la fila de
resultado SHALL escribirse en ese mismo fallo, porque el hook `after` no se ejecuta.

Si falla la escritura del intento, la escritura administrativa SHALL fallar cerrada y no ejecutarse. Si
falla la escritura del resultado, el fallo SHALL registrarse en el log del servidor y la acción ya
confirmada SHALL mantenerse. Las peticiones sin sesión y las limitadas por el rate limiter SHALL NOT
generar filas.

#### Scenario: Rechazo por falta de segundo factor
- GIVEN un admin autenticado sin TOTP
- WHEN intenta una escritura administrativa
- THEN existen una fila `attempt` y una `result` con `outcome = error` y código `TWO_FACTOR_REQUIRED`

#### Scenario: Escritura administrativa exitosa
- GIVEN un admin con TOTP activo
- WHEN su escritura administrativa se confirma
- THEN existen una fila `attempt` y una `result` con `outcome = success` y el mismo `correlation_id`

#### Scenario: Error de validación de la lib
- GIVEN un admin con TOTP activo
- WHEN envía un cuerpo inválido a una escritura administrativa
- THEN existe una fila `result` con `outcome = error` y el código de validación

#### Scenario: Sin sesión
- WHEN una petición anónima llega a una ruta administrativa
- THEN no se escribe ninguna fila en `auth_events`

#### Scenario: Petición limitada
- GIVEN una IP que supera el límite de intentos
- WHEN la petición se rechaza antes de los hooks
- THEN no se escribe ninguna fila en `auth_events`

#### Scenario: Fallo al escribir el intento
- GIVEN una base que rechaza la inserción en `auth_events`
- WHEN un admin intenta una escritura administrativa
- THEN la API responde 500 y la escritura no se ejecuta

#### Scenario: Fallo al escribir el resultado
- GIVEN una acción administrativa ya confirmada y una base que rechaza la fila de resultado
- WHEN se intenta registrar el resultado
- THEN el fallo queda en el log y la acción sigue confirmada

#### Scenario: Inmutabilidad de los intentos
- WHEN el rol de la aplicación intenta `UPDATE` o `DELETE` sobre `auth_events`
- THEN la base lo rechaza

#### Scenario: Sin secretos en el evento
- GIVEN una escritura administrativa con contraseña o token en el cuerpo
- WHEN se registra el evento
- THEN la fila no contiene el cuerpo, la contraseña, el token ni la cookie

### Requirement: Visibilidad de los intentos
La fila de intento SHALL imputarse a la agencia objetivo cuando se conozca. Las acciones de plataforma
SHALL quedar con `tenant_id` NULL y las de agencia con el `tenant_id` de la agencia afectada. Si la
agencia objetivo no puede determinarse, la fila SHALL quedar con `tenant_id` NULL y SHALL ser visible
solo para el Super Admin; la fila de resultado SHALL imputarse a la agencia de la entidad devuelta
cuando exista. El Admin de agencia SHALL leer solo los eventos de su agencia; el Super Admin SHALL leer
todos. Ningún otro rol SHALL leer `auth_events`.

#### Scenario: Evento de plataforma
- GIVEN un Super Admin que crea una agencia
- WHEN se registra el evento
- THEN la fila tiene `tenant_id` NULL

#### Scenario: Evento de agencia
- GIVEN un owner que invita a un miembro de su agencia
- WHEN se registra el evento
- THEN la fila tiene el `tenant_id` de esa agencia

#### Scenario: Agencia desconocida
- GIVEN una escritura administrativa sin agencia objetivo determinable
- WHEN se registra el intento
- THEN la fila tiene `tenant_id` NULL y solo la lee el Super Admin

#### Scenario: Admin de agencia no ve eventos de plataforma
- GIVEN eventos con `tenant_id` NULL y eventos de la agencia A
- WHEN el admin de A consulta los eventos
- THEN solo recibe los de A

#### Scenario: Agente no lee eventos
- WHEN un agente llama a la consulta de eventos
- THEN 403

### Requirement: Consulta de intentos
La consulta de `auth_events` SHALL ser de solo lectura, con paginación por cursor y filtros por ruta,
`outcome` y rango de fechas. El Super Admin SHALL ver todos los eventos; el Admin de agencia solo los de
su agencia. La respuesta SHALL exponer el código y el estado del error, nunca el mensaje interno.

#### Scenario: Super Admin consulta todos
- GIVEN eventos de plataforma y de dos agencias
- WHEN el Super Admin consulta
- THEN recibe todos

#### Scenario: Filtro por resultado
- GIVEN eventos de éxito y de error en la agencia A
- WHEN el admin de A filtra por `outcome = error`
- THEN solo recibe los fallidos

#### Scenario: Sin mensaje interno
- WHEN se consulta un evento fallido
- THEN la respuesta incluye código, estado y nombre del error, pero no el mensaje interno

## Casos límite
- Si falla la escritura de auditoría en un handler de la API, la acción sensible no se confirma (misma
  transacción). En las escrituras del middleware de Better Auth el fallo se registra en el log sin
  deshacer la acción ya confirmada.

## Acceptance
- Interceptor de NestJS probado con un endpoint de ejemplo; permisos de BD verificados en una migración.

## Out of scope
Exportación a sistemas externos y retención configurable.
