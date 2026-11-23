# Auth and Access Specification

## Purpose
Identidad con Better Auth, roles por agencia y aislamiento entre tenants.

## Requirements

### Requirement: Autenticación con Better Auth
La API SHALL exponer las rutas de Better Auth bajo `/api/auth/*` y exigir sesión en el resto, salvo los
endpoints marcados públicos (catálogo, tasa actual).

#### Scenario: Ruta protegida sin sesión
- WHEN se llama a `GET /api/v1/bookings/:id` sin cookie de sesión
- THEN 401

#### Scenario: Catálogo público
- WHEN se llama a `GET /api/v1/products` sin sesión
- THEN 200

### Requirement: Roles
El sistema SHALL distinguir los roles: Cliente (usuario sin membresía), Agente (`agent`), Proveedor
(`provider`), Admin de agencia (`owner` o `admin`) y Super Admin (rol de plataforma). El Super Admin
SHALL ser de solo lectura en el negocio: SHALL gestionar agencias y tasas globales, pero SHALL NOT
crear, editar, cancelar ni aprobar productos, reservas o pagos de una agencia. El Cliente SHALL poder
tener reservas en varias agencias y verlas todas.

#### Scenario: Proveedor edita su producto
- GIVEN un proveedor dueño del producto
- WHEN lo edita
- THEN 200

#### Scenario: Proveedor edita producto de otro proveedor
- WHEN edita un producto ajeno de la misma agencia
- THEN 403

#### Scenario: Cliente ve solo sus reservas
- WHEN un cliente consulta una reserva que no es suya
- THEN 404

#### Scenario: Super Admin intenta editar un producto
- GIVEN un Super Admin sin organización activa
- WHEN intenta editar un producto de una agencia
- THEN 403

#### Scenario: Super Admin intenta aprobar un pago
- GIVEN un Super Admin sin organización activa
- WHEN intenta aprobar o rechazar un pago
- THEN 403

### Requirement: Aislamiento entre tenants
Toda consulta SHALL filtrar por `tenant_id` mediante Row-Level Security en los contextos definidos por
la spec `tenant-isolation`. El personal de una agencia SHALL recibir 404, no 403, cuando pide un
recurso de otra agencia. Las pruebas de aislamiento SHALL ejecutarse con el rol de aplicación.

#### Scenario: Admin de otra agencia
- GIVEN un admin de la agencia A
- WHEN pide un producto de la agencia B por id
- THEN 404

#### Scenario: Agente de otra agencia
- GIVEN un agente de la agencia A
- WHEN pide una reserva de la agencia B
- THEN 404

#### Scenario: Prueba con el rol de aplicación
- WHEN corre la suite de aislamiento
- THEN se ejecuta como el rol de la aplicación, sin privilegios de superusuario ni `BYPASSRLS`

### Requirement: Segundo factor para roles administrativos
Admin de agencia y Super Admin SHALL activar TOTP antes de usar el panel. Mientras el segundo factor no
esté activado, la interfaz SHALL mantener al usuario en la pantalla de activación y la API SHALL rechazar
los endpoints administrativos con 403 y código de aplicación `TWO_FACTOR_REQUIRED`. La activación del
TOTP y los endpoints que no exigen permisos administrativos SHALL permanecer accesibles.

Un endpoint SHALL considerarse administrativo si está registrado bajo el prefijo `/admin` de la API, si
exige un permiso exclusivo de Admin de agencia o Super Admin, o si es una ruta de escritura reservada a
roles administrativos dentro del middleware de Better Auth: las rutas de `/api/auth/admin/*` y las
escrituras administrativas de `/api/auth/organization/*` (crear, actualizar o eliminar la organización,
invitar o expulsar miembros, cambiar el rol de un miembro y cancelar invitaciones). Las demás rutas de
Better Auth, incluidas las de activación de `two-factor/*`, SHALL permanecer accesibles sin segundo
factor. Toda ruta administrativa SHALL exigir segundo factor activo, y el inventario de rutas de ambas
familias (API de Nest y middleware de Better Auth) SHALL comprobarse en tests.

En las rutas del middleware de Better Auth la exigencia SHALL evaluarse antes de validar el cuerpo y de
comprobar permisos: un rol administrativo sin segundo factor recibe 403 con código de aplicación
`TWO_FACTOR_REQUIRED` aunque el cuerpo sea inválido o falte el permiso. Un usuario sin rol
administrativo SHALL recibir el 403 normal de permisos, sin el código de aplicación. Las acciones de
sistema ejecutadas por la API de servidor (`auth.api`) sin sesión HTTP SHALL saltarse la exigencia.

