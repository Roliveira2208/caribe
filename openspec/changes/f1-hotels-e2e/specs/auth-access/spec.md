# Delta: auth-access — f1-hotels-e2e

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Organización activa en el panel
Tras iniciar sesión en `apps/admin`, el servidor SHALL consultar las membresías del usuario. Con una
sola membresía SHALL fijar esa agencia como activa y entrar al panel. Con varias SHALL mostrar un
selector y SHALL NOT fijar ninguna hasta que el usuario elija. Con cero membresías SHALL NOT entrar al
panel y SHALL mostrar un mensaje con enlace a la web. El Super Admin SHALL entrar en modo plataforma sin
agencia activa. La selección SHALL ser por sesión; cada inicio de sesión vuelve a resolverla. La API
SHALL seguir fallando cerrada: una operación de agencia sin organización activa SHALL responder 403 con
código `ACTIVE_ORGANIZATION_REQUIRED`. Elegir una agencia de la que no se es miembro SHALL ser rechazado.

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
de la sesión y un Agente SHALL NOT reservar en nombre de otra persona en F1. El personal de la agencia
SHALL ver y cancelar las reservas de su agencia. La aprobación o rechazo de un pago SHALL ser exclusiva
del Admin de agencia de la agencia del pago y de una persona distinta de quien lo reportó. El Super
Admin SHALL ser de solo lectura en reservas y pagos. Ningún otro rol SHALL revisar pagos.

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

#### Scenario: Super Admin intenta cancelar
- GIVEN una reserva de una agencia
- WHEN el Super Admin intenta cancelarla
- THEN 403

#### Scenario: Revisor distinto del pagador
- GIVEN un pago reportado por el admin de A
- WHEN el mismo admin intenta aprobarlo
- THEN 403 y el pago sigue `IN_REVIEW`

## Casos límite
- Un usuario con membresía en A y rol de plataforma opera como A si fija A como agencia activa; sin
  agencia activa opera como plataforma.
- Un usuario con dos membresías que no elige agencia no puede operar en ninguna.
- El selector de agencia es UX, no seguridad: la API sigue fallando cerrada sin agencia activa.
- Un Cliente no puede convertirse en personal cambiando el cuerpo de una petición.

## Acceptance
- Matriz rol × endpoint actualizada con Cliente sin membresía, Proveedor, Admin de agencia y Super Admin.
- Pruebas de autoservicio de organización, de cliente sin membresía y de propiedad de productos.
- Prueba de que el Super Admin recibe 403 en escrituras de negocio.

## Out of scope
Inicio de sesión social, SSO, claves de acceso (passkeys). Reserva en nombre de otra persona por parte
de un Agente. Persistencia de la agencia activa entre sesiones.
