# Verificación: f1-navigation-refresh

- **Fecha:** 2026-11-21.
- **Alcance:** web pública (`apps/web`): portada, búsqueda, detalle, checkout, acceso y área de cuenta,
  en `es` y `en`. `apps/admin` queda fuera del diseño y del comportamiento especificado.
- **Rango revisado:** `d993b2e..HEAD`. Especificación: `9e04e5e` (T-NAV-0); correcciones de
  navegación `b68ffdd` (T-NAV-1), `3e267c4` (T-NAV-2), `b58f7a8` (T-NAV-3), `05858eb` (T-NAV-4),
  `975d459` (T-NAV-12), `666e2e4` (T-NAV-5), `78dfd07` (T-NAV-13), `b3f205f` (T-NAV-6),
  `bfaf709` (T-NAV-7), `6c2cf49` (T-NAV-14), `bd43a8f` (T-NAV-15), `4649503` (T-NAV-16),
  `d8be0ce` (T-NAV-8), `e8de458` (T-NAV-9), `a4285ec` (T-NAV-10), `abb7b0d` (T-NAV-17),
  `0dc11b4` (T-NAV-18) y el ajuste de T-NAV-19/20/21 (flecha con descenso suave, menú móvil apilado
  y contenido ajustado al viewport). Los commits `b44ae72` y `9ac4623` actualizan la spec antes del
  código.
  `0bd9916` es el arreglo del lock de BullMQ acordado aparte: no cambia esta spec ni su comportamiento.
- **Entorno:** web en `:3000` (`pnpm --filter @caribe/web dev`), API en `:3002`
  (`pnpm --filter @caribe/api dev`), PostgreSQL y Redis locales, datos de demostración sembrados y
  Chromium de Playwright como `devDependency` de `apps/web`.

## 1. Capturas

Directorio: `docs/plans/screenshots/f1-navigation-refresh/`. Se generaron con
`pnpm --filter @caribe/web capture:screenshots <pantalla>` y sus variantes
`CARIBE_CAPTURE_THEME=dark`, siempre antes del commit de cada tarea.

| Archivo | Tamaño comprobado | Estado documentado |
| --- | --- | --- |
| `header-desktop.png`, `header-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Cabecera flotante con glass y borde |
| `header-menu-desktop.png`, `header-menu-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Menú hamburguesa abierto y opciones apiladas |
| `home-desktop.png`, `home-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Hero y flecha de bajada, sin solapamiento con la cabecera |
| `home-arrow-pressed-desktop.png`, `home-arrow-pressed-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Estado pulsado: descenso suave, sin escala ni onda |
| `home-search-desktop.png`, `home-search-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Buscador a 100vh sobre `kinetic-giro.svg` |
| `home-reduced-motion-desktop.png` (+ `-dark-`) | 1440x900 | Todo visible sin animación |
| `featured-desktop.png`, `featured-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Tres destacados reales y «Próximamente» |
| `search-desktop.png`, `search-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Mismo formulario y resultados de la API |
| `login-desktop.png`, `login-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Acceso real |
| `account-desktop.png`, `account-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Reservas y enlace «Seguridad» |
| `detail-desktop.png`, `detail-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Detalle con fecha valor |
| `checkout-desktop.png`, `checkout-mobile.png` (+ `-dark-`) | 1440x900 / 390x844 | Checkout con fecha valor |

Revisión automatizada de las 50 imágenes: cabeceras PNG válidas leídas, dimensiones IHDR exactas
(1440x900 en escritorio, 390x844 en móvil, salvo las dos capturas de movimiento reducido, solo de
escritorio) y ninguna imagen vacía o truncada. La geometría de la cabecera y de las flechas, el menú
abierto con siete ítems apilados a ancho completo, el estado pulsado y el contraste se comprobaron
además en navegador real mediante los verificadores de la sección 3.

**Limitación:** en esta sesión no hubo inspección humana de los píxeles; la revisión fue
automatizada (DOM, geometría, estilos calculados, dimensiones y contraste). La valoración estética
final queda a criterio del dueño con las capturas adjuntas.

## 2. Matriz de escenarios

