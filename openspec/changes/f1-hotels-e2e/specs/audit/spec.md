# Delta: audit — f1-hotels-e2e

## MODIFIED Requirements

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

## ADDED Requirements

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
- Un reintento idempotente de reserva o pago no genera una segunda fila de auditoría ni un segundo
  evento de intento.
- El rate limiter corre antes de los hooks: una petición limitada no deja rastro en `auth_events`.
- Las rutas de activación de TOTP no son administrativas y no generan intentos; un rechazo por falta de
  TOTP sí.

## Acceptance
- Interceptor de NestJS probado con un endpoint de ejemplo; permisos de BD verificados en una migración.
- Prueba de dos filas (`attempt` y `result`) con el mismo `correlation_id` en éxito y en rechazo por TOTP.
- Prueba de inmutabilidad y de visibilidad por agencia en `auth_events`.
- Prueba de que un `cardNumber`, una contraseña o un token no aparecen en el evento.

## Out of scope
Exportación a sistemas externos y retención configurable. Auditoría de fallos de credenciales de login
(change futura). Correlación con trazas distribuidas.
