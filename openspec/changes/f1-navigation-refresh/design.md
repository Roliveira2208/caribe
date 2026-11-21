# Diseño: f1-navigation-refresh

## 1. Rutas

`defineRouting` declara `pathnames` con las mismas cadenas para `es` y `en`:

| Ruta interna | Escritorio | Móvil |
| --- | --- | --- |
| `/` | `/es`, `/en` | igual |
| `/search` | `/es/search`, `/en/search` | igual |
| `/hotels/[id]` | `/es/hotels/:id`, `/en/hotels/:id` | igual |
| `/checkout/[productId]` | `/es/checkout/:productId` | igual |
| `/login`, `/two-factor` | prefijo de idioma | igual |
| `/account/trips` | prefijo de idioma | igual |

Los directorios de `app/[locale]` pasan a `search/`, `hotels/[id]/`, `checkout/[productId]/`,
`login/`, `two-factor/`, `account/trips/`. Se eliminan `buscar/` y `hoteles/` (movidos, no
borrados). Todo `href` interno usa `Link` de `@/i18n/navigation` o `getPathname` para formularios
GET; no se construyen URL con plantillas en español. `metadata.alternateLinks` usa el mismo
mapa para canonical y hreflang.

La navegación se prueba con un script de Playwright que visita cada ruta en `es` y `en`,
comprueba `200`, ausencia del título «Página no encontrada» y que el `<html lang>` coincide con
el prefijo. Se añade como script `verify:navigation`.

## 2. Navegación pública frente a admin

No hay layout ni componente compartido: `apps/web/src/components/session-nav.tsx` y
`apps/admin/src/components/session-nav.tsx` son archivos independientes. «Seguridad» es el
enlace 2FA (TOTP) de la web pública, visible solo con sesión. Se mueve al área de cuenta
(`/account/trips`) y desaparece de la cabecera pública. El panel admin no se toca.

## 3. Portada y buscador

- La flecha de bajada es un `a` con `href="#buscar"`, `scroll-behavior: smooth` y
  `prefers-reduced-motion: reduce` → `auto`. Icono SVG decorativo, `aria-hidden`.
- La sección `#buscar` ocupa `min-h-dvh`, usa `public/images/kinetic-giro.svg` como fondo
  (Formas cinéticas en azul, ámbar y teal sobre hueso; archivo local, sin proveedor externo) y
  coloca encima el mismo `SearchPanel` de la portada, con superficie glass y radios ya aprobados.
- Segunda flecha hacia `#destacados`, sección con tarjetas leídas de `GET /products?limit=3`.
  Si no hay productos, se muestra el estado vacío i18n. No se crean datos de ejemplo.
- El panel de `/search` reutiliza `SearchPanel`; no existe un segundo componente de formulario.
  Las tarjetas de resultados (`OfferCard`) quedan intactas.

## 4. Header

`TodayRateBadgeContent` imprime `BCV <monto>` usando `formatRate` con el locale y separador de
miles/milesimas del locale. Se retiran `unit`, `datePrefix` y `valueDate` del badge; `checkout`
y el panel de pagos conservan la fecha valor. Las claves `todayRate.*` que queden sin uso se
retiran de `es.json` y `en.json` para mantener paridad.

`LanguageSwitcher` sustituye el `<select>` por dos `a`/`button` dentro de un contenedor con
`rounded-full`: `ES` y `ENG`, sin banderas, con `aria-current="true"` en el activo y cambio por
`router.replace(pathname, { locale })`. El texto visible sale de i18n (`ES`/`ENG` son códigos
de idioma, no cadenas traducidas).

## 5. Contraste y CI

`@theme` ya define los tokens. Se añade un script `verify:contrast` con Playwright que recorre
el texto visible en claro y oscuro, compone colores semitransparentes sobre el fondo heredado y
calcula el ratio WCAG; exige 4.5:1 para texto normal y 3:1 para texto grande. Se corrigen los
pares que fallan usando solo tokens aprobados (`ink`, `bone`, `teal-ink`, `coral-ink`, `amber`).
No hay workflow de CI en el repositorio: se crea `.github/workflows/web-checks.yml` con lint,
typecheck, tests, `check-specs`, `verify:navigation` y `verify:contrast`. No se añaden
dependencias: el verificador usa `@playwright/test`, ya presente como `devDependency`.

## 6. Cuenta

`GET /api/v1/bookings` devuelve `{ items: [{ id, code, status, expiresAt, totalUsd, createdAt }],
nextCursor }`. La pantalla `/account/trips` es cliente, usa el rewrite de primera parte,
muestra código, estado traducido, fecha de caducidad y total USD; estados `loading`, `error`,
`empty` y `ready`. Sin sesión redirige a `/login?redirectTo=...`. No se muestra ningún enlace
de documento: el único endpoint existente es `GET /documents/:id/download` y el listado no
expone ids.

## 7. Capturas y commits

Cada tarea tiene capturas de escritorio (1440x900) y móvil (390x844) en
`docs/plans/screenshots/f1-navigation-refresh/`, generadas antes del commit con
`pnpm --filter @caribe/web capture:screenshots`. Un commit por tarea en Conventional Commits.
