# Delta: web-ui — f1-hotels-e2e

## ADDED Requirements

### Requirement: Destino público del QR del voucher
El código QR del voucher SHALL llevar a una ruta pública de la web que exista en ambos idiomas. La
ruta SHALL ser fija e independiente del idioma (`/reservas/:code`, con prefijo `es` o `en`) y SHALL
registrarse en la configuración de enrutamiento junto al resto de rutas públicas. La página SHALL
mostrar únicamente el código de la reserva y una invitación a iniciar sesión para consultar «Mis
reservas». SHALL NOT mostrar datos personales, importes, estados, tokens ni pistas sobre la agencia;
SHALL NOT exigir sesión para abrirse.

#### Scenario: QR abre una página real en ambos idiomas
- GIVEN el QR de un voucher con código `CR-2026-0001`
- WHEN se abre `/es/reservas/CR-2026-0001` y `/en/reservas/CR-2026-0001`
- THEN ambas rutas devuelven 200, muestran el código y ofrecen iniciar sesión
- THEN el segmento `reservas` no cambia al cambiar de idioma

#### Scenario: Página sin datos de la reserva
- GIVEN la página pública del código
- WHEN se inspecciona su contenido
- THEN no aparece el nombre del viajero, el total, el estado ni la agencia

#### Scenario: Código con caracteres especiales
- GIVEN un código con caracteres que requieren codificación en la URL
- WHEN se abre su página
- THEN se muestra el código descodificado sin interpretarlo como HTML
