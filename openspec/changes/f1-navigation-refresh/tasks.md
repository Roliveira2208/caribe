# Tareas: f1-navigation-refresh

Una tarea a la vez. Capturas de escritorio y móvil antes de cada commit en
`docs/plans/screenshots/f1-navigation-refresh/`. `apps/admin` queda fuera del alcance.

- [ ] T-NAV-0 Crear la change con proposal, design, tasks y spec delta `web-ui`, incorporando las decisiones confirmadas sobre prefijo de idioma, «Seguridad» y documentos.
  Prueba: `node scripts/check-specs.mjs` en verde; sin código de app modificado.
- [ ] T-NAV-1 Reproducir y corregir el 404 de rutas: directorios en inglés, `pathnames` en `defineRouting`, enlaces y formularios por `getPathname`, y test de navegación que visita cada ruta en ambos idiomas.
  Prueba: escenarios «Rutas públicas fijas» de `specs/web-ui/spec.md`; `pnpm --filter @caribe/web verify:navigation`; lint, typecheck y tests en verde.
- [ ] T-NAV-2 Separar la navegación pública del panel: crear el área de cuenta y mover el enlace 2FA «Seguridad» desde la cabecera pública a esa área. No tocar `apps/admin`.
  Prueba: escenarios «Navegación pública separada del panel» de `specs/web-ui/spec.md`; capturas de cuenta y cabecera en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-3 Añadir la flecha de bajada del hero con scroll suave, foco visible y respeto a `prefers-reduced-motion`.
  Prueba: escenarios «Recorrido guiado de la portada» de `specs/web-ui/spec.md`; capturas de inicio en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-4 Convertir la sección de búsqueda en pantalla completa con fondo `kinetic-giro.svg`, superficie glass y el formulario compartido encima.
  Prueba: escenarios «Sección de búsqueda a pantalla completa» de `specs/web-ui/spec.md`; capturas de inicio y buscador revelado en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-5 Añadir la segunda flecha y la sección de hoteles destacados con datos reales de la API, estado vacío y etiquetas «Próximamente» sin datos de ejemplo. No modificar tarjetas de hotel existentes.
  Prueba: escenarios «Destacados con datos reales» de `specs/web-ui/spec.md`; capturas de destacados en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-6 Simplificar el badge de la cabecera a `BCV` y monto; retirar claves i18n sin uso manteniendo paridad es/en y conservar la fecha valor en checkout y pagos.
  Prueba: escenarios «Badge de tasa compacto» de `specs/web-ui/spec.md`; capturas de cabecera en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-7 Rediseñar el selector de idioma como píldora `ES | ENG`, sin banderas, con activo resaltado y `aria-current`.
  Prueba: escenarios «Selector de idioma como píldora» de `specs/web-ui/spec.md`; capturas de cabecera en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-8 Corregir el contraste de los pares gris sobre blanco con tokens aprobados, añadir `verify:contrast` con Playwright y crear el workflow de CI que lo ejecute.
  Prueba: escenarios «Contraste AA verificable» de `specs/web-ui/spec.md`; capturas claras y oscuras en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-9 Hacer real «Iniciar sesión» y construir `/account/trips` con reservas de `GET /api/v1/bookings`, estados accesibles y nota honesta sobre documentos.
  Prueba: escenarios «Acceso del cliente a sus viajes» de `specs/web-ui/spec.md`; capturas de login y Mis viajes en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-10 Unificar el buscador de `/search` con el del hero mediante el componente compartido, conservando las tarjetas de resultados.
  Prueba: escenario «Un solo buscador» de `specs/web-ui/spec.md`; capturas de búsqueda en escritorio y móvil; lint, typecheck y tests en verde.
- [ ] T-NAV-11 Verificación final de la change: revisar capturas, ejecutar los verificadores de navegación y contraste, lint, typecheck y tests completos, y documentar la evidencia en `verify.md`.
  Prueba: todos los escenarios de `specs/web-ui/spec.md` con evidencia; `node scripts/check-specs.mjs` en verde.

## Notas

- El commit de la T-NAV-0 es `docs(spec): ...`; el resto usa `feat(web): ...` o `fix(web): ...` según corresponda.
- Las capturas se generan con `@playwright/test` como `devDependency`, sin importarlo desde `src/`.
- Se prohiben texto fijo en componentes, `any` nuevo y `@ts-ignore` sin justificar.
