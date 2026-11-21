# Delta: web-ui — f1-navigation-refresh

## ADDED Requirements

### Requirement: Rutas públicas fijas

La web pública SHALL usar rutas internas en inglés e independientes del idioma mostrado. El
prefijo de next-intl SHALL ser `es` o `en`; el nombre de la ruta SHALL ser idéntico en ambos.
Ninguna pantalla pública SHALL responder 404 por usar el nombre en español de una ruta.

#### Scenario: Búsqueda en ambos idiomas
- GIVEN un usuario que abre `/es/search` y `/en/search`
- WHEN se resuelve cada petición
- THEN ambas devuelven 200 con el buscador y el `<html lang>` correspondiente
- THEN ninguna muestra «Página no encontrada» ni «Page not found»

#### Scenario: Detalle, checkout y cuenta en ambos idiomas
- GIVEN las rutas `/hotels/:id`, `/checkout/:productId` y `/account/trips`
- WHEN se visitan con prefijo `es` y con prefijo `en`
- THEN cada una devuelve 200 y conserva el mismo nombre de ruta en los dos idiomas

#### Scenario: Cambio de idioma sin renombrar la ruta
- GIVEN un usuario en `/es/search`
- WHEN selecciona ENG
- WHEN se navega a `/en/search`
- THEN solo cambian el prefijo y los textos, nunca el segmento `search`

#### Scenario: Formulario GET localizado
- GIVEN el formulario del buscador en cualquiera de los dos idiomas
- WHEN se envía sin JavaScript
- THEN la petición GET llega a `/<locale>/search` y conserva los parámetros de búsqueda

### Requirement: Navegación pública separada del panel

La cabecera pública SHALL mostrar solo acciones del cliente. La configuración 2FA SHALL vivir
en el área de cuenta y SHALL NOT aparecer como acción de la cabecera pública.

#### Scenario: Cabecera sin Seguridad
- GIVEN un cliente con sesión iniciada
- WHEN se renderiza la cabecera de la web pública
- THEN aparecen acceso a «Mis viajes» y cierre de sesión
- THEN no aparece el enlace «Seguridad»

#### Scenario: Seguridad dentro de la cuenta
- GIVEN un cliente con sesión iniciada
- WHEN abre el área de cuenta
- THEN encuentra el enlace a la configuración de dos pasos

### Requirement: Recorrido guiado de la portada

La portada SHALL ofrecer un gesto de bajada al buscador y otro a los hoteles destacados. Ambos
SHALL funcionar con teclado y SHALL respetar `prefers-reduced-motion`.

#### Scenario: Flecha al buscador
- GIVEN la portada en la parte superior
- WHEN el usuario activa la flecha de bajada
- THEN la página hace scroll suave hasta la sección de búsqueda
- THEN con movimiento reducido el salto es inmediato

#### Scenario: Flecha a destacados
- GIVEN la sección de búsqueda a 100vh
- WHEN el usuario activa la flecha de bajada
- THEN la página llega a la sección de hoteles destacados

#### Scenario: Foco del gesto
- GIVEN un usuario que tabula por la portada
- WHEN alcanza cada flecha
- THEN ve el contorno ámbar de foco y puede activarla con Enter

#### Scenario: Gesto siempre a la vista
- GIVEN la portada en un viewport bajo, por ejemplo 1280x600
- WHEN se carga y después se desplaza hasta el buscador
- THEN la flecha permanece dentro del viewport mientras el hero ocupa la parte alta
- THEN se oculta y sale del tabulado al salir del hero

### Requirement: Sección de búsqueda a pantalla completa

La sección de búsqueda de la portada SHALL ocupar al menos el alto del viewport, SHALL usar una
imagen de fondo local de estilo giro y SHALL colocar encima el mismo componente de formulario
que `/search`.

#### Scenario: Buscador sobre fondo propio
- GIVEN la sección de búsqueda de la portada
- WHEN se renderiza
- THEN mide al menos 100vh y usa `kinetic-giro.svg` servido desde la propia web
- THEN todos los campos del buscador quedan encima del fondo con superficie glass

#### Scenario: Un solo buscador
- GIVEN la portada y `/search`
- WHEN se comparan sus formularios
- THEN ambos usan el mismo componente, radios y tipografía
- THEN no existen dos implementaciones divergentes del formulario

### Requirement: Destacados con datos reales

