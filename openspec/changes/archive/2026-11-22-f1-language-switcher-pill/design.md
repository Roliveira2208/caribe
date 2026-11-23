# Diseño: f1-language-switcher-pill

## Cambio de comportamiento

La presentación se extrae a `apps/web/src/components/language-pill.tsx`, sin hooks ni imports de
next-intl, para poder renderizarla en el test con `renderToStaticMarkup`. Muestra una píldora
(`rounded-full`) con dos botones, `ES` y `ENG`, dentro de un grupo con `aria-label` pasado por props.
El botón del idioma activo lleva `aria-current="true"` y estilo resaltado; el otro queda con el estilo
base. No hay `<img>`, `role="combobox"`, `role="listbox"` ni gestión de apertura.

`apps/web/src/components/language-switcher.tsx` conserva los hooks de next-intl y el router, pasa las
etiquetas y llama a `choose(locale)`: si el idioma cambia, usa el mismo
`router.replace(languageSwitchHref(...))` de antes.

## Accesibilidad

Los botones conservan el orden de tabulado natural y el foco visible ámbar que ya usaba el desplegable.
`aria-current` anuncia el activo sin depender del color. No se introducen atajos de teclado nuevos:
Tab/Enter/Espacio son suficientes para dos opciones.

## Textos

`nav.shortEs = "ES"` y `nav.shortEn = "ENG"` en `messages/es.json` y `messages/en.json`. Se retiran
`nav.spanish` y `nav.english` porque dejan de tener usos en `src`. `messages.test.ts` garantiza la
paridad de claves y que toda clave usada existe en ambos idiomas.

## Pruebas

- `apps/web/test/language-switcher.test.ts` importa `LanguagePill` y la renderiza con
  `renderToStaticMarkup` (sin hooks de next-intl) para comprobar los dos textos, la ausencia de
  banderas, el `aria-current` del activo y el contorno de foco.
- `apps/web/scripts/verify-navigation.mjs` sustituye la comprobación del desplegable por la de la
  píldora: dos botones `ES`/`ENG`, sin banderas ni `select`, activo con `aria-current`, y navegación
  al otro prefijo conservando `/search`.

Sin dependencias nuevas. La verificación en navegador se ejecuta con `CARIBE_WEB_URL` apuntando a
`http://localhost:3100` porque los puertos 3000/3002 están ocupados por otro proyecto.
