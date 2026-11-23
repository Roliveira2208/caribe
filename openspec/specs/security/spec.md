# security Specification

## Purpose
Defensas de borde y de operación de F2: resolución de la IP real, limitación de peticiones, cabeceras
HTTP, CORS y seguridad de reembolsos. Evita que un proxy no confiable falsee la identidad de origen, que
un límite global castigue a todos los clientes y que un fallo local deje un reembolso externo sin rastro.

## Requirements

### Requirement: IP real tras proxies de confianza
La API SHALL aceptar una configuración `trustedProxies` y SHALL resolver `request.ip` a partir de la
cadena de reenvío solo cuando los saltos implicados sean de confianza. La IP SHALL NOT considerarse
siempre presente: `request.ip` puede ser `null` cuando no hay un proxy de confianza que aporte esa
información. Los consumidores de la IP SHALL tratar `null` explícitamente.

#### Scenario: IP tras proxy de confianza
- GIVEN una configuración `trustedProxies` y una petición que llega a través de esos proxies
- WHEN la API resuelve la dirección del cliente
- THEN `request.ip` es la IP real del cliente y no la del último proxy
- THEN el rate limit y la auditoría usan ese mismo valor
- THEN sin proxy de confianza el valor puede ser `null` y ningún componente asume que siempre existe

### Requirement: Cabeceras de proxies no confiables
Una cabecera de reenvío SHALL ignorarse cuando el emisor inmediato no figure en `trustedProxies`. Solo
los saltos confiables SHALL recorrerse al extraer la IP; en su defecto SHALL usarse la dirección del socket
o `null`, sin aceptar valores aportados por el cliente.

#### Scenario: Cabecera de proxy no confiable
- GIVEN una petición originada en una dirección no confiable que incluye una cabecera de reenvío falsificada
- WHEN la API resuelve la IP
- THEN la cabecera aportada por ese emisor se ignora por completo
- THEN `request.ip` no adopta la dirección falsificada y solo puede provenir del socket o ser `null`
- THEN el contador de intentos de esa IP real no se ve alterado por la cabecera

### Requirement: Límite de inicio de sesión
El límite de intentos de inicio de sesión SHALL clave por la IP real resuelta y SHALL NOT usar un bucket
global compartido por todos los clientes. Al superar el umbral SHALL responderse 429 en formato Problem
Details. Una IP falsificada SHALL NOT permitir eludir ni contaminar el contador de otra.

#### Scenario: Rate limit por IP real
- GIVEN dos clientes con IP reales distintas y una configuración de límite de inicio de sesión
- WHEN cada uno agota sus propios intentos
- THEN cada dirección tiene su propio contador y solo recibe 429 la que supera su umbral
- THEN la otra dirección sigue pudiendo intentar acceso
- THEN un cliente que falsifica la cabecera de reenvío no comparte ni esquiva el contador de la otra

### Requirement: Cabeceras de seguridad de la API
La API SHALL aplicar Helmet a todas sus respuestas, incluidas las de error y las de límite excedido, con
HSTS y `X-Content-Type-Options: nosniff` entre las cabeceras emitidas. Ninguna ruta SHALL suprimir estas
cabeceras ni responder con valores que las contradigan.

#### Scenario: Cabeceras de seguridad en la API
- GIVEN rutas de `/api/v1/*` y `/api/auth/*`, incluidas sus respuestas de error y 429
- WHEN se inspeccionan las cabeceras de cada respuesta
- THEN están presentes HSTS y `X-Content-Type-Options: nosniff`
- THEN el conjunto de cabeceras de seguridad no cambia entre respuestas correctas y fallidas

### Requirement: Política de seguridad de contenido
Las respuestas HTML del panel administrativo SHALL enviar una Content Security Policy que prohíba scripts inline, sin
`'unsafe-inline'` en `script-src`. Todo script necesario SHALL servirse desde un recurso externo o mediante
una estrategia de nonces o hashes definida en el diseño.

#### Scenario: CSP sin scripts inline
- GIVEN una respuesta HTML del panel administrativo
- WHEN se evalúa su cabecera CSP y su contenido
- THEN `script-src` no incluye `'unsafe-inline'` ni permite ejecutar scripts escritos dentro del HTML
- THEN los scripts que se ejecutan proceden de recursos externos o de la estrategia de nonces o hashes aprobada
- THEN la política se aplica también a las páginas de error del panel

