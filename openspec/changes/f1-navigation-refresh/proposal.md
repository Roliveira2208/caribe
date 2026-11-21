# Propuesta: f1-navigation-refresh

## Por qué

La navegación pública de F1 tiene rutas en español dentro del prefijo de idioma. Como
`defineRouting` no declara `pathnames`, next-intl solo añade `/es` o `/en`: las URL canónicas
que siguen el acuerdo de arquitectura (`/search`, `/hotels/:id`, `/checkout`, `/account/trips`)
caen en el atrapatodo `[locale]/[...rest]` y responden 404 con «Página no encontrada». Además,
la portada y la búsqueda no comparten yet la misma jerarquía visual, el badge de tasa y el
selector de idioma tienen detalles que contradicen el sistema aprobado, y «Iniciar sesión» no
lleva a una pantalla de reservas del cliente.

Reproducción exacta en el servidor de desarrollo (2026-11-21):

- `GET /es/search` → 404, HTML con `notFound.title = "Página no encontrada"`.
- `GET /en/search` → 404, mismo resultado en inglés.
- `GET /en/hoteles/<id>` → 200: demuestra que el prefijo es inglés pero la ruta sigue en español.

## Qué se propone

1. Rutas internas fijas en inglés para todos los idiomas, con `pathnames` de next-intl. El prefijo
   `/es` o `/en` permanece (SDD §9); el selector nunca cambia el nombre de la ruta.
2. Separar la navegación pública de la del panel admin: «Seguridad» es un enlace 2FA propio de la
   web pública, no del admin. Se mueve al área de cuenta, no a la cabecera.
3. Portada: flecha de bajada al buscador, buscador a 100vh con fondo «giro» propio y flecha a
   hoteles destacados con datos reales del catálogo. Tours, paquetes y vuelos siguen marcados
   como «Próximamente». Las tarjetas de hotel existentes no se modifican.
4. Header: badge `BCV 45,20` sin fecha; píldora de idioma `ES | ENG` sin banderas.
5. Contraste AA en claro y oscuro con verificación automatizada y paso de CI.
6. Login real y pantalla `/account/trips` con reservas del usuario, estado y nota honesta sobre
   documentos (no hay endpoint de listado de documentos por reserva).
7. Un único buscador compartido entre portada y `/search`.

## Decisiones tomadas con el dueño

- Se conserva `localePrefix: "always"`. Cambiar de idioma cambia el prefijo, nunca la ruta.
- «Seguridad» se mueve al área de cuenta; no se elimina la pantalla 2FA.
- «Mis viajes» usa `GET /api/v1/bookings`. No se inventa un endpoint de documentos: se muestra
  un mensaje i18n de que los documentos se publican al confirmar el pago.

## Fuera de alcance

- `apps/admin` y cualquier cambio de sus fuentes.
- Pagos, confirmación, cancelación y descargas posteriores a la reserva.
- Modificar las tarjetas de hotel ya existentes.
- Cambiar las decisiones D1–D15 del SDD.
