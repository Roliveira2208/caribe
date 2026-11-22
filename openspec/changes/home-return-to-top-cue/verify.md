# Verificación: home-return-to-top-cue

- **Fecha:** 2026-11-22.
- **Alcance:** portada de `apps/web` (`/`), gesto de desplazamiento del cierre; sin cambios en la API, `apps/admin` ni el servidor.
- **Rango revisado:** `2d93c72..HEAD`. Commits: `7e704ec` (spec), `90fed22` (gesto de subida) y `f123c24` (corrección de solape).
- **Entorno:** web en `:3000` con `pnpm --filter @caribe/web dev`; verificación con Playwright incluido como `devDependency`, sin importarlo desde `src/`.

## 1. Capturas

Directorio: `docs/plans/screenshots/home-return-to-top-cue/`.

| Archivo | Estado documentado |
| --- | --- |
| `home-closing-desktop.png` | Cierre de la portada en claro, 1440x900: flecha de subida, sin solape con la bajada de destacados. |
| `home-closing-mobile.png` | Cierre en claro, 390x844: una sola gesto en el tabulado. |
| `home-closing-dark-desktop.png` | Cierre en modo oscuro, 1440x900: contorno y flecha legibles. |
| `home-closing-dark-mobile.png` | Cierre en modo oscuro, 390x844. |

Las cuatro se generaron con `pnpm --filter @caribe/web capture:screenshots` tras el fix de solape; `verify:navigation` comprueba el `data-scroll-cue` del cierre y la ausencia de un segundo gesto en el tabulado al llegar al final de la página.

## 2. Matriz de escenarios

| Escenario de `specs/web-ui/spec.md` | Evidencia |
| --- | --- |
| Flecha de subida al final del recorrido | `test/scroll-cue.test.ts` › dirección `up`, ancla `#inicio` y duración de 760 ms; `featured-stays.test.ts` › gesto del cierre apuntando al inicio; `verify:navigation` › «solo la flecha de subida, sin solape». |
| Etiqueta y foco del gesto | `messages/{es,en}.json` › `home.scrollToTop`, sin cadena fija; `ScrollCue` con `aria-label` y `:focus-visible` ámbar de `globals.css`; comprobación por teclado en `verify:navigation`. |
| Un gesto por sección | `test/featured-stays.test.ts` › heroic, búsqueda y destacados con dirección `down`, cierre con `up` y `id="inicio"`; `verify:navigation` al final de la página en es/en; el `cue-nudge-up` se anula con `prefers-reduced-motion`. |

## 3. Comandos

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @caribe/web lint` | Verde. |
| `pnpm --filter @caribe/web typecheck` | Verde. |
| `pnpm --filter @caribe/web test` | Verde: 115 pruebas. |
| `pnpm --filter @caribe/web verify:contrast` | Verde en el segundo intento; el primero agotó el timeout de lanzamiento de Playwright (180 s) sin fallo de la app. |
| `pnpm --filter @caribe/web verify:navigation` | Verde: 16 rutas en es/en, incluidas las comprobaciones nuevas del cierre. |
| `pnpm --filter @caribe/web capture:screenshots` | Verde: cuatro capturas del cierre en claro/oscuro y escritorio/móvil. |
| `pnpm exec openspec validate --all` | Verde: 12 specs/change válidas. |

No se añadieron tipos `any` ni directivas `@ts-ignore`.

## 4. Cierre

El destino es el inicio de la portada, no `/search`; el cierre conserva su CTA al buscador. El solape detectado durante la verificación se corrigió sin cambiar la spec: el delta ya exigía «solo el gesto de la sección visible está en el tabulado». No se hizo `git push`.