En las escrituras de `/api/auth/organization/*` la condición de rol administrativo SHALL evaluarse
contra la organización objetivo de la escritura —la del cuerpo o la query, o la organización activa de
la sesión si no viene— y no solo contra la organización activa: Better Auth autoriza esas escrituras por
membresía en la organización afectada. Si la organización objetivo no puede determinarse, la escritura
SHALL fallar cerrada: una sesión con rol de plataforma o con rol administrativo en cualquier agencia y
sin segundo factor recibe 403 con código de aplicación `TWO_FACTOR_REQUIRED`; una sesión sin ningún rol
administrativo recibe el rechazo normal de la lib, sin el código de aplicación.

#### Scenario: Admin sin TOTP
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN abre el panel o llama a un endpoint administrativo
- THEN la interfaz lo mantiene en la pantalla de activación de TOTP
- AND la API responde 403 con código de aplicación `TWO_FACTOR_REQUIRED`

#### Scenario: Admin sin TOTP en un endpoint no administrativo
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN llama a un endpoint que no exige permisos administrativos
- THEN la API responde 2xx

#### Scenario: Admin sin TOTP en una ruta administrativa de Better Auth
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN llama por HTTP a una ruta de `/api/auth/admin/*` o a una escritura administrativa de `/api/auth/organization/*`
- THEN la API responde 403 con código de aplicación `TWO_FACTOR_REQUIRED`

#### Scenario: Usuario sin rol administrativo en una ruta administrativa de Better Auth
- GIVEN un agente autenticado sin segundo factor activado
- WHEN llama por HTTP a una escritura administrativa de `/api/auth/organization/*`
- THEN la API responde 403 por permisos, sin el código de aplicación `TWO_FACTOR_REQUIRED`

#### Scenario: Admin sin TOTP ni organización activa escribe en su agencia
- GIVEN un owner de agencia autenticado sin segundo factor activado y sin organización activa
- WHEN llama por HTTP a `/api/auth/organization/invite-member` o `update-member-role` con `organizationId` de su agencia en el cuerpo
- THEN la API responde 403 con código de aplicación `TWO_FACTOR_REQUIRED`
- AND no se crea la invitación ni cambia el rol del miembro

#### Scenario: Admin con TOTP y sin organización activa escribe en su agencia
- GIVEN un owner de agencia autenticado con segundo factor activado y sin organización activa
- WHEN llama por HTTP a `/api/auth/organization/invite-member` con `organizationId` de su agencia en el cuerpo
- THEN la API responde 2xx

#### Scenario: Escritura de organización sin objetivo determinable
- GIVEN un owner de agencia autenticado sin segundo factor activado y sin organización activa
- WHEN llama por HTTP a una escritura de `/api/auth/organization/*` sin `organizationId` en el cuerpo ni en la query
- THEN la API responde 403 con código de aplicación `TWO_FACTOR_REQUIRED`

#### Scenario: Rol no administrativo sin objetivo determinable
- GIVEN un agente autenticado sin segundo factor, sin rol administrativo en ninguna agencia y sin organización activa
- WHEN llama por HTTP a una escritura de `/api/auth/organization/*` sin `organizationId` en el cuerpo ni en la query
- THEN la API responde el rechazo normal de la lib, sin el código de aplicación `TWO_FACTOR_REQUIRED`
- AND la escritura no se confirma

#### Scenario: Owner de una agencia escribe en otra
- GIVEN el owner de la agencia A autenticado sin segundo factor, sin organización activa y con rol no administrativo en la agencia B
- WHEN llama por HTTP a una escritura de `/api/auth/organization/*` con `organizationId` de la agencia B en el cuerpo
- THEN la API responde el rechazo normal de la lib, sin el código de aplicación `TWO_FACTOR_REQUIRED`
- AND la escritura no se confirma

#### Scenario: Activación de TOTP accesible
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN llama a las rutas de activación de `/api/auth/two-factor/*`
- THEN la API responde 2xx

#### Scenario: Ruta administrativa sin exigencia de segundo factor
- GIVEN una ruta registrada bajo el prefijo `/admin` o con permiso exclusivo administrativo, o una ruta administrativa del middleware de Better Auth
- WHEN el inventario de rutas administrativas se comprueba en los tests
- THEN la prueba falla si esa ruta no exige segundo factor

