# Tareas: f1-language-switcher-pill

Una tarea a la vez. Sin tocar `apps/admin`.

- [ ] T-LANG-0 Crear la change con proposal, design, tasks y el delta `web-ui` que sustituye el requisito «Selector de idioma con banderas» por la píldora `ES|ENG`.
  Prueba: `node scripts/check-specs.mjs` y `pnpm exec openspec validate --all` en verde; sin código de app modificado.
- [ ] T-LANG-1 Escribir primero el test del selector: dos etiquetas cortas, sin banderas ni combobox, activo con `aria-current` y claves i18n en es/en. Verlo fallar antes de tocar el componente.
  Prueba: escenarios «Selector de idioma en píldora» de `specs/web-ui/spec.md`; `pnpm --filter @caribe/web test` en rojo por el componente antiguo.
- [ ] T-LANG-2 Implementar la píldora, mover las etiquetas a mensajes y actualizar `verify-navigation.mjs`.
  Prueba: escenarios «Selector de idioma en píldora» y «Cambio de idioma»; `pnpm --filter @caribe/web test`, lint, typecheck, build y `verify:navigation` en verde.
