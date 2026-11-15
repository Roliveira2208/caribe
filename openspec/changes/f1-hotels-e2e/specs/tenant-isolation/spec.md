# Tenant Isolation Specification

> Spec nueva de `f1-hotels-e2e`. Al archivar la change se mueve tal cual a
> `openspec/specs/tenant-isolation/spec.md`.

## Purpose
Aislar los datos de cada agencia y de cada persona. El catálogo es público y cruza agencias a
propósito; las reservas, pagos, documentos y ajustes no. Un cliente sin membresía debe poder ver y
pagar solo lo suyo aunque no tenga agencia activa, y el personal de una agencia no debe ver nada de
otra. Ningún contexto implícito concede acceso: sin contexto explícito, la base no devuelve filas.

## Requirements

### Requirement: Contextos de datos explícitos
Toda lectura o escritura sobre una tabla de negocio SHALL ejecutarse en uno de los contextos
siguientes:

- `public`: catálogo anónimo; solo lectura de productos publicados, su disponibilidad y los destinos
  que referencian.
- `tenant`: personal de una agencia con organización activa.
- `owner`: persona sobre sus propias filas, sin exigir membresía ni organización activa.
- `tenant`+`owner`: cliente que opera sobre una reserva propia dentro de una agencia (por ejemplo, al
  pagar); se fijan ambos GUC y las políticas combinan con OR.
- `platform`: Super Admin de plataforma; lectura de todas las agencias y de las filas de plataforma, y
  escritura únicamente de overrides globales de `exchange_rates` (`tenant_id` NULL).
- `rates_global`: trabajo diario de la tasa BCV; solo escribe filas de `exchange_rates` con
  `tenant_id` NULL y no lee ni escribe ninguna otra tabla.

Sin contexto, la base SHALL devolver cero filas y SHALL rechazar toda escritura. Un contexto SHALL
NOT heredarse de una petición, transacción o trabajo anterior.

#### Scenario: Sin contexto no se lee
- GIVEN una tabla de negocio con filas de una agencia
- WHEN se consulta sin fijar contexto
- THEN la consulta devuelve cero filas

#### Scenario: Sin contexto no se escribe
- GIVEN una conexión sin contexto
- WHEN se intenta insertar una fila con `tenant_id`
- THEN la base rechaza la escritura

#### Scenario: Contexto de agencia no ve otra agencia
- GIVEN filas de las agencias A y B
- WHEN se consulta con el contexto de la agencia A
- THEN solo se devuelven las filas de A

#### Scenario: Contexto de plataforma ve todas las agencias
- GIVEN filas de las agencias A y B y filas de plataforma con `tenant_id` NULL
- WHEN se consulta con el contexto de plataforma
- THEN se devuelven las filas de A, de B y las de plataforma

#### Scenario: Contexto de plataforma escribe tasas globales
- GIVEN el contexto de plataforma
- WHEN escribe un override de `exchange_rates` con `tenant_id` NULL
- THEN la escritura se acepta y la fila queda con `is_override = true`

#### Scenario: Contexto de plataforma no escribe filas de agencia
- GIVEN el contexto de plataforma
- WHEN intenta escribir una fila de `exchange_rates` con `tenant_id` de una agencia o cualquier fila de
  otra tabla de negocio
- THEN la base rechaza la escritura

#### Scenario: Contexto de agencia no ve filas de plataforma
- GIVEN filas de plataforma con `tenant_id` NULL
- WHEN se consulta con el contexto de la agencia A
- THEN las filas de plataforma no aparecen, salvo las tasas globales de `exchange_rates`, que toda
  agencia puede leer

#### Scenario: Catálogo público no ve borradores
- GIVEN un producto `PUBLISHED`, uno `DRAFT` y uno con borrado lógico
- WHEN se consulta el catálogo con el contexto `public`
- THEN solo aparece el `PUBLISHED` sin borrado lógico

#### Scenario: Catálogo público no escribe
- GIVEN el contexto `public`
- WHEN se intenta insertar, actualizar o borrar un producto, una disponibilidad o un destino
- THEN la base rechaza la escritura