### Requirement: Límite de intentos y sesiones
Better Auth SHALL limitar intentos en registro e inicio de sesión, y las sesiones SHALL ser revocables desde el panel.

#### Scenario: Revocar sesión
- WHEN un admin revoca la sesión de un usuario
- THEN su siguiente solicitud devuelve 401

### Requirement: Organización activa en el panel
Tras iniciar sesión en `apps/admin`, el servidor SHALL consultar las membresías del usuario. Con una
sola membresía SHALL fijar esa agencia como activa y entrar al panel. Con varias SHALL mostrar un
selector y SHALL NOT fijar ninguna hasta que el usuario elija. Con cero membresías SHALL NOT entrar al
panel y SHALL mostrar un mensaje con enlace a la web. El Super Admin SHALL entrar en modo plataforma sin
agencia activa. La selección SHALL ser por sesión; cada inicio de sesión vuelve a resolverla. La API
SHALL seguir fallando cerrada: una operación de agencia sin organización activa SHALL responder 403 con
código `ACTIVE_ORGANIZATION_REQUIRED`. Toda ruta que resuelva la agencia desde `activeOrganizationId` SHALL
revalidar la membresía en cada petición: con la membresía revocada SHALL responder 403 con ese mismo código,
aunque la sesión conserve la agencia activa. Elegir una agencia de la que no se es miembro SHALL ser rechazado.

#### Scenario: Una sola membresía
- GIVEN un usuario con una sola membresía
- WHEN inicia sesión en el panel
- THEN su sesión queda con esa agencia activa y entra al panel

#### Scenario: Varias membresías
- GIVEN un usuario con dos membresías
- WHEN inicia sesión en el panel
- THEN ve el selector y ninguna agencia queda activa hasta elegir

#### Scenario: Cero membresías
- GIVEN un usuario sin membresías
- WHEN inicia sesión en el panel
- THEN no entra al panel y ve un mensaje con enlace a la web

#### Scenario: Super Admin sin agencia
- GIVEN un Super Admin sin membresías
- WHEN inicia sesión en el panel
- THEN entra en modo plataforma sin agencia activa

#### Scenario: Operación de agencia sin agencia activa
- GIVEN un usuario autenticado sin organización activa
- WHEN llama a una operación de agencia
- THEN 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

#### Scenario: Membresía revocada en rutas de agencia
- GIVEN una sesión que conserva `activeOrganizationId` de una agencia cuya membresía fue revocada
- WHEN llama a ajustes de agencia, panel de pagos, override o consulta de tasas, panel de productos,
  consulta o cancelación de reservas, pagos propios, auditoría o eventos de autenticación
- THEN cada ruta responde 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

#### Scenario: Elegir una agencia ajena
- GIVEN un usuario que no es miembro de la agencia B
- WHEN intenta fijar B como activa
- THEN la lib rechaza la operación y la agencia activa no cambia

### Requirement: Cliente sin membresía
Un Cliente SHALL ser un usuario autenticado sin membresía. El catálogo SHALL poder verse sin sesión; para
reservar, pagar, cancelar o descargar documentos SHALL exigirse sesión. El Cliente SHALL operar con el
contexto `owner` sobre sus propias reservas, pagos y documentos, sin organización activa, y SHALL NOT
acceder a endpoints de agencia ni fijar la agencia o el usuario de una reserva.

#### Scenario: Reserva anónima
- WHEN un visitante sin sesión intenta crear una reserva
- THEN 401

#### Scenario: Cliente reserva en una agencia
- GIVEN un cliente autenticado sin membresía y un producto publicado de la agencia A
- WHEN crea una reserva
- THEN la reserva queda en A con su usuario y sin organización activa

#### Scenario: Cliente con reservas en dos agencias
- GIVEN un cliente con reservas en A y B
- WHEN consulta "Mis reservas"
- THEN ve ambas

#### Scenario: Cliente en un endpoint de agencia
- WHEN un cliente sin membresía llama a un endpoint de agencia
- THEN 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

#### Scenario: Cliente intenta fijar la agencia o el usuario
- WHEN el cuerpo de la reserva incluye `tenant_id` o un `user_id` ajeno
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

### Requirement: Propiedad de productos
Un Proveedor SHALL ver y editar solo los productos de su registro de proveedor (`providers.user_id`) en
su agencia. Un Admin de agencia SHALL ver y editar todos los productos de su agencia. Un producto de
otra agencia SHALL responder 404. El Super Admin SHALL poder listar y leer productos, pero SHALL NOT
crearlos, editarlos, publicarlos ni archivarlos. El permiso compartido `product:update` SHALL
complementarse con la comprobación de propiedad; el permiso por sí solo SHALL NOT autorizar un producto
ajeno.

