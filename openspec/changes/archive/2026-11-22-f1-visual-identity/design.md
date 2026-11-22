# Diseño: f1-visual-identity

Decisiones de implementación de la identidad visual aprobada el 2026-11-21. La fuente de verdad del comportamiento sigue siendo `openspec/specs/`; este documento fija cómo se materializa en `apps/web`.

## 1. Principio rector

**El color ordena, no decora.** La referencia al arte cinético venezolano se traduce en banda desfasada, ritmo modular y una sola secuencia de revelación. El atrevimiento se concentra en la composición del hero; el resto del sistema es discreto. Se prohíben eyebrows en mayúsculas, separadores de punto medio con función decorativa, guiones largos en titulares, flechas de relleno y titulares con una sola palabra teñida o en cursiva.

## 2. Paleta y tokens

Tailwind v4 se configura en `apps/web/src/app/globals.css` con `@theme`. No se crea un archivo de configuración de Tailwind v3.

| Rol | Token Tailwind | Claro | Dark |
| --- | --- | --- | --- |
| Base del header y texto principal | `ink` | `#0E2A3D` | `#071C29` |
| Acento principal y CTA | `amber` | `#F4A300` | `#FFB62E` |
| Secundario | `teal` | `#1FA6A0` | `#45C2BC` |
| Fondo hueso y texto sobre oscuro | `bone` | `#FBF7EF` | `#F3EEE4` |
| Error, solo relleno | `coral` | `#D64545` | `#FF8585` |
| Error sobre fondo claro | `coral-ink` | `#A82F2F` | `#FFA0A0` |
| Teal sobre fondo claro | `teal-ink` | `#126F6B` | `#7ADBD5` |

Contraste verificado: ámbar sobre azul profundo 7,2:1, hueso sobre azul profundo 14,8:1. Teal y coral no se usan como texto pequeño sobre hueso; para eso existen `teal-ink` y `coral-ink`. El botón primario usa texto `ink` sobre ámbar, nunca blanco.

Los valores dark se declaran como variables bajo `@media (prefers-color-scheme: dark)` en los tokens de tema. **No se añade selector de tema, clase `dark` ni toggle visible en F1**, según la decisión del dueño.

## 3. Tipografía y licencia

- Titulares: **Clash Display**, familia de la Indian Type Foundry distribuida por Fontshare, licencia `itf_ffl` (ITF Free Font License).
- Texto: **General Sans**, misma fuente y licencia.
- Los archivos `.woff2` se descargan de la API oficial de Fontshare y se auto-alojan en `apps/web/public/fonts/`. Se cargan con `next/font/local` desde `apps/web/src/app/[locale]/layout.tsx`, con variables CSS `--font-display` y `--font-body`.
- No se usa Inter.

### Confirmación por escrito de la licencia

La API oficial de Fontshare (`https://api.fontshare.com/v2/fonts`) devuelve `license_type: "itf_ffl"` para `Clash Display` y `General Sans`. El texto de la ITF Free Font License publicado en `https://www.fontshare.com/license` afirma literalmente:

> You may self-host the Font Software on your own servers or infrastructure for use on your own websites and applications, including through standard webfont technologies such as CSS @font-face.

y también:

> You may, but are not required to, identify or credit Indian Type Foundry or Fontshare in works created using the Font Software.

Por lo tanto **la licencia permite auto-alojar los archivos y no exige atribución visible**. Se versiona una copia del texto de la licencia en `apps/web/public/fonts/LICENSE-ITF-FFL.txt` como registro, no como atribución en interfaz. Fuentes: <https://www.fontshare.com/license>, <https://www.fontshare.com/fonts/clash-display>, <https://www.fontshare.com/fonts/general-sans> y <https://api.fontshare.com/v2/fonts>.

### Escala tipográfica

| Nivel | Tamaño | Interlineado | Tracking |
| --- | --- | --- | --- |
| Display | `clamp(3.25rem, 7vw, 5.5rem)` | 0,98 | -0,04em |
| H1 | `clamp(2.5rem, 5vw, 4rem)` | 1,02 | -0,035em |
| H2 | `clamp(2rem, 3.5vw, 3rem)` | 1,08 | -0,025em |
| H3 | `clamp(1.5rem, 2.4vw, 2rem)` | 1,15 | -0,02em |
| H4 | 1,25rem | 1,25 | -0,01em |
| Cuerpo grande | 1,125rem | 1,6 | -0,01em |
| Cuerpo | 1rem | 1,6 | 0 |
| Cuerpo pequeño | 0,875rem | 1,55 | 0 |
| Etiqueta | 0,875rem | 1,4 | 0,01em |
| Nota | 0,75rem | 1,4 | 0,02em |

Máximo 65 caracteres por línea en párrafos. Las etiquetas van en minúscula oracional.

## 4. Header

- Componente servidor `SiteHeader` con un hijo cliente mínimo que solo observa el scroll. El contenido traducido se pasa como `children` para mantenerlo en servidor.
- Estado inicial: `position: fixed`, fondo `rgba(14,42,61,0.72)`, `backdrop-filter: blur(14px)`, borde inferior de 1px `rgba(251,247,239,0.18)` y sombra `0 10px 30px -12px rgba(14,42,61,0.45)`.
- Degradación: se declara primero el fondo azul sólido y después la regla`@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` que aplica el fondo translúcido. Sin soporte queda el azul sólido.
- Al superar 24px de scroll se añade un atributo de estado que vuelve el fondo a `ink` sólido y reduce la sombra. Un listener pasivo con `requestAnimationFrame` y limpieza en `useEffect`.
- Marca: wordmark de texto "Caribe" con Clash Display y un bloque ámbar de 8px como sello. No hay imagen de logo ni placeholder.
- Móvil: wordmark y botón `Menú` con `aria-expanded`, `aria-controls` y foco visible. El menú despliega tasa, idioma y sesión.
- Foco: `outline` ámbar de 2px con `outline-offset: 2px`. La implementación evita `box-shadow` para foco.