| Escenario de `specs/web-ui/spec.md` | Evidencia |
| --- | --- |
| Búsqueda en ambos idiomas | `verify:navigation`: `OK /es/search`, `OK /en/search` (200, `lang` y sin «Página no encontrada»). |
| Detalle, checkout y cuenta en ambos idiomas | `verify:navigation`: rutas `/es|en/hotels/navigation-check`, `/es|en/checkout/navigation-check` y `/es|en/account/trips`. |
| Cambio de idioma sin renombrar la ruta | `verify:navigation`: «English abre /en/search» y «Español abre /es/search»; `test/language-view.test.ts` › «cambia solo el prefijo en las rutas fijas». |
| Formulario GET localizado | `verify:navigation`: un solo formulario con `action=/es/search`; `test/search-view.test.ts` › «asocia etiquetas, envía la búsqueda por GET al locale y respeta los valores iniciales». |
| Cabecera sin Seguridad | `verify:navigation`: «cabecera sin Seguridad» en `es` y `en`. |
| Seguridad dentro de la cuenta | `verify:navigation`: «enlace Seguridad» / «enlace Security» en `/account/trips`; `account-*.png`. |
| Flecha al buscador | `verify:navigation`: «flecha al buscador» y «scroll-behavior=smooth» implícito en el desplazamiento gradual. |
| Flecha a destacados | `verify:navigation`: «flecha a destacados». |
| Foco del gesto | `verify:navigation`: «foco visible en la flecha»; `:focus-visible` ámbar en `globals.css`; `test/scroll-cue.test.ts`. |
| Gesto siempre a la vista | `verify:navigation`: 1366x768, 1280x600 y «flecha se retira al salir del hero». |
| Animación de entrada y al desplazarse | `verify:navigation`: «entrada y revelación animadas» y «animaciones desactivadas con movimiento reducido»; `test/home-animations.test.ts`. |
| Secciones a pantalla completa | `verify:navigation`: «cuatro secciones a pantalla completa», «flecha al cierre» y «CTA del cierre hacia el buscador». |
| Transiciones suaves | `verify:navigation`: «transiciones suaves con curva compartida»; `test/visual-identity.test.ts` › «comparte un ritmo suave y desactiva el movimiento de forma segura». |
| Buscador sobre fondo propio | `verify:navigation`: «buscador a 100vh con giro local»; `home-search-*.png`. |
| Un solo buscador | `verify:navigation`: «un solo formulario» y «11 destinos compartidos con /search»; `src/lib/search-labels.ts`, `src/lib/use-catalog-destinations.ts`; `test/search-view.test.ts` › «muestra los cuatro tipos activos...». |
| Destacados reales | `verify:navigation`: «3 destacados reales (Hotel Sol)»; `test/featured-stays.test.ts` › «muestra títulos y precios que vienen de la API». |
| Sin destacados | `test/featured-stays.test.ts` › «muestra un estado vacío traducido, nunca una tarjeta falsa». |
| Productos no disponibles aún | `verify:navigation`: «Tours, Paquetes y Vuelos marcados como próximamente»; `test/featured-stays.test.ts` › el escenario homónimo. |
| Badge sin fecha | `verify:navigation`: «badge compacto» en `es` y `en`; `test/today-rate-badge.test.ts` › «muestra solo BCV y el monto en espanol» y «usa el formato del locale en ingles sin fecha valor». |
| Detalle completo intacto | `test/search-view.test.ts` › «muestra el total con fechas, el equivalente VES y la fecha de la tasa»; `test/detail-view.test.ts` › «muestra la política y el equivalente VES cuando la API los envía»; `checkout-*.png`. |
| Desplegable con banderas | `verify:navigation`: «desplegable con dos banderas y activo resaltado» en ambos idiomas; SVG locales en `public/images/flags/`. |
| Cambio de idioma | `verify:navigation`: cambio a `/en/search` y a `/es/search` con bandera activa; `test/language-view.test.ts`. |
| Barra flotante | `verify:navigation`: «barra flotante centrada con cuatro productos y acciones» comprueba ancho, margen, radio, translucidez, desenfoque y transición. |
| Enlaces de productos | El mismo verificador comprueba los cuatro `href` `/<locale>/search?type=hotel|tour|package|flight`; «tipos preseleccionados y categorías próximamente honestas». |
| Acciones de la barra | El mismo verificador exige selector de idioma, badge BCV y enlace de acceso; ««Iniciar sesión» lleva al formulario real». |
| Cabecera estrecha | `verify:navigation` a 360x640: barra con margen lateral y «icono de hamburgesa accesible»; `header-menu-mobile.png`. |
| Menú vertical | `verify:navigation`: «cabecera móvil con hamburgesa y 7 ítems apilados» comprueba `aria-expanded`, `flex-direction: column`, siete filas con `top` distinto y ancho mayor de 200px; icono de cruz en `globals.css`; `header-menu-mobile.png`. |
| Borde de glass | El verificador de barra exige `border: 1px` y `box-shadow` con `inset`; `verify:contrast` en claro y oscuro. |
| Pulsación de la flecha | `verify:navigation`: «flecha con descenso suave al pulsar, sin golpe» comprueba `--cue-press-y: 6px` al pulsar, ausencia de `--cue-scale` y de `::after` con onda, y transición de `transform`; con movimiento reducido «salto inmediato» y `--cue-press-y: 0px` con el fondo visible. `test/scroll-cue.test.ts` › «baja suavemente al pulsarse, sin escalas ni ondas de impacto»; `home-arrow-pressed-*.png`. |
| Hero sin solapamiento | `verify:navigation` a 390x844 y 360x640: «hero sin solapamiento y ancho útil respetado» comprueba que título y subtítulo empiezan bajo la barra, la CTA queda sobre la flecha, el hero no supera el viewport y el ancla compensa la cabecera. |
| Secciones en pantalla baja | `verify:navigation` a 360x640 verifica los destinos de búsqueda, destacados y cierre; `globals.css` compacta espaciados y alturas con `@media (max-height: 700px)`. |
| Flecha en móvil | `verify:navigation` a 360x640: «flecha de sección dentro del viewport» mide 48x48 y respeta `env(safe-area-inset-bottom)`. |
| Texto normal y grande | `verify:contrast`: AA en 8 rutas x 2 esquemas; umbrales 4.5:1 y 3:1. |
| CI | `.github/workflows/web-checks.yml` ejecuta `verify:navigation` y `verify:contrast` tras lint, typecheck, tests y build. |
| Acceso real | `verify:navigation`: ««Iniciar sesión» lleva al formulario real» en ambos idiomas. |
| Mis viajes con reservas | `verify:navigation`: «login real y reservas desde GET /api/v1/bookings» y «reserva con estado, caducidad, total y nota honesta». |
| Mis viajes vacío o con error | `verify:navigation`: «estado vacío...» y «estado error...» traducidos y accesibles. |
| Documentos sin datos | `verify:navigation`: «sin enlaces de documentos inventados»; `test/trips-view.test.ts`. |

