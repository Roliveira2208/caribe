# Delta: audit — f0-foundations

## ADDED Requirements

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
organización con el `tenant_id` de la agencia afectada. Las acciones de sistema ejecutadas por la API de
servidor (`auth.api`) sin sesión HTTP quedan fuera de este registro.

#### Scenario: Owner invita a un miembro
- GIVEN un owner de agencia autenticado con TOTP activo
- WHEN invita a un miembro por `/api/auth/organization/invite-member`
- THEN existe una fila de auditoría con la agencia como `tenant_id`, el owner como actor y la invitación como entidad afectada

#### Scenario: Super Admin revoca una sesión
- GIVEN un Super Admin autenticado con TOTP activo
- WHEN revoca la sesión de un usuario por `/api/auth/admin/revoke-user-session`
- THEN existe una fila de auditoría con `tenant_id` NULL, el Super Admin como actor y la sesión revocada como entidad afectada

## MODIFIED Requirements

### Requirement: Registro de acciones sensibles
SHALL registrarse actor, acción, entidad, antes, después, IP y fecha para: aprobar o rechazar pagos,
fijar tasas, cancelar o reembolsar reservas, cambiar roles y revocar sesiones.

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

#### Scenario: Escritura de Better Auth deja fila tras confirmarse
- GIVEN un rol administrativo autenticado con TOTP activo
- WHEN su escritura administrativa en el middleware de Better Auth se confirma con 2xx
- THEN existe una fila de auditoría con el estado resultante escrita en una transacción propia