### Requirement: Política combinada por agencia o propietario
En las tablas con dueño directo, la política SHALL permitir el acceso cuando la fila pertenece a la
agencia activa O cuando su propietario es el de la sesión: `bookings` por `user_id` y `payments` por
`reported_by`. `idempotency_keys` SHALL tener RLS solo por `user_id` —sin `tenant_id`— y su política
SHALL ser `user_id = app.user_id` tanto en lectura como en escritura. En las tablas hijas
(`booking_items`, `refunds`, `documents`), la política SHALL derivar el propietario del `booking`
padre mediante `EXISTS`, porque la línea no tiene dueño propio. La misma condición SHALL aplicarse en
escritura: una persona SHALL NOT insertar ni modificar filas de otra persona ni de otra agencia. En las
tablas sin dueño (`providers`, `destinations`, `products`, `availability`, `cancellation_policies`,
`tenant_settings`), solo la agencia activa o el contexto `platform` (lectura) SHALL dar acceso; el
contexto `public` solo SHALL leer catálogo publicado y los destinos que referencia, sin datos internos. `exchange_rates` añade la lectura de filas globales (`tenant_id` NULL)
para los contextos `tenant`, `owner` y `public`; la escritura global se permite con `rates_global` y con
`platform`, siempre que la fila tenga `tenant_id` NULL. `rates_global` no puede leer ni escribir ninguna
otra tabla ni filas de agencia; `platform` tampoco escribe filas de agencia.

#### Scenario: Cliente A no ve la reserva de cliente B
- GIVEN una reserva de otra persona
- WHEN un cliente la consulta con su propio contexto
- THEN la API responde 404

#### Scenario: Agente de A no ve una reserva de B
- GIVEN una reserva de la agencia B
- WHEN un agente de la agencia A la consulta con su organización activa
- THEN la API responde 404

#### Scenario: Personal de A ve las reservas de su agencia
- GIVEN reservas de las agencias A y B
- WHEN un admin de A lista las reservas con su organización activa
- THEN solo recibe las de A

#### Scenario: Cliente no puede escribir con un `user_id` ajeno
- GIVEN una sesión de cliente A
- WHEN envía una reserva con el `user_id` de B
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea
- AND una inserción directa en la base con el `user_id` de B se rechaza

#### Scenario: Agente no puede insertar en otra agencia
- GIVEN una sesión con organización activa A
- WHEN se intenta insertar directamente en la base una reserva con `tenant_id` de B
- THEN la base rechaza la escritura

#### Scenario: Cliente sin membresía ve su propia reserva
- GIVEN un cliente sin organización activa y una reserva suya en la agencia A
- WHEN consulta su reserva
- THEN la API responde 200

#### Scenario: Claves de idempotencia no cruzan usuarios
- GIVEN una clave de idempotencia del usuario A
- WHEN el usuario B envía la misma clave
- THEN se trata como una clave nueva de B, sin devolver la respuesta de A
- AND con el contexto `owner` de B la base no devuelve la fila de A

### Requirement: Resolución del tenant del cliente
Al crear una reserva el servidor SHALL resolver la agencia desde el producto, nunca desde el cuerpo ni
desde la organización activa, y SHALL fijar `user_id` desde la sesión. Para leer, cancelar o descargar,
el servidor SHALL usar el contexto `owner` y SHALL NOT exigir organización activa. Para pagar SHALL
verificar primero que la reserva es del usuario y luego fijar el contexto combinado `tenant`+`owner` de
esa reserva, de modo que pueda leer la tasa de la agencia y escribir el pago sin abrir el resto de la
agencia. Una persona SHALL poder tener reservas en varias agencias y verlas todas en "Mis reservas".
El personal de una agencia SHALL ver las reservas de su agencia con el contexto `tenant`.

#### Scenario: Cliente sin membresía reserva en una agencia
- GIVEN un cliente autenticado sin membresía y un producto publicado de la agencia A
- WHEN crea una reserva
- THEN la reserva queda con `tenant_id` de A y el `user_id` de la sesión

#### Scenario: Cuerpo con agencia o usuario ajenos
- GIVEN una reserva de un producto de la agencia A
- WHEN el cuerpo incluye `tenant_id` de B o un `user_id` distinto al de la sesión
- THEN 422 con código `VALIDATION_ERROR` y la reserva no se crea

#### Scenario: Cliente con reservas en dos agencias
- GIVEN un cliente con una reserva en A y otra en B
- WHEN consulta "Mis reservas"
- THEN ve ambas reservas

#### Scenario: Cliente no ve la reserva de otra persona
- GIVEN una reserva de otra persona
- WHEN el cliente la consulta por id
- THEN la API responde 404

#### Scenario: Personal de A no ve una reserva de B
- GIVEN una reserva de B
- WHEN un admin de A la consulta con su organización activa
- THEN la API responde 404

#### Scenario: Cliente no accede a endpoints de agencia
- GIVEN un cliente autenticado sin membresía
- WHEN llama a un endpoint que exige organización activa
- THEN la API responde 403 con código `ACTIVE_ORGANIZATION_REQUIRED`

### Requirement: Trabajos de fondo por agencia
Los trabajos que operan datos de agencia SHALL recorrer las agencias una por una, cada una en su propio
contexto `tenant` y su propia transacción. Un fallo en una agencia SHALL NOT impedir procesar las
demás. El trabajo de la tasa BCV SHALL usar el contexto `rates_global` y operar solo sobre filas
globales (`tenant_id` NULL), sin abrir contexto de agencia. Ningún trabajo SHALL usar el contexto
`platform` ni un rol de base de datos que ignore RLS.