### Requirement: CORS con orígenes de confianza
El CORS SHALL permitir únicamente los orígenes listados en `TRUSTED_ORIGINS`. Para un origen permitido
SHALL devolverse ese mismo origen en `Access-Control-Allow-Origin`, sin comodines, y SHALL NOT habilitarse
credenciales para ningún otro origen.

#### Scenario: CORS con orígenes permitidos
- GIVEN una lista `TRUSTED_ORIGINS` y una solicitud de preflight con uno de esos orígenes
- WHEN la API responde al preflight
- THEN `Access-Control-Allow-Origin` contiene exactamente el origen solicitado
- THEN la respuesta incluye los métodos y cabeceras permitidos y, cuando corresponde, el permiso de credenciales
- THEN no se usa `*` ni un origen distinto del solicitado

### Requirement: Rechazo de orígenes desconocidos
Todo origen ausente de `TRUSTED_ORIGINS` SHALL recibir un rechazo sin cabeceras de autorización CORS. La
API SHALL NOT reflejar el origen desconocido ni devolver `Access-Control-Allow-Credentials` en ese caso.

#### Scenario: CORS con origen desconocido
- GIVEN un origen que no figura en `TRUSTED_ORIGINS`
- WHEN envía una solicitud de preflight
- THEN la respuesta no incluye `Access-Control-Allow-Origin` ni `Access-Control-Allow-Credentials`
- THEN el origen recibido no se refleja en ninguna cabecera ni se autoriza el uso de credenciales
- THEN el navegador bloquea el acceso entre orígenes

### Requirement: Límite de creación de reservas
La creación de reservas SHALL estar sujeta a un límite de peticiones por IP real o actor autenticado. Al
superarse SHALL responderse 429 con `application/problem+json` y los campos definidos en `api-errors`, con
un `code` estable registrado antes de usarse. La reserva SHALL NOT crearse ni bloquear cupo en una petición
rechazada.

#### Scenario: Límite en creación de reservas
- GIVEN una configuración de límite para `POST /bookings`
- WHEN un cliente supera ese límite
- THEN recibe 429 con un cuerpo Problem Details y un `code` estable
- THEN no se crea la reserva, no se bloquea disponibilidad y no se escribe auditoría de reserva
- THEN el contador se asocia a la IP real o al actor, no a un bucket global

### Requirement: Límite de alta y revisión de pagos
El alta de pagos y su revisión SHALL aplicar límites propios por IP real o actor autenticado. Al superarse
SHALL responderse 429 en formato Problem Details. Ninguna petición rechazada SHALL cambiar el estado del
pago ni de la reserva.

#### Scenario: Límite en alta y revisión de pagos
- GIVEN un pago en revisión y límites configurados para el alta y la revisión
- WHEN un actor supera el límite en cualquiera de esas dos operaciones
- THEN recibe 429 con un cuerpo Problem Details y un `code` estable
- THEN el pago sigue en revisión, sin aprobación, rechazo ni nueva fila de pago
- THEN la reserva vinculada no cambia de estado

### Requirement: Límite de descargas
La descarga de documentos SHALL estar limitada por IP real o actor autenticado. Al superarse SHALL
responderse 429 en formato Problem Details, sin entregar el archivo ni parte de él y sin revelar su
ruta interna.

#### Scenario: Límite en descargas
- GIVEN un documento disponible y un límite de descargas configurado
- WHEN un actor supera ese límite
- THEN recibe 429 con un cuerpo Problem Details y un `code` estable
- THEN no se entrega ningún byte del documento ni se expone la ruta del archivo
- THEN una descarga permitida con posterioridad sigue funcionando con el mismo documento

### Requirement: Idempotencia de reembolsos
Todo reembolso SHALL identificarse con un `refundId` enviado por el cliente y guardado con la fila. Repetir
la misma petición con el mismo `refundId` SHALL devolver el resultado original sin provocar un segundo
reembolso externo. Un `refundId` nuevo sobre un pago ya reembolsado SHALL responder 409 con
`REFUND_ALREADY_ISSUED`, según `payments`.

#### Scenario: Reembolso idempotente
- GIVEN un reembolso ya registrado con su `refundId` y un pago reembolsado
- WHEN se repite la petición con el mismo `refundId` y el mismo cuerpo
- THEN se devuelve el resultado original sin crear otra fila ni invocar dos veces al proveedor
- WHEN se repite con un `refundId` distinto sobre el mismo pago
- THEN responde 409 con `REFUND_ALREADY_ISSUED` y no se emite otro reembolso
- THEN la respuesta revela el estado del reembolso, nunca secretos del proveedor

