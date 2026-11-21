# Web UI Specification (delta)

## Purpose

Define la identidad visual y las garantías de interacción de las pantallas públicas de F1: inicio, búsqueda, detalle y checkout. Evita que el resultado dependa de decisiones improvisadas de Estilo, movimiento o copia.

## ADDED Requirements

### Requirement: Identidad visual Caribe

La web pública SHALL aplicar los tokens de la paleta Caribe, la escala tipográfica aprobada y la jerarquía de radios y sombras definida en `design.md` en las cuatro pantallas de F1.

#### Scenario: Token de marca en pantalla pública
- GIVEN una pantalla pública de F1
- WHEN se renderiza
- THEN el header usa el token `ink`, el acento principal usa `amber`, el fondo claro usa `bone` y el error usa `coral` o `coral-ink` según el soporte
- THEN las tarjetas usan sombra teñida de azul y no una sombra gris genérica

#### Scenario: Tipografías auto-alojadas
- GIVEN un navegador que carga inicio
- WHEN se aplica el estilo
- THEN los titulares usan Clash Display y el texto usa General Sans desde archivos locales
- THEN no se solicitan fuentes a un servicio externo

#### Scenario: Modo oscuro sin control visible
- GIVEN el sistema operativo solicita tema oscuro
- WHEN se renderiza una pantalla de F1
- THEN se aplican los tokens dark definidos
- THEN no aparece ningún selector ni interruptor de tema en la interfaz

### Requirement: Cabecera flotante con degradación

La cabecera SHALL mostrarse como cristal sobre el hero, volverse sólida al desplazarse y degradar a fondo azul sólido cuando el navegador no soporta `backdrop-filter`.

#### Scenario: Header sobre el hero
- GIVEN la página de inicio en la parte superior
- WHEN se renderiza la cabecera
- THEN el fondo es azul translúcido con desenfoque y borde de 1px cuando `backdrop-filter` está disponible
- THEN el fondo es azul sólido cuando no está disponible

#### Scenario: Header tras el desplazamiento
- GIVEN la cabecera en estado flotante
- WHEN el usuario desplaza la página más de 24px
- THEN la cabecera pasa a fondo azul sólido sin cambiar su contenido

#### Scenario: Wordmark sin logo ficticio
- GIVEN el espacio de marca de la cabecera
- WHEN se renderiza
- THEN se muestra el texto "Caribe" con Clash Display y un sello ámbar
- THEN no se muestra una imagen de logo ni un placeholder

### Requirement: Revelación única del buscador

El buscador de inicio SHALL revelarse con una sola secuencia orquestada y SHALL mostrarse en estado final cuando el usuario solicita movimiento reducido.

#### Scenario: Revelación al entrar en viewport
- GIVEN el panel del buscador fuera del viewport inicial
- WHEN entra en viewport por primera vez
- THEN una sola secuencia combina `clip-path` y `translateY` con un stagger breve de campos
- THEN no se repite una animación de entrada en cada sección posterior

#### Scenario: Movimiento reducido
- GIVEN un usuario con `prefers-reduced-motion: reduce`
- WHEN carga inicio
- THEN el panel se muestra abierto desde el primer fotograma
- THEN no se ejecuta ninguna transformación de revelación

#### Scenario: Animaciones permitidas
- GIVEN cualquier animación de interfaz en F1
- WHEN se inspeccionan las propiedades animadas
- THEN solo se animan `transform`, `opacity` y `clip-path`

### Requirement: Accesibilidad de teclado y foco

Las cuatro pantallas SHALL mantener foco visible, etiquetas asociadas y mensajes de error accesibles.

#### Scenario: Navegación por teclado
- GIVEN un usuario que navega con teclado
- WHEN tabula por el header, el buscador, el detalle o el checkout
- THEN cada control enfocable muestra un contorno ámbar de 2px con separación
- THEN el orden de foco sigue el orden visual

#### Scenario: Error de formulario
- GIVEN un campo inválido en búsqueda o checkout
- WHEN se envía el formulario
- THEN el mensaje de error está asociado al campo y es anunciado
- THEN el color no es el único indicador del error

### Requirement: Copy de interfaz

Los textos visibles SHALL salir de los archivos de internacionalización y SHALL usar voz activa y vocabulario coherente en español e inglés.

#### Scenario: Sin cadenas fijas
- GIVEN cualquiera de las cuatro pantallas
- WHEN se inspecciona el código
- THEN no hay texto visible escrito directamente en componentes

#### Scenario: Vocabulario de acción
- GIVEN el botón principal de checkout y un pago en revisión
- WHEN se muestran sus etiquetas
- THEN la acción dice "Reservar" y el estado dice "Pago en revisión"
- THEN no se usan "Continuar" ni "Procesando" como relleno

#### Scenario: Sin decoradores tipográficos
- GIVEN cualquier texto visible nuevo
- WHEN se lee
- THEN no usa mayúsculas para eyebrows, punto medio decorativo, guion largo en titulares ni flecha de relleno

### Requirement: Pantallas de detalle y checkout

El detalle SHALL mostrar la información pública del producto y el checkout SHALL crear la reserva sin recibir montos ni tasas del cliente.

#### Scenario: Detalle de producto público
- GIVEN un producto publicado
- WHEN se abre su detalle
- THEN se muestran título, descripción, galería, precio en USD y equivalente VES cuando hay tasa
- THEN se muestran disponibilidad por noche y política de cancelación

#### Scenario: Detalle sin tasa
- GIVEN un producto publicado sin tasa global disponible
- WHEN se abre su detalle
- THEN se muestra el precio en USD
- THEN no se muestra un equivalente VES inventado

#### Scenario: Checkout con moneda elegida
- GIVEN un producto con fechas y personas válidas
- WHEN el usuario elige USD o VES y envía sus datos de viajero
- THEN la petición contiene solo datos del viajero, fechas, persona y moneda elegida
- THEN el total y la tasa los calcula el servidor

#### Scenario: Checkout sin viajeros
- GIVEN el formulario de checkout sin viajeros
- WHEN el usuario intenta reservar
- THEN no se crea la reserva
- THEN se muestra el error asociado al bloque de viajeros

#### Scenario: Reserva creada
- GIVEN datos válidos y cupo en todas las noches
- WHEN se crea la reserva
- THEN checkout muestra el código de reserva y el estado "Pago pendiente"
- THEN no se navega a una ruta de pago o confirmación inexistente

## Casos límite

- Sin tasa global: se oculta el VES; nunca se calcula en el cliente.
- Producto no público o eliminado: detalle muestra error concreto y no expone atributos internos.
- Sin `backdrop-filter`: header azul sólido.
- Movimiento reducido: revelación instantánea sin transformación.
- Sin JavaScript: el formulario de búsqueda conserva su envío GET.
- Fallo de la API en detalle o checkout: estado de error con acción comprensible, sin dejar el formulario en un estado engañoso.

## Acceptance

- Las cuatro pantallas tienen captura de escritorio 1440x900 y móvil 390x844 revisadas antes del commit.
- Cada escenario de esta spec tiene evidencia en tests, capturas o ambos.
- Foco visible, etiquetas y errores verificados en las cuatro pantallas.
- Sin cambios en `apps/admin`.
- Lint, typecheck y tests del monorepo en verde.

## Out of scope

- Pago, confirmación, mis reservas, cancelación y descarga de documentos.
- Panel administrativo y sus ajustes.
- Selector de tema oscuro o persistencia de preferencia.
- Logotipo de marca distinto del wordmark de texto.