#### Scenario: Proveedor edita su producto
- GIVEN un producto del proveedor
- WHEN lo edita
- THEN 200

#### Scenario: Proveedor edita el producto de otro proveedor
- GIVEN un producto de otro proveedor de la misma agencia
- WHEN el proveedor lo edita
- THEN 403

#### Scenario: Proveedor edita un producto de otra agencia
- GIVEN un producto de la agencia B
- WHEN un proveedor de A lo edita
- THEN 404

#### Scenario: Admin edita un producto de su agencia
- GIVEN un producto de la agencia A
- WHEN el admin de A lo edita
- THEN 200

#### Scenario: Super Admin intenta publicar
- GIVEN un producto `DRAFT`
- WHEN el Super Admin intenta publicarlo
- THEN 403 y el producto sigue `DRAFT`

### Requirement: Permisos sobre reservas y pagos
Un Cliente o Agente SHALL crear reservas y reportar pagos solo para sí mismo; el `user_id` SHALL salir
de la sesión y un Agente SHALL NOT reservar en nombre de otra persona en F1. El owner y el admin de la
agencia SHALL ver y cancelar las reservas de su agencia; el Agente SHALL ver y cancelar solo las
propias; el Proveedor SHALL NOT cancelar reservas. El Proveedor SHALL ver solo reservas y documentos
de las líneas con productos de su `provider_id`, aunque estén en su misma agencia. Un `member` sin
`booking:read` SHALL NOT ver reservas ni resumen de la agencia: las rutas de lectura SHALL responder
403 `FORBIDDEN` por defecto. La aprobación o rechazo de un pago SHALL ser exclusiva del Admin de
agencia de la agencia del pago y de una persona distinta de quien lo reportó. El Super Admin SHALL ser
de solo lectura en reservas y pagos y SHALL NOT cancelar. Ningún otro rol SHALL revisar pagos.

#### Scenario: Agente crea su propia reserva
- GIVEN un agente autenticado
- WHEN crea una reserva
- THEN la reserva queda con su `user_id`

#### Scenario: Agente intenta reservar para otra persona
- WHEN el cuerpo incluye el `user_id` de otra persona
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

#### Scenario: Admin ve las reservas de su agencia
- GIVEN reservas de la agencia A
- WHEN el admin de A las lista
- THEN recibe las de A y ninguna de B

#### Scenario: Admin cancela una reserva de su agencia
- GIVEN una reserva `CONFIRMED` de la agencia A
- WHEN el admin de A la cancela
- THEN 200 y se aplica la política guardada

#### Scenario: Agente intenta cancelar una reserva ajena
- GIVEN una reserva de otro usuario de la agencia A
- WHEN el agente de A intenta cancelarla
- THEN 404 y la reserva no cambia

#### Scenario: Proveedor ve solo su inventario
- GIVEN reservas de los proveedores A y B en la misma agencia
- WHEN el proveedor A lista reservas
- THEN solo recibe las que contienen productos suyos

#### Scenario: Proveedor intenta cancelar
- GIVEN una reserva de la agencia A
- WHEN el proveedor de A intenta cancelarla
- THEN 403 y la reserva no cambia

#### Scenario: Member sin permiso de lectura
- GIVEN un `member` con agencia activa y sin `booking:read`
- WHEN lista o consulta reservas
- THEN 403 `FORBIDDEN`, sin reservas ni resumen

#### Scenario: Super Admin intenta cancelar
- GIVEN una reserva de una agencia
- WHEN el Super Admin intenta cancelarla
- THEN 403

#### Scenario: Revisor distinto del pagador
- GIVEN un pago reportado por el admin de A
- WHEN el mismo admin intenta aprobarlo
- THEN 403 y el pago sigue `IN_REVIEW`

## Casos límite
- Correo ya registrado → 422 sin revelar si existe cuenta en el restablecimiento de contraseña.
- Usuario bloqueado (`banned`) → no puede iniciar sesión.
- Cookie de sesión de primera parte: las apps Next.js reenvían `/api/*` a la API.

## Acceptance
- Pruebas de autorización por rol y de aislamiento entre dos tenants en CI.
- Matriz rol × endpoint documentada en `design.md` de la change F0.

## Out of scope
Inicio de sesión social, SSO, claves de acceso (passkeys).