### Requirement: Efectos externos y rollback
El sistema SHALL registrar la intención de reembolso de forma atómica con la transacción local, mediante
una fila en `refunds` o un registro en outbox, antes de invocar al proveedor externo a través de
`PaymentProvider`. Un rollback local SHALL NOT dejar una llamada externa de reembolso sin fila que la
represente. Si la respuesta del proveedor llega después de confirmada la fila, SHALL conservarse como
pendiente para su reconciliación.

#### Scenario: Rollback sin reembolso externo
- GIVEN una cancelación que debe reembolsar y un proveedor externo accesible mediante `PaymentProvider`
- WHEN la transacción local se revierte antes de despachar la operación externa
- THEN no se llama al proveedor y no queda ningún reembolso externo sin fila local
- WHEN el proveedor confirma el reembolso pero falla el registro local del resultado
- THEN la fila existente queda marcada como pendiente, sin crear una segunda llamada al proveedor

### Requirement: Reconciliación de reembolsos
La reconciliación SHALL revisar periódicamente los reembolsos pendientes contra el proveedor a través de
`PaymentProvider`, SHALL actualizar su estado y SHALL dejar constancia en `audit_logs`. Un resultado ya
aplicado SHALL NOT volver a emitirse. Los casos no resueltos SHALL seguir pendientes y SHALL reportarse,
sin borrar la fila ni inventar un éxito.

#### Scenario: Reconciliación de reembolsos
- GIVEN reembolsos pendientes, algunos ya aplicados por el proveedor y otros no
- WHEN se ejecuta la reconciliación
- THEN los ya aplicados pasan a su estado final sin una segunda llamada de reembolso
- THEN los que aún no están aplicados conservan su estado pendiente y se registran para nueva revisión
- THEN cada cambio de estado queda en `audit_logs` con el `refundId` implicado

## Casos límite

- `request.ip` puede ser `null` sin proxy de confianza: ningún límite, auditoría o mensaje asume que siempre
  hay una dirección.
- Una cadena de reenvío con varios valores se recorre solo desde saltos confiables; el resto se descarta.
- `trustedProxies` y sus direcciones o rangos se definen en el despliegue: no se fijan en esta spec.
- Umbrales y ventanas de los límites de login, reservas, pagos y descargas: se definen en el diseño, sin
  valores en esta spec.
- Pregunta abierta: ¿qué clave de limitación se usa cuando `request.ip` es `null` sin caer en un bucket
  global anónimo?
- Pregunta abierta: ¿qué `code` estable se añade a `api-errors` para las respuestas 429 de los límites?
- Pregunta abierta: ¿la CSP usa nonces o hashes, y cómo se generan por respuesta?
- `TRUSTED_ORIGINS` vacío significa denegar todos los orígenes; nunca se admite un comodín con credenciales.
- `refundId` repetido con un cuerpo distinto: se rechaza como conflicto, sin modificar el reembolso original.
- Proveedor de pagos caído durante la reconciliación: la fila sigue pendiente y se reintenta en la siguiente
  pasada, sin duplicar el reembolso.

## Acceptance

- Tests de resolución de IP cubren proxy de confianza, proxy no confiable y el caso `null`.
- El límite de login se prueba con dos IP reales distintas; ningún bucket global agrupa a los clientes.
- Se verifican en tests las cabeceras de Helmet, la CSP sin scripts inline y el comportamiento CORS para
  orígenes permitidos y desconocidos.
- Las respuestas 429 de reservas, pagos y descargas usan Problem Details y no producen efectos de negocio.
- Tests de fallo inyectado cubren idempotencia por `refundId`, rollback sin efecto externo huérfano y
  reconciliación sin doble reembolso.
- Las preguntas abiertas se resuelven en `design.md` antes de implementar; lint, typecheck y tests en verde.

## Out of scope

- Firewall, WAF, Attack Mode y reglas de rate limit de la plataforma de despliegue.
- Autenticación por token, API keys, SSO, OAuth o cambios en las rutas de Better Auth: requieren change propia.
- Cobro real con tarjeta, pasarelas nuevas y conciliación bancaria de extractos.
- Gestión de secretos de `TRUSTED_ORIGINS` o `trustedProxies`: se rige por la configuración del entorno.
