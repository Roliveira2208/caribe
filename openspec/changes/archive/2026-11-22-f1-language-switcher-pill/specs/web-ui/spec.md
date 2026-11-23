# Delta: web-ui — f1-language-switcher-pill

## REMOVED Requirements

### Requirement: Selector de idioma con banderas
Reason: El dueño sustituye el desplegable con banderas VE/US por una píldora `ES|ENG` sin banderas.

## ADDED Requirements

### Requirement: Selector de idioma en píldora

El selector SHALL presentarse como una píldora con dos botones visibles, `ES` y `ENG`, sin banderas y
sin control nativo `<select>`. El idioma activo SHALL estar resaltado y anunciado con `aria-current`;
ambos botones SHALL ser alcanzables con teclado y mostrar contorno de foco visible. El selector SHALL
conservar la ruta y sus parámetros al cambiar de idioma.

#### Scenario: Píldora sin banderas
- GIVEN la cabecera en cualquier idioma
- WHEN se renderiza el selector
- THEN se ven exactamente dos botones con los textos «ES» y «ENG»
- THEN no aparece ninguna imagen de bandera ni un `<select>` nativo
- THEN el botón del idioma activo está resaltado y anunciado con `aria-current`

#### Scenario: Cambio de idioma
- GIVEN un usuario en `/es/search`
- WHEN activa «ENG»
- THEN navega a `/en/search`, el prefijo cambia y el segmento `search` no
- THEN «ENG» queda resaltado y anunciado como activo

#### Scenario: Teclado
- GIVEN un usuario que tabula por la cabecera
- WHEN alcanza cada botón del selector
- THEN ve el contorno de foco ámbar y puede activarlo con Enter o Espacio
