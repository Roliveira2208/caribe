# Change: home-return-to-top-cue

## Por qué
Al llegar al final de la portada no existe un gesto para volver al inicio: el último ancla baja al
cierre y ahí se acaba el recorrido. El usuario debe recurrir a la barra del navegador o al CTA del
cierre, que solo vuelve al buscador. Cerrar el recorrido con un gesto de subida hace la portada
cilíclica y coherente con las tres bajadas que ya existen.

## Qué cambia
La sección de cierre pasa a tener una flecha que apunta hacia arriba y devuelve al inicio de la
página, con la misma animación de desplazamiento y las mismas garantías de accesibilidad que las
flechas de bajada. El gesto vive en el cierre y solo se anuncia cuando esa sección está en pantalla.

## Impacto en specs
Delta ADDED de `web-ui`: requirement «Retorno al inicio desde el cierre».

## Preguntas abiertas
Ninguna. El destino es el inicio de la portada, no el buscador (el cierre ya tiene un CTA al
buscador).

## Fuera de alcance
Cambiar las tres flechas de bajada, el CTA del cierre, la cabecera, las animaciones de entrada y
cualquier otra ruta distinta de la portada.