#### Scenario: La expiración solo toca su agencia
- GIVEN reservas vencidas en A y en B
- WHEN corre el trabajo de expiración de A
- THEN solo cambian las reservas de A

#### Scenario: Un fallo en A no detiene B
- GIVEN una agencia A que falla al procesar y una agencia B con reservas vencidas
- WHEN corre el trabajo de expiración
- THEN el fallo de A se registra y las reservas de B se procesan igual

#### Scenario: El trabajo de la tasa es global
- GIVEN la fuente BCV disponible
- WHEN corre el trabajo diario de tasa
- THEN escribe o actualiza solo filas con `tenant_id` NULL

#### Scenario: El trabajo de la tasa no lee datos de agencia
- GIVEN el trabajo diario de tasa
- WHEN se ejecuta
- THEN no abre contexto de agencia y no lee reservas, pagos ni auditoría

#### Scenario: El trabajo de la tasa no toca otras tablas
- GIVEN el contexto `rates_global`
- WHEN se intenta leer `bookings`, `payments`, `products` o `tenant_settings`
- THEN la base devuelve cero filas

#### Scenario: El trabajo de la tasa no escribe filas de agencia
- GIVEN el contexto `rates_global`
- WHEN se intenta insertar o actualizar una fila de `exchange_rates` con `tenant_id` de una agencia
- THEN la base rechaza la escritura

#### Scenario: Sin rol que ignore RLS
- GIVEN el rol de base de datos de los trabajos
- WHEN se inspeccionan sus atributos
- THEN no tiene `BYPASSRLS` ni privilegios de superusuario

### Requirement: Verificación con el rol de aplicación
Las pruebas de aislamiento SHALL ejecutarse con el rol de base de datos de la aplicación, sin
privilegios de superusuario ni `BYPASSRLS`, y SHALL comprobar lectura y escritura. Una tabla de negocio
nueva sin RLS habilitada y forzada SHALL hacer fallar la suite de aislamiento.

#### Scenario: Rol de aplicación sin contexto no ve nada
- GIVEN el rol de aplicación conectado sin contexto
- WHEN consulta cualquier tabla de negocio
- THEN obtiene cero filas

#### Scenario: Tabla nueva sin RLS
- GIVEN una migración que crea una tabla de negocio sin RLS habilitada y forzada
- WHEN corre la suite de aislamiento
- THEN la suite falla nombrando la tabla

#### Scenario: RLS forzada también para el dueño
- GIVEN una tabla de negocio con RLS forzada
- WHEN el rol dueño consulta sin contexto
- THEN tampoco obtiene filas

#### Scenario: `rates_global` probado como el rol de aplicación
- GIVEN el contexto `rates_global`
- WHEN la suite ejecuta lecturas y escrituras como `caribe_app`
- THEN solo puede escribir filas globales de `exchange_rates` y el resto se rechaza o devuelve cero filas

## Casos límite
- `tenant_id` vacío o nulo en una tabla que lo exige → la escritura se rechaza; no se interpreta como
  plataforma.
- Un contexto `owner` no concede lectura de catálogo no publicado ni de ajustes de la agencia.
- Un contexto `public` no concede lectura de disponibilidad de productos no publicados.
- `idempotency_keys` es una tabla técnica sin `tenant_id`: su único es `(user_id, endpoint, key)`, su
  RLS es solo por `user_id` y la agencia se resuelve después de consumir la clave.
- Las filas globales de `exchange_rates` (`tenant_id` NULL) son legibles por cualquier agencia y por el
  catálogo público; las escribe solo `rates_global` y, para overrides de plataforma, `platform`, ambos
  limitados a filas globales. Ninguno de los dos escribe filas de agencia.
- Cambiar de agencia activa en la misma sesión no arrastra filas de la agencia anterior: cada
  transacción fija su contexto.

## Acceptance
- Pruebas de aislamiento entre dos agencias y entre dos clientes, ejecutadas como el rol de aplicación.
- Inventario de tablas de negocio que falla si una tabla no tiene RLS habilitada y forzada.
- Prueba de que el catálogo público ve productos de dos agencias y ningún borrador.
- Prueba de `rates_global` como `caribe_app`: solo escribe filas globales de `exchange_rates` y no lee
  otras tablas.
- Prueba de `platform` como `caribe_app`: escribe overrides globales de `exchange_rates` y no escribe
  filas de agencia ni de otras tablas.

## Out of scope
SaaS multiagencia con dominios y planes, contexto `system` para trabajos y roles de base de datos con
`BYPASSRLS`. Aislamiento a nivel de fila para el catálogo más allá de `PUBLISHED` y borrado lógico.
