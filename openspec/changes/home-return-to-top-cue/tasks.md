# Tareas: home-return-to-top-cue

Una tarea a la vez. Capturas de la portada en escritorio y móvil antes del commit en
`docs/plans/screenshots/home-return-to-top-cue/`.

- [x] T-TOP-0 Crear la change con proposal, design, tasks y el delta ADDED de `web-ui`.
  Prueba: `node scripts/check-specs.mjs` en verde; sin código de app modificado.
- [ ] T-TOP-1 Añadir el gesto de subida en el cierre: dirección en `ScrollCue`, ancla `inicio`,
  etiquetas es/en, inversión del chevron y del balanceo, y ausencia de texto fijo.
  Prueba: escenarios «Retorno al inicio desde el cierre» de `specs/web-ui/spec.md`; tests de
  `scroll-cue` y `featured-stays`; `verify:navigation` y capturas claras/oscuras en escritorio y
  móvil; lint, typecheck y tests en verde.
