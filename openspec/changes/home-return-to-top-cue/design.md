# Diseño: home-return-to-top-cue

## Decisión
Reutilizar `ScrollCue` con una prop `direction` (`down` por defecto, `up` en el cierre). El
componente ya encapsula el ancla, el `IntersectionObserver` que lo retira del tabulado fuera de su
sección, la pulsación, la interpolación de 760 ms y el respeto a `prefers-reduced-motion`; duplicarlo
para un solo gesto supondría dos implementaciones divergentes.

El destino de la subida es el principio de la portada. Se identifica el hero con `id="inicio"` y se
reusa `destinationTop`, de modo que la URL termina en `#inicio` y no aparece un ancla vacía. La
misma curva y duración sirven para subir y bajar: el desplazamiento interpolado admite un delta
negativo sin cambios.

## Detalles
- `direction="up"` invierte el trazo del chevron y el balanceo en reposo, para que la dirección
  visual coincida con la acción.
- La etiqueta accesible llega desde `messages/<locale>.json` (`home.scrollToTop`); no se fija texto
  en el componente.
- El sentinel sigue dentro de la sección que contiene el gesto, así que el nuevo control hereda el
  comportamiento de visibilidad de los otros tres y no añade un quinto foco permanente.

## Riesgos
- Añadir un cuarto `ScrollCue` cambia el recuento inicial de controles con `data-visible="true"`
  antes de que responda el `IntersectionObserver`. La comprobación de navegación ya espera a que
  quede solo el de la sección activa.
- `#inicio` es un ancla nueva en la portada; no está en el inventario de rutas ni afecta al prefijo
  de idioma.
