# Delta: web-ui — home-return-to-top-cue

## ADDED Requirements

### Requirement: Retorno al inicio desde el cierre
La portada SHALL ofrecer un gesto de subida en la sección de cierre que devuelva al inicio de la
página. El gesto SHALL apuntar hacia arriba, SHALL estar etiquetado en el idioma activo y SHALL
funcionar con teclado y con `prefers-reduced-motion`. SHALL usar la misma interpolación de desplazamiento
que las flechas de bajada cuando el movimiento está permitido, y SHALL saltar de inmediato cuando no
lo esté. SHALL aparecer solo mientras el cierre ocupe la zona alta del viewport, sin añadir un
segundo gesto a ninguna otra sección.

#### Scenario: Flecha de subida al final del recorrido
- GIVEN el usuario en la sección de cierre de la portada
- WHEN activa la flecha de subida
- THEN la página vuelve al inicio con la interpolación de 760 ms y la URL conserva el ancla del inicio
- THEN con movimiento reducido el salto es inmediato

#### Scenario: Etiqueta y foco del gesto de subida
- GIVEN un usuario que tabula por la portada
- WHEN alcanza la flecha del cierre
- THEN ve el contorno ámbar de foco, la etiqueta anunciada indica volver al inicio en el idioma activo y puede activarla con Enter

#### Scenario: Un gesto por sección
- GIVEN la portada completa
- WHEN se cuentan los gestos de desplazamiento
- THEN hero, búsqueda y destacados tienen una flecha de bajada y el cierre una de subida
- THEN solo el gesto de la sección visible está en el tabulado