## 5. Layout del hero y revelación del buscador

- Hero full bleed sobre fondo `ink`, `min-h-[100dvh]` en escritorio y altura automática en móvil, con banda de color a la derecha construida en CSS y SVG local sin imágenes externas.
- Columna izquierda: H1, subtítulo y CTA "Buscar viaje". Alineación izquierda.
- Columna derecha: composición de bandas ámbar, teal y hueso con desfase modular, `aria-hidden="true"`.
- Móvil: texto arriba, banda de 160px debajo y CTA debajo de la banda.
- El panel de búsqueda se extrae de `SearchFormView` a un componente compartido. En inicio aparece tras el hero y se revela con una sola secuencia: `clip-path` y `translateY` del contenedor más un stagger corto de los campos. En `/buscar` se renderiza abierto, sin animación.
- La secuencia se dispara una sola vez al entrar en viewport mediante `IntersectionObserver`, con desconexión tras la revelación. Con `prefers-reduced-motion: reduce` el panel se renderiza en estado final y no se registran transformaciones.
- Solo se animan `transform`, `opacity` y `clip-path`. No se usa GSAP ni Framer Motion.

## 6. Superficies y sombras

| Elemento | Radio | Sombra |
| --- | --- | --- |
| Geometría del hero | 0 | ninguna |
| Entradas y badges | 4px | ninguna |
| Botones | 6px | ámbar en hover |
| Tarjetas de resultado y detalle | 8px | `0 18px 40px -24px rgba(14,42,61,0.55)` |
| Panel flotante del buscador | 12px | `0 18px 40px -24px rgba(14,42,61,0.55)` |

Los estados de carga, vacío y error se implementan en las cuatro pantallas. Ningún estado usa sombra gris genérica ni el mismo radio que todo lo demás.

## 7. Pantallas y rutas

| Pantalla | Ruta | Origen | Cambio |
| --- | --- | --- | --- |
| Inicio | `/[locale]` | Existente | Hero, header, panel revelable y copy nuevo |
| Búsqueda | `/[locale]/buscar` | Existente | Mismo panel compartido, tarjetas y estados nuevos |
| Detalle | `/[locale]/hoteles/[id]` | No existe; `search-view.tsx` ya enlaza aquí | Nueva página con galería, descripción, disponibilidad y política de cancelación |
| Checkout | `/[locale]/checkout/[productId]` | No existe | Nueva página con fechas, viajeros, moneda USD o VES y acción `Reservar` |

- Detalle consume el contrato público `GET /products/:id` y `GET /products/:id/availability` descrito en `f1-hotels-e2e/design.md` §2.2. Sin tasa global muestra solo USD. Un producto no público responde con 404 y la pantalla muestra el estado de error concreto.
- Checkout consume el contrato de creación de reserva con viajeros y `Idempotency-Key` descrito en `f1-hotels-e2e/design.md` §2.3. El servidor calcula totales; la interfaz nunca envía montos ni tasas. La moneda seleccionada solo cambia la presentación y el resumen informativo.
- Como pago y confirmación están fuera de alcance en esta change, el alta correcta de la reserva muestra dentro de checkout un estado de éxito con el código de reserva y el texto "Pago en revisión". No se crea una ruta de pago ni de confirmación.
- El enlace "Reservar" de detalle lleva a checkout con `checkIn`, `checkOut` y `guests` en la query.

## 8. Copy e i18n

- Todo texto visible sale de `messages/es.json` y `messages/en.json`. Se reutilizan claves existentes cuando el significado aplica y se añaden nuevas bajo `home`, `search`, `detail`, `checkout` y `nav`.
- Voz activa y concreta: "Buscar viaje", "Buscar", "Reservar", "12 alojamientos", "No pudimos cargar los alojamientos. Intenta de nuevo.", "Pago en revisión". El badge de tasa pasa a "Tasa BCV 45,20 Bs/$ del 21 nov" sin punto medio.
- Los metadatos `metadata.title` también dejan el punto medio de decoración.
- Los textos de prueba en `apps/web/test/messages.test.ts` se actualizan con las mismas claves.

## 9. Dependencia nueva

`@playwright/test` se añade **solo** a `devDependencies` de `apps/web`. Justificación:Capturas automatizadas de escritorio y móvil para revisión de cada pantalla antes del commit; no se importa desde `src/`, no entra en el build de producción y no cambia el runtime. El script queda en `apps/web/scripts/capture-screenshots.mjs` y se invoca con `pnpm --filter @caribe/web capture:screenshots`. Tras instalar se revisa `pnpm-workspace.yaml` (`allowBuilds`) según la regla del repositorio.

## 10. Verificación

- Una captura de escritorio 1440x900 y una de móvil 390x844 por pantalla, guardadas en `docs/plans/screenshots/f1-visual-identity/`, revisadas antes de cada commit.
- Comprobación manual de foco con teclado y de `prefers-reduced-motion: reduce` en el script de capturas.
- `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde antes de cada commit de pantalla.
- Sin cambios en `apps/admin`, sin `any` nuevo y sin `@ts-ignore` sin justificar.
