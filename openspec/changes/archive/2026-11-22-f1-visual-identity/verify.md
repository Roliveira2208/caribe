# Verificación: f1-visual-identity

- **Fecha:** 2026-11-21.
- **Alcance:** inicio, búsqueda, detalle y checkout de `apps/web`; `apps/admin` queda fuera.
- **Rango revisado:** `3b4e1f8..HEAD`. Commits de pantalla: `f4b1f2b` (inicio), `da47c65` (búsqueda), `b53c671` (detalle) y `1803c2b` (checkout).
- **Entorno:** web en `:3000`, API en `:3002`, PostgreSQL y Redis locales. La API se levantó desde `dist` y la web con `pnpm --filter @caribe/web dev`.

## 1. Capturas

Directorio: `docs/plans/screenshots/f1-visual-identity/`. Todas se generaron con `pnpm --filter @caribe/web capture:screenshots` antes del commit correspondiente, con Playwright como `devDependency` y sin importarlo desde `src/`.

| Archivo | Tamaño comprobado | Estado documentado |
| --- | --- | --- |
| `home-desktop.png` | 1440x900 | Hero y cabecera flotante inicial |
| `home-mobile.png` | 390x844 | Hero y cabecera en móvil |
| `home-search-desktop.png` | 1440x900 | Buscador revelado tras scroll |
| `home-search-mobile.png` | 390x844 | Buscador revelado en móvil |
| `home-reduced-motion-desktop.png` | 1440x900 | Panel final con `prefers-reduced-motion: reduce` |
| `search-desktop.png` | 1440x900 | Resultados cargados desde la API real |
| `search-mobile.png` | 390x844 | Resultados en móvil |
| `detail-desktop.png` | 1440x900 | `data-detail-status="ready"` |
| `detail-mobile.png` | 390x844 | `data-detail-status="ready"` |
| `checkout-desktop.png` | 1440x900 | `data-checkout-status="ready"` |
| `checkout-mobile.png` | 390x844 | `data-checkout-status="ready"` |
| `checkout-success-desktop.png` | 1440x900 | `data-checkout-status="success"`, código `CRB-CARIBE01` |
| `checkout-success-mobile.png` | 390x844 | `data-checkout-status="success"`, código `CRB-CARIBE01` |

Revisión automatizada de las 13 imágenes: dimensiones exactas, ventanas PNG válidas y entre 199 y 480 colores muestreados por imagen, sin capturas vacías. El flujo de checkout se verificó además en navegador real: `status=ready`, 2 radios de moneda, 4 campos de viajero, `scrollWidth` igual al ancho del viewport, sin elementos desbordados, sin errores de consola, cuerpo enviado con exactamente `checkIn`, `checkOut`, `productId`, `quantity` y `travelers`, y permanencia en `/es/checkout/...` tras el éxito.

**Limitación:** en esta sesión no hubo inspección visual humana de los píxeles; la revisión fue automatizada (DOM, dimensiones, muestreo de color y ausencia de errores). La valoración estética final queda a criterio del dueño con las capturas adjuntas.

## 2. Matriz de escenarios

