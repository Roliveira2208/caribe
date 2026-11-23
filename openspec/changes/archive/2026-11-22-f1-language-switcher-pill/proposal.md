# Propuesta: f1-language-switcher-pill

## Por qué

El dueño pidió el selector de idioma como una píldora `ES|ENG` sin banderas. La implementación actual
es un desplegable con banderas VE/US y etiquetas largas («Español»/«English»), y la spec vigente
(`web-ui`, «Selector de idioma con banderas») exige exactamente eso. El código contradice la petición
actual del dueño, así que hay que cambiar primero la spec y después el componente.

## Qué se propone

1. Modificar el requisito `web-ui` del selector: píldora segmentada con dos botones visibles `ES` y
   `ENG`, sin imágenes de banderas y sin combobox/listbox.
2. Conservar el comportamiento de navegación: `languageSwitchHref` cambia solo el prefijo y mantiene
   parámetros; el idioma activo se resalta y se anuncia con `aria-current`.
3. Mantener la accesibilidad de teclado: los dos botones son alcanzables con Tab y activables con
   Enter/Espacio, con contorno de foco ámbar.
4. Añadir las etiquetas cortas a `messages/es.json` y `messages/en.json`, retirar las claves largas
   que dejan de usarse y actualizar `verify-navigation.mjs` para verificar la píldora en ambos idiomas.

## Decisiones tomadas con el dueño

- `ES` y `ENG` son etiquetas cortas idénticas en ambos idiomas; se guardan en los dos JSON de mensajes
  para no dejar cadenas fijas en el componente.
- Se conserva `localePrefix: "always"`: cambiar de idioma no renombra la ruta.
- No se añade dependencia: dos botones con `aria-current` bastan para dos idiomas.

## Fuera de alcance

- Rutas, badge de tasa, «Mis viajes» y el resto de la cabecera.
- Selector de tema, más idiomas y `apps/admin`.
- Cambiar las decisiones D1–D15 del SDD.