La sección de hoteles destacados SHALL mostrar productos publicados obtenidos de la API y SHALL
marcar Tours, Paquetes y Vuelos como próximamente sin datos de ejemplo.

#### Scenario: Destacados reales
- GIVEN la API devuelve productos publicados
- WHEN se renderiza la sección de destacados
- THEN se muestran títulos y precios procedentes de esa respuesta
- THEN no se inventan productos ni precios

#### Scenario: Sin destacados
- GIVEN la API no devuelve productos publicados
- WHEN se renderiza la sección de destacados
- THEN se muestra un estado vacío traducido y no una tarjeta falsa

#### Scenario: Productos no disponibles aún
- GIVEN las categorías Tour, Paquete y Vuelo
- WHEN se muestran en la portada
- THEN cada una dice «Próximamente» y no muestra datos de ejemplo

### Requirement: Badge de tasa compacto

El badge de la cabecera SHALL mostrar únicamente `BCV` y el monto. La fecha valor SHALL seguir
apareciendo en checkout y en el panel de pagos.

#### Scenario: Badge sin fecha
- GIVEN una tasa disponible
- WHEN se renderiza la cabecera
- THEN el badge dice `BCV 45,20` en español y el equivalente formateado en inglés
- THEN no incluye unidad, prefijo de fecha ni fecha valor

#### Scenario: Detalle completo intacto
- GIVEN el checkout o el panel de pagos
- WHEN se muestra el equivalente VES
- THEN sigue apareciendo la fecha valor de la tasa

### Requirement: Selector de idioma como píldora

El selector SHALL presentarse como una píldora redondeada con `ES` y `ENG` como único texto, sin
banderas, con el idioma activo resaltado y accesible.

#### Scenario: Píldora sin banderas
- GIVEN la cabecera en cualquier idioma
- WHEN se renderiza el selector
- THEN se ven `ES` y `ENG` como texto y ninguna imagen de bandera
- THEN el activo está resaltado y anunciado con `aria-current`

#### Scenario: Cambio de idioma
- GIVEN un usuario en `/es/search`
- WHEN activa `ENG`
- THEN navega a `/en/search` y la píldora resalta `ENG`

### Requirement: Contraste AA verificable

Todos los textos visibles de la web pública SHALL cumplir WCAG AA en tema claro y oscuro usando
los tokens aprobados. La verificación SHALL ejecutarse en CI.

#### Scenario: Texto normal
- GIVEN cualquier texto visible de menos de 24px
- WHEN se calcula el contraste con su fondo efectivo
- THEN el ratio es al menos 4.5:1 en claro y en oscuro

#### Scenario: Texto grande
- GIVEN cualquier texto visible de al menos 24px o 18,66px en negrita
- WHEN se calcula el contraste con su fondo efectivo
- THEN el ratio es al menos 3:1 en claro y en oscuro

#### Scenario: CI
- GIVEN un pull request que toca `apps/web`
- WHEN corre el workflow de CI
- THEN ejecuta la verificación de contraste junto a lint, typecheck y tests

### Requirement: Acceso del cliente a sus viajes

«Iniciar sesión» SHALL llevar a una pantalla de acceso real. Tras iniciar sesión, el cliente
SHALL poder abrir `/account/trips` y ver sus reservas con estado usando el endpoint existente
de reservas. La pantalla SHALL NOT mostrar enlaces de documentos inventados.

#### Scenario: Acceso real
- GIVEN un visitante sin sesión
- WHEN activa «Iniciar sesión»
- THEN llega a `/<locale>/login` con un formulario funcional

#### Scenario: Mis viajes con reservas
- GIVEN un cliente con sesión y reservas propias
- WHEN abre `/account/trips`
- THEN ve código, estado traducido, fecha de caducidad y total USD de cada reserva
- THEN los datos vienen de `GET /api/v1/bookings`

#### Scenario: Mis viajes vacío o con error
- GIVEN un cliente sin reservas o una respuesta fallida de la API
- WHEN abre `/account/trips`
- THEN ve un estado vacío o de error traducido y accesible
- THEN no ve tarjetas ni enlaces falsos

#### Scenario: Documentos sin datos
- GIVEN una reserva listada
- WHEN se muestra su bloque
- THEN se indica que los documentos se publican al confirmar el pago
- THEN no se muestra ningún enlace de descarga sin identificador real
