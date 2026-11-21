# Tareas: f1-visual-identity

Requiere aprobación del plan de diseño, ya recibida el 2026-11-21. Una tarea a la vez, capturas antes del commit y un commit por pantalla.

- [x] T-VIS-0 Crear la change con proposal, design, tasks y spec delta `web-ui`. La licencia Fontshare queda confirmada por escrito en `design.md` §3.
  Prueba: `node scripts/check-specs.mjs` en verde; sin código de app modificado.
- [x] T-VIS-1 Inicio: tokens Tailwind v4, fuentes locales, header glass con fallback sólido, wordmark de texto, hero asimétrico, panel de búsqueda compartido y revelación única con `prefers-reduced-motion`. Copy es y en.
  Prueba: escenarios de la spec delta `web-ui` sobre identidad, header y revelación; capturas de escritorio y móvil de inicio; lint, typecheck y tests en verde.
- [ ] T-VIS-2 Búsqueda: aplicar el panel compartido y las tarjetas de resultado con la nueva jerarquía, sombras de marca, estados de carga, vacío y error, y foco visible. Copy es y en.
  Prueba: catalog › "Búsqueda y filtros"; escenarios de la spec delta `web-ui`; capturas de escritorio y móvil de búsqueda; lint, typecheck y tests en verde.
- [ ] T-VIS-3 Detalle (`T-F1-13b`): construir `/[locale]/hoteles/[id]` con galería, descripción, disponibilidad por noche, precio USD y equivalente VES, política de cancelación y acción `Reservar`. Sin tasa global, solo USD.
  Prueba: catalog › "Detalle y disponibilidad públicos"; escenarios de la spec delta `web-ui`; capturas de escritorio y móvil de detalle; lint, typecheck y tests en verde.
- [ ] T-VIS-4 Checkout (`T-F1-13c`): construir `/[locale]/checkout/[productId]` con fechas, viajeros, selector USD o VES, resumen y alta de reserva con `Idempotency-Key`, sin enviar montos ni tasas desde el cliente. Estado de éxito dentro de la misma pantalla con el código de reserva.
  Prueba: booking › "Hay cupo en todas las noches" y "Reserva sin viajeros"; escenarios de la spec delta `web-ui`; capturas de escritorio y móvil de checkout; lint, typecheck y tests en verde.
- [ ] T-VIS-5 Verificación de la change: revisar las ocho capturas, comprobar que no hay cambios en `apps/admin`, ejecutar lint, typecheck y tests completos y documentar el resultado.
  Prueba: todos los escenarios de la spec delta `web-ui` con evidencia; `node scripts/check-specs.mjs` en verde.

## Notas

- `T-VIS-3` y `T-VIS-4` cierran las tareas `T-F1-13b` y `T-F1-13c` del plan F1 con el nuevo sistema visual. No se marcan en `f1-hotels-e2e/tasks.md` hasta la verificación de esta change.
- Quedan fuera `T-F1-13d`, `T-F1-13e`, `T-F1-14a` y `T-F1-14b`.
- Cada tarea de pantalla termina con un commit `feat(web): ...` en formato Conventional Commits.
