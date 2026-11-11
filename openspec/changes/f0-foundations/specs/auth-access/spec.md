# Delta: auth-access — f0-foundations

## MODIFIED Requirements

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

#### Scenario: Activación de TOTP accesible
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN llama a las rutas de activación de `/api/auth/two-factor/*`
- THEN la API responde 2xx

#### Scenario: Ruta administrativa sin exigencia de segundo factor
- GIVEN una ruta registrada bajo el prefijo `/admin` o con permiso exclusivo administrativo, o una ruta administrativa del middleware de Better Auth
- WHEN el inventario de rutas administrativas se comprueba en los tests
- THEN la prueba falla si esa ruta no exige segundo factor