## 3. Comandos

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | Verde: 4 tareas, 0 errores. |
| `pnpm typecheck` | Verde: 5 tareas, 0 errores. |
| `pnpm test` | Verde en todos los paquetes; web 16 archivos y 95 pruebas, API en caché. |
| `node scripts/check-specs.mjs` | `OK: 8 specs válidas`. |
| `pnpm --filter @caribe/web verify:navigation` | Verde: 63 comprobaciones, 14 rutas en `es`/`en`, menú móvil apilado, geometría del hero, flechas y reservas. |
| `pnpm --filter @caribe/web verify:contrast` | Verde: «texto visible con contraste AA en claro y oscuro (8 rutas x 2 esquemas)». |
| `pnpm --filter @caribe/web capture:screenshots ...` | Verde; 50 PNG válidos en claro y oscuro. |

No se añadieron tipos `any` ni directivas `@ts-ignore` o `eslint-disable` en el rango revisado.
La única dependencia nueva es `@playwright/test` como `devDependency`, justificada en `design.md`
y nunca importada desde `src/`.

## 4. `apps/admin`

`git diff --name-only d993b2e..HEAD -- apps/admin` muestra únicamente `apps/admin/next-env.d.ts`,
archivo regenerado por `next dev` (rutas `.next/dev/types/...`). Se conserva commiteado para no
dejar un cambio sin versionar, según la nota de `apps/admin/AGENTS.md`. No se tocó ningún componente
ni comportamiento del panel; «Seguridad» sigue viviendo en el área de cuenta de la web pública.

## 5. Cierre

Todas las tareas de `tasks.md` están marcadas como completadas. No se hizo `git push`.
