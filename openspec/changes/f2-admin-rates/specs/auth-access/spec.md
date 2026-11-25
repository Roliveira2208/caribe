# Delta: auth-access — f2-admin-rates

## ADDED Requirements

### Requirement: Gestión de miembros y sesiones desde el panel
El panel SHALL usar únicamente las rutas existentes de Better Auth bajo `/api/auth/organization/*` y
`/api/auth/admin/*` para invitar miembros, cambiar roles y revocar sesiones; SHALL NOT añadir plugins de
autenticación, API keys, bearer tokens, SSO ni OAuth. Las rutas administrativas SHALL exigir TOTP activo
a Admin de agencia y Super Admin antes de validar el cuerpo o comprobar permisos; sin segundo factor
SHALL responder 403 con código de aplicación `TWO_FACTOR_REQUIRED`, aunque el cuerpo sea inválido. La
organización objetivo SHALL resolverse del `organizationId` del cuerpo o la query, o de la organización
activa de la sesión si no viene; un `organizationId` ajeno a las membresías del usuario SHALL rechazarse
sin modificar la organización ajena ni imputarle filas de auditoría. Las operaciones de agencia sin
organización activa SHALL responder 403 con código `ACTIVE_ORGANIZATION_REQUIRED`, y el Super Admin SHALL
entrar en modo plataforma sin fijar agencia.

La revocación de sesiones desde el panel SHALL estar disponible solo para el Super Admin en modo
plataforma mediante `/api/auth/admin/*`; un Admin de agencia SHALL NOT ofrecer esa acción porque la
matriz F0 no le concede `session:revoke` y Better Auth la rechazaría. Un Admin de agencia SHALL invitar
miembros y cambiar roles con las rutas de `/api/auth/organization/*`.

Cambiar el rol de un miembro y revocar una sesión desde el panel SHALL dejar una fila en `audit_logs` con
los campos `before` y `after` (antes/después), actor, entidad, IP, fecha y agencia objetivo, o `tenant_id`
NULL en las rutas de plataforma. Cuando el middleware de Better Auth no pueda observar el estado previo,
`before` SHALL ser NULL y `after` SHALL registrar el estado resultante, conforme a la spec base de
auditoría. Cada escritura administrativa SHALL dejar además el par `attempt`/`result` en `auth_events`
con el mismo `correlation_id`, sin secretos ni mensajes internos. La interfaz SHALL NOT mostrar datos que
la API niega; los textos SHALL salir de los mensajes es/en y los controles SHALL ser accesibles por
teclado.

#### Scenario: Invitar miembro con segundo factor
- GIVEN un Admin de agencia con agencia activa y sin TOTP activo
- WHEN envía una invitación por `/api/auth/organization/invite-member` con un cuerpo inválido
- THEN la API responde 403 con código `TWO_FACTOR_REQUIRED` antes de validar el cuerpo y no se crea la invitación
- AND con TOTP activo la invitación se confirma por la ruta existente y deja fila de auditoría y un par `attempt`/`result` con el mismo `correlation_id`

#### Scenario: Cambiar rol de un miembro
- GIVEN un Admin de agencia con TOTP activo y un miembro de su agencia
- WHEN cambia el rol del miembro por `/api/auth/organization/update-member-role`
- THEN la ruta existente aplica el cambio y deja una fila en `audit_logs` con `before` y `after` (antes/después) del rol
- AND `before` es NULL cuando el middleware no observa el rol previo y `after` registra el rol resultante, según la spec base
- AND sin TOTP la petición responde 403 `TWO_FACTOR_REQUIRED` antes de validar el cuerpo

#### Scenario: Revocar sesión desde el panel
- GIVEN un Super Admin con TOTP activo en modo plataforma y una sesión activa de un usuario
- WHEN revoca esa sesión desde el panel por `/api/auth/admin/revoke-user-session`
- THEN la siguiente petición del usuario responde 401 y `audit_logs` recibe una fila con `before` y `after` (antes/después) de la sesión
- AND la fila queda con `tenant_id` NULL y el panel de agencia no ofrece la acción de revocar
- AND un Admin de agencia que intente la ruta recibe 403 de Better Auth sin modificar la sesión

#### Scenario: Organización objetivo ajena
- GIVEN un Admin de la agencia A autenticado con TOTP activo
- WHEN envía una escritura de `/api/auth/organization/*` con `organizationId` de la agencia B en el cuerpo o la query
- THEN la librería rechaza la operación, no se crea ni modifica nada en B y no se imputa ninguna fila de auditoría a B
- AND la interfaz no ofrece organizaciones objetivo ajenas a las membresías del usuario

#### Scenario: Super Admin en modo plataforma
- GIVEN un Super Admin sin organización activa
- WHEN entra al panel y consulta agencias, tasas globales, auditoría y eventos de autenticación
- THEN lo hace en modo plataforma sin fijar agencia activa, usando solo las rutas existentes de Better Auth y de la API
- AND no habilita plugins ni tokens nuevos y no puede escribir productos, reservas ni pagos de una agencia

#### Scenario: Operación sin agencia activa
- GIVEN un usuario autenticado sin organización activa
- WHEN intenta una operación de agencia desde el panel o llama a su endpoint
- THEN la API responde 403 con código `ACTIVE_ORGANIZATION_REQUIRED` y la interfaz no muestra datos de esa agencia
- AND el panel ofrece el selector de membresías o el estado vacío con textos es/en y controles accesibles por teclado

### Requirement: Lectura operativa de la tasa vigente
Los roles `agent` y `provider` de una agencia SHALL tener el permiso `exchange-rate: read` para consultar
únicamente `GET /admin/exchange-rates/current` de su agencia activa. SHALL NOT ver historial, motivos ni
acciones de override, y SHALL NOT poder escribir tasas. Esta lectura operativa completa la matriz del
diseño F2 sin ampliar otros permisos de esos roles.

#### Scenario: Roles operativos consultan la tasa vigente
- GIVEN un agente o proveedor con agencia activa y `exchange-rate: read`
- WHEN abre el panel de tasas o llama a `GET /admin/exchange-rates/current`
- THEN recibe solo la tasa vigente, su fecha valor, su origen y su ámbito, con el texto decimal del servidor
- AND la API responde 403 a cualquier override y la interfaz no ofrece historial ni controles de escritura

### Requirement: No revelación de propiedad de productos en el panel
Un producto ajeno SHALL responder 404 sin distinguir si pertenece a otro proveedor de la misma agencia
o a otra agencia, en la ficha, la edición, la publicación y el archivado del panel. El código 403 SHALL
quedarse para permisos insuficientes sobre la operación (rol sin `product:*`, Super Admin en escritura
o proveedor sin registro), nunca para revelar la propiedad de una fila. Este comportamiento sustituye,
para las rutas del panel de F2, el escenario «Proveedor edita el producto de otro proveedor» de la spec
base.

#### Scenario: Producto de otro proveedor de la misma agencia
- GIVEN un Proveedor con registro en `providers.user_id` y un producto de otro proveedor de su agencia
- WHEN consulta, edita, publica o archiva ese producto desde el panel
- THEN la API responde 404 con el mismo cuerpo que para un producto de otra agencia
- AND el panel no muestra botones de edición, publicación ni archivado sobre productos que no sean suyos