| Escenario de `specs/web-ui/spec.md` | Evidencia |
| --- | --- |
| Token de marca en pantalla pública | `test/visual-identity.test.ts` › «define la paleta aprobada y los tokens dark sin Selector de tema»; capturas de las cuatro pantallas. |
| Tipografías auto-alojadas | `test/visual-identity.test.ts` › «auto-aloja las dos fuentes aprobadas»; `src/app/[locale]/layout.tsx`; archivos en `public/fonts/` y licencia ITF FFL versionada. |
| Modo oscuro sin control visible | `test/visual-identity.test.ts` › «define la paleta aprobada y los tokens dark sin Selector de tema»; capturas sin selector ni interruptor. |
| Header sobre el hero | `test/visual-identity.test.ts` › «declara el fondo solido antes del soporte de backdrop-filter»; `home-desktop.png` y `home-mobile.png`. |
| Header tras el desplazamiento | Misma prueba de CSS para `data-scrolled="true"`; `home-search-*.png`, capturadas después de `scrollIntoViewIfNeeded()`. |
| Wordmark sin logo ficticio | `test/visual-identity.test.ts` › «la cabecera empieza flotante y expone el menu movil»; capturas de inicio. |
| Revelación al entrar en viewport | `test/visual-identity.test.ts` › «el panel empieza pendiente y se revela una sola vez», con `observer.disconnect()` en `search-reveal.tsx`; `home-search-*.png`. |
| Movimiento reducido | Comprobación del script de capturas sobre `opacity`, `clipPath` y `transform`; `home-reduced-motion-desktop.png`; prueba CSS de `prefers-reduced-motion`. |
| Animaciones permitidas | `src/app/globals.css`: sin `@keyframes` y transiciones solo de `opacity`, `clip-path` y `transform`; prueba «respeta movimiento reducido sin animar otras propiedades». |
| Navegación por teclado | `src/app/globals.css` define `:focus-visible` con `outline: 2px solid var(--color-amber)` y `outline-offset: 2px`; etiquetas asociadas en `search-panel.tsx`, `product-detail-view.tsx` y `checkout-view.tsx`; capturas de las cuatro pantallas. |
| Error de formulario | `test/search-view.test.ts` › «anuncia el rango de precio inválido»; `test/checkout-view.test.ts` › «asocia el error de viajeros al bloque y no permite reservar sin datos» y «asocia el error al bloque cuando no queda ningún viajero»; `role="alert"`, `aria-describedby` y `aria-invalid`. |
| Sin cadenas fijas | `test/messages.test.ts` › «toda clave usada en src existe en es y en» y «los archivos fuente usan mensajes»; `messages/es.json` y `messages/en.json` con claves equivalentes. |
| Vocabulario de acción | `test/checkout-view.test.ts` › «muestra estancia, resumen USD y viajeros sin enviar la moneda» (`>Reservar</button>`) y «muestra el código y Pago en revisión sin navegar a otra ruta». |
| Sin decoradores tipográficos | `test/visual-identity.test.ts` › «no usa punto medio, guion largo ni flecha de relleno en las pantallas F1»; comprobación adicional en vistas de detalle y checkout. |
| Detalle de producto público | `test/detail-view.test.ts` › «muestra título, descripción, USD, fotos vacías, disponibilidad y CTA con fechas», «muestra la política y el equivalente VES cuando la API los envía»; `detail-*.png`. |
| Detalle sin tasa | `test/detail-view.test.ts` › «oculta el VES sin tasa y muestra el estado sin política»; la instancia local no expuso `basePriceVes` y la captura no inventa un equivalente. |
| Checkout con moneda elegida | `test/checkout-view.test.ts` › «envía solo productId, fechas, cantidad y viajeros saneados» y «usa importes VES del servidor cuando se elige esa presentación»; aserción del mock en `capture-screenshots.mjs` sobre las claves del cuerpo; `checkout-*.png`. |
| Checkout sin viajeros | `test/checkout-view.test.ts` › «rechaza el envío sin viajeros o con correo inválido» y «asocia el error al bloque cuando no queda ningún viajero». |
| Reserva creada | `test/checkout-view.test.ts` › «muestra el código y Pago en revisión sin navegar a otra ruta»; aserción del mock de reserva 201; `checkout-success-*.png`. |

Comprobación adicional del caso límite «sin JavaScript»: `test/search-view.test.ts` › «asocia etiquetas, envía la búsqueda por GET al locale y respeta los valores iniciales» y `search-panel.tsx` con `<form method="get" action="/${locale}/buscar">`.

## 3. Comandos

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | Verde: 4 tareas ejecutadas, 2 en caché, 0 errores. |
| `pnpm typecheck` | Verde: 5 tareas, 0 errores. |
| `pnpm test` | Verde en todos los paquetes; API 47 archivos y 634 pruebas, web 10 archivos y 69 pruebas. |
| `node scripts/check-specs.mjs` | `OK: 8 specs válidas`. |
| `pnpm --filter @caribe/web capture:screenshots checkout` | Verde; generó las cuatro capturas de checkout y validó el cuerpo simulado. |
| Revisión puntual de checkout en Playwright | Verde en 1440x900 y 390x844; sin desbordes ni errores de consola. |
| Revisión puntual de las 13 capturas | Verde; dimensiones y muestreo de píxeles correctos. |

No se añadieron tipos `any` ni directivas `@ts-ignore` en el rango revisado.

## 4. `apps/admin`

- `git diff --name-only 3b4e1f8..HEAD -- apps/admin` devuelve salida vacía: ningún archivo de `apps/admin` fue commiteado en esta change.
- El árbol de trabajo conserva una modificación previa y no versionada de `apps/admin/next-env.d.ts` (rutas `.next/dev/types` generadas por `next dev`). No pertenece a `f1-visual-identity`, no se incluyó en ningún commit y se dejó intacta.

## 5. Cierre

Quedan fuera de esta verificación los pagos, la confirmación, mis reservas, cancelaciones y descargas posteriores, según el alcance de la propuesta. No se hizo `git push`.
