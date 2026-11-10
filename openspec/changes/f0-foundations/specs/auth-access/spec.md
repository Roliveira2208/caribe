# Delta: auth-access — f0-foundations

## MODIFIED Requirements

### Requirement: Segundo factor para roles administrativos
Admin de agencia y Super Admin SHALL activar TOTP antes de usar el panel. Mientras el segundo factor no
esté activado, la interfaz SHALL mantener al usuario en la pantalla de activación y la API SHALL rechazar
los endpoints administrativos con 403 y código de aplicación `TWO_FACTOR_REQUIRED`. La activación del
TOTP y los endpoints que no exigen permisos administrativos SHALL permanecer accesibles.

Un endpoint SHALL considerarse administrativo si está registrado bajo el prefijo `/admin` de la API o si
exige un permiso exclusivo de Admin de agencia o Super Admin. Toda ruta administrativa SHALL exigir
segundo factor activo, y el inventario de rutas SHALL comprobarse en tests.

#### Scenario: Admin sin TOTP
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN abre el panel o llama a un endpoint administrativo
- THEN la interfaz lo mantiene en la pantalla de activación de TOTP
- AND la API responde 403 con código de aplicación `TWO_FACTOR_REQUIRED`

#### Scenario: Admin sin TOTP en un endpoint no administrativo
- GIVEN un admin de agencia autenticado y sin segundo factor activado
- WHEN llama a un endpoint que no exige permisos administrativos
- THEN la API responde 2xx

#### Scenario: Ruta administrativa sin exigencia de segundo factor
- GIVEN una ruta registrada bajo el prefijo `/admin` o con permiso exclusivo administrativo
- WHEN el inventario de rutas administrativas se comprueba en los tests
- THEN la prueba falla si esa ruta no exige segundo factor
