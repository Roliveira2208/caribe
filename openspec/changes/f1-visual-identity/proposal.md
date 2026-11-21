# Propuesta: f1-visual-identity

## Problema

La web pública de F1 funciona con el estilo provisional del shell: tokens cian genéricos, cabecera fija blanca, tarjetas idénticas y copy de "próximamente". No transmite la identidad acordada para Caribe y todavía no existen las pantallas de detalle ni de checkout que el plan F1 prevé en `T-F1-13b` y `T-F1-13c`.

## Objetivo

Aplicar una identidad visual propia a las cuatro pantallas públicas del primer recorrido (inicio, búsqueda, detalle y checkout), inspirada en el arte cinético venezolano sin caer en el cliché turquesa-palmera-script, y completar detalle y checkout con ese mismo sistema. El panel administrativo queda fuera de alcance salvo lo ya construido en F1.

## Cambio propuesto

- Sustituir los tokens de Tailwind v4 de la web por la paleta Caribe y definir la variante dark solo como tokens, sin selector ni interruptor visible en F1.
- Auto-alojar Clash Display y General Sans con `next/font/local`, junto con sus licencias.
- Rediseñar el header como capa de cristal sobre el hero, con degradación a azul sólido cuando no hay `backdrop-filter`, y wordmark de texto con Clash Display.
- Construir el hero asimétrico y un único gesto orquestado de revelación del buscador, respetando `prefers-reduced-motion`.
- Rediseñar búsqueda y resultados, construir detalle de hotel y construir checkout con viajero y moneda, reutilizando el mismo sistema de tarjetas, sombras y foco.
- Escribir el copy en español neutro venezolano dentro de `messages/es.json` y `messages/en.json`, sin cadenas fijas en componentes.
- Añadir Playwright únicamente como dependencia de desarrollo y un script de capturas fuera del build de producción.

## Por qué es una change

Cambia contratos observables de interfaz (estados del header, revelación del buscador, foco, copia y rutas nuevas), añade dos pantallas y una dependencia de desarrollo. Requiere spec delta y verificación por escenario antes de darlo por terminado.

## Preguntas resueltas por el dueño

1. Tipografías: Clash Display para titulares y General Sans para texto.
2. Detalle y checkout: se construyen en su orden normal dentro del plan F1; no se omiten.
3. Playwright: solo `devDependency`, en un script de capturas.
4. OpenSpec: la change se crea antes del código.
5. Dark mode: solo tokens definidos, sin selector ni toggle en F1.

## Fuera de alcance

- `apps/admin` y cualquier cambio en revisión de pagos o ajustes de agencia.
- Pago, confirmación, mis reservas, cancelación y descarga de documentos (`T-F1-13d`, `T-F1-13e`, `T-F1-14a`, `T-F1-14b`).
- Selector o persistencia de tema oscuro.
- Logotipo raster o vectorial: el sello es texto con Clash Display.
