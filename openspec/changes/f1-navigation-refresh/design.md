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
borrados). Todo `href` interno usa `Link` de `@/i18n/navigation` o el helper puro
`localizedPath` (que lee el mismo `pathnames`) para formularios GET; no se construyen URL con
plantillas en español. El helper puro mantiene las vistas probables con `react-dom/server` sin
arrastrar el resolvedor ESM de `next-intl/navigation` a Vitest. `metadata.alternateLinks` usa el
mismo mapa para canonical y hreflang.

La navegación se prueba con un script de Playwright que visita cada ruta en `es` y `en`,
comprueba `200`, ausencia del título «Página no encontrada» y que el `<html lang>` coincide con
el prefijo. Se añade como script `verify:navigation`.

## 2. Navegación pública frente a admin

No hay layout ni componente compartido: `apps/web/src/components/session-nav.tsx` y
`apps/admin/src/components/session-nav.tsx` son archivos independientes. «Seguridad» es el
enlace 2FA (TOTP) de la web pública, visible solo con sesión. Se mueve al área de cuenta
(`/account/trips`) y desaparece de la cabecera pública. El panel admin no se toca.

## 3. Portada y buscador

- La flecha de bajada es un `a` con `href="#search"`, `scroll-behavior: smooth` y
  `prefers-reduced-motion: reduce` → `auto`. Icono SVG decorativo, `aria-hidden`.
- La sección `#search` ocupa `min-h-dvh`, usa `public/images/kinetic-giro.svg` como fondo
  (Formas cinéticas en azul, ámbar y teal sobre hueso; archivo local, sin proveedor externo) y
  coloca encima el mismo `SearchPanel` de la portada, con superficie `.search-glass` y radios ya
  aprobados.
- Segunda flecha hacia `#destacados`, sección a `min-h-dvh` con tarjetas leídas de
  `GET /products?limit=3`. Si no hay productos, se muestra el estado vacío i18n. No se crean datos
  de ejemplo. Tercera flecha hacia `#cierre`, sección final a `min-h-dvh` con el CTA de cierre.
- Animación: `hero-enter` (entrada escalonada del titular, subtítulo y CTA) y `scroll-rise`
  (revelación de encabezados y tarjetas ligada al scroll con `animation-timeline: view()` cuando
  el navegador la soporta; si no, la misma animación temporal de entrada). La animación nunca
  oculta contenido de forma permanente: con `prefers-reduced-motion` se desactiva y el estado
  inicial y final son visibles, por lo que funciona también sin JavaScript.
- El panel de `/search` reutiliza `SearchPanel`; no existe un segundo componente de formulario.
  Las tarjetas de resultados (`OfferCard`) quedan intactas. Las opciones `tour`, `package` y
  `flight` dejan de estar deshabilitadas para que los enlaces del header puedan preseleccionarlas;
  conservan el sufijo «Próximamente» en su etiqueta y el catálogo vacío se muestra con honestidad.
- Las transiciones se suavizan con `ease-out` y duraciones moderadas en la entrada del hero, la
  revelación al desplazarse y el cambio de estado de la cabecera, sin ocultar contenido nunca.

## 4. Header

`TodayRateBadgeContent` imprime `BCV <monto>` usando `formatRate` con el locale y separador de
miles/milesimas del locale. Se retiran `unit`, `datePrefix` y `valueDate` del badge; `checkout`
y el panel de pagos conservan la fecha valor. Las claves `todayRate.*` que queden sin uso se
retiran de `es.json` y `en.json` para mantener paridad.

La cabecera deja de ser una franja anclada al borde: `HeaderFrame` centra una barra con
`max-w-5xl`, `top-4`, esquinas redondeadas, fondo `color-mix(in srgb, var(--color-ink) 70%,
transparent)` y `backdrop-filter: blur(20px)`. El wordmark queda a la izquierda; a la derecha se
agrupan los enlaces de productos, el badge, el selector y la sesión. En móvil el botón «Menú»
despliega el mismo contenido debajo de la barra. El `scroll-margin-top` de las anclas se mantiene
para que la barra flotante no tape los encabezados. La barra conserva `inset-inline` en móvil para
no pegarse a los bordes; el botón móvil pasa a un SVG de hamburgesa con `aria-label` traducido y
`aria-expanded`, y el icono se transforma en cruz al abrir. El contenido desplegado apila cada
producto, la tasa, el idioma y cada acción de sesión en una fila propia a ancho completo; se anula el
`flex-wrap` de escritorio dentro del menú para que nunca queden dos ítems en la misma línea. La
superficie añade un borde de 1px con mayor opacidad y un realce interior (`inset 0 1px 0`) tipo glass
de iOS; el fondo se mantiene sobre `ink` para no romper el contraste AA.

El hero reserva `padding-top` suficiente para que el título no quede bajo la barra flotante. En
viewports de hasta 700px de alto se compactan el espaciado del contenido, la altura de la
composición cinética y el relleno vertical de las secciones, de modo que la CTA quede por encima de
la flecha y los encabezados no se tapen al navegar con las anclas. `scroll-margin-top` sigue
compensando la cabecera en los destinos de las flechas.

Las flechas de sección mantienen el ancla nativa y `scroll-behavior: smooth`. Al pulsarlas, el
control baja unos píxeles mediante una transición de `transform: translateY` con la curva compartida
y vuelve a subir al liberarse; no se usa `scale`, onda de impacto ni ningún cambio brusco de tamaño.
El timer del estado pulsado dura más que la transición para que el descenso se complete antes de
volver. Con `prefers-reduced-motion` se conserva solo el cambio de fondo del estado pulsado, sin
desplazamiento. El tamaño mínimo es 44x44px y la separación inferior respeta
`env(safe-area-inset-bottom)`.

`LanguageSwitcher` es un desplegable accesible (`button[role=combobox]` + `ul[role=listbox]`)
con dos banderas SVG locales en `public/images/flags/` (Venezuela para `es`, Estados Unidos para
`en`) y las etiquetas i18n «Español» y «English». El activo lleva `aria-current="true"` y
`aria-selected`; el cambio usa `languageSwitchHref` con el router de `next/navigation`, que ya
devuelve la URL con el prefijo correcto y nunca duplica `/es` ni `/en`. No se añade una librería:
dos opciones no justifican una dependencia y los SVG funcionan en todos los sistemas.

Los enlaces de productos de la cabecera apuntan a `localizedPath(locale, "/search")` con
`?type=hotel|tour|package|flight`. Hoteles es la categoría disponible; las otras tres mantienen
su etiqueta «Próximamente» en el desplegable del buscador y en la portada.

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
