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

#### Scenario: Animación de entrada y al desplazarse
- GIVEN la portada con movimiento permitido
- WHEN se carga y después se desplaza hacia los destacados
- THEN el texto del hero entra con una transición escalonada y las secciones y tarjetas se revelan al entrar en pantalla
- THEN con movimiento reducido, sin JavaScript o sin soporte de animaciones todo el contenido queda visible

#### Scenario: Secciones a pantalla completa
- GIVEN la portada
- WHEN se mide cada sección
- THEN hero, búsqueda, destacados y cierre miden al menos el alto del viewport
- THEN hero baja a búsqueda, búsqueda a destacados y destacados a cierre con una flecha
- THEN el cierre es el destino final y ofrece un CTA hacia el buscador

#### Scenario: Transiciones suaves
- GIVEN la portada con movimiento permitido
- WHEN se desplaza entre secciones y cambia el estado de la cabecera
- THEN las transiciones de entrada, revelación y fondo son graduales y continuas
- THEN con movimiento reducido todo el contenido queda visible y sin animación

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

### Requirement: Selector de idioma con banderas

El selector SHALL presentarse como un desplegable con banderas de Venezuela y Estados Unidos, las
etiquetas «Español» y «English», y el idioma activo resaltado y anunciado con `aria-current`.

#### Scenario: Desplegable con banderas
- GIVEN la cabecera en cualquier idioma
- WHEN se renderiza el selector
- THEN se ve una bandera VE junto a «Español» y una bandera US junto a «English»
- THEN el activo está resaltado y anunciado con `aria-current`
- THEN no queda un control nativo `<select>` sin banderas

#### Scenario: Cambio de idioma
- GIVEN un usuario en `/es/search`
- WHEN activa «English»
- THEN navega a `/en/search` y la bandera US queda resaltada

### Requirement: Cabecera flotante

La cabecera pública SHALL ser una barra centrada que no ocupe todo el ancho, separada del borde
superior, con fondo semitransparente y desenfoque. SHALL mostrar el logo a la izquierda, enlaces a
productos, acceso a sesión, selector de idioma y badge BCV.

#### Scenario: Barra flotante
- GIVEN la portada en escritorio
- WHEN se renderiza la cabecera
- THEN la barra está centrada, más estrecha que el viewport y separada del borde superior
- THEN el fondo es semitransparente con desenfoque y el logo queda a la izquierda

#### Scenario: Enlaces de productos
- GIVEN la cabecera pública
- WHEN se revisan los enlaces de productos
- THEN Hoteles abre `/search?type=hotel` y Tours, Paquetes y Vuelos abren `/search?type=tour`, `?type=package` y `?type=flight`
- THEN las categorías sin datos siguen marcadas como «Próximamente»

#### Scenario: Acciones de la barra
- GIVEN la cabecera pública
- WHEN se renderiza
- THEN aparecen el badge BCV, el selector de idioma y «Iniciar sesión» (o «Mis viajes» con sesión) junto a los enlaces de productos

### Requirement: Cabecera responsiva con glass definido

La cabecera SHALL conservar un margen lateral en todos los anchos, SHALL usar un botón de menú con
icono de hamburgesa en móvil y SHALL mostrar sus opciones en vertical al abrirlo. La superficie
SHALL ser semitransparente con desenfoque, borde visible y realce interior para distinguirse de un
fondo de color parecido, sin perder contraste AA.

#### Scenario: Cabecera estrecha
- GIVEN una ventana de 360px o menos de ancho
- WHEN se renderiza la cabecera
- THEN la barra no toca los bordes del viewport y conserva esquinas redondeadas
- THEN el botón de menú muestra un icono de hamburgesa con etiqueta accesible

#### Scenario: Menú vertical
- GIVEN el menú móvil cerrado
- WHEN se activa el botón de hamburgesa
- THEN cada producto, la tasa, el idioma y cada acción de sesión ocupa su propia fila, a ancho completo, sin quedar varios ítems en la misma línea
- THEN el botón cambia su estado accesible y el icono pasa a cerrar

#### Scenario: Borde de glass
- GIVEN la cabecera sobre un fondo del mismo color
- WHEN se renderiza
- THEN el fondo es translúcido con desenfoque y el borde de 1px con realce interior es visible
- THEN el texto sigue cumpliendo los escenarios de contraste AA

### Requirement: Gesto de cambio de sección animado

Las flechas de bajada SHALL ofrecer una respuesta visual al pulsarlas y SHALL desplazarse a la
sección destino con una animación explícita y continua cuando el usuario no pide movimiento
reducido. En pantallas pequeñas SHALL permanecer dentro del viewport y por encima de la zona segura
inferior.

#### Scenario: Pulsación de la flecha
- GIVEN una flecha de bajada visible
- WHEN se pulsa
- THEN el control desciende 8px en 140ms con una curva ease-out y vuelve a su sitio en 320ms, sin escalas bruscas ni ondas de impacto
- THEN con movimiento reducido el control no se desplaza pero el estado pulsado sigue siendo visible mediante el fondo

#### Scenario: Bajada gradual entre secciones
- GIVEN una flecha de bajada visible y movimiento normal
- WHEN se pulsa
- THEN el desplazamiento se interpola fotograma a fotograma desde la posición actual hasta el destino durante 760ms con una curva ease-in-out cúbica
- THEN el borde superior de la sección destino queda alineado con el viewport, sin dejar visible ninguna franja de la sección anterior bajo la cabecera flotante, y la URL conserva el ancla
- THEN el contenido de la sección queda por debajo de la cabecera gracias al padding y al centrado propios de la sección
- THEN una acción del usuario con rueda, táctil o teclado cancela la animación y deja el scroll en la posición alcanzada
- THEN con movimiento reducido el destino se alcanza de inmediato, sin interpolación

#### Scenario: Flecha en móvil
- GIVEN una ventana de 360x640
- WHEN se muestra una flecha de bajada
- THEN el control mide al menos 44x44px y queda dentro del viewport
- THEN no queda tapado por la zona segura inferior del dispositivo

### Requirement: Contenido ajustado al viewport

Cada sección de la portada SHALL reservar espacio para la cabecera flotante y para el gesto de
bajada, sin recortar ni tapar textos o acciones en pantallas estrechas o bajas.

#### Scenario: Hero sin solapamiento
- GIVEN la portada a 390x844 y a 360x640
- WHEN se renderiza el hero
- THEN el título y el subtítulo empiezan por debajo de la barra de la cabecera
- THEN la CTA del hero queda por encima de la flecha de bajada, sin solaparse con ella

#### Scenario: Secciones en pantalla baja
- GIVEN una ventana de 360x640
- WHEN se recorren búsqueda, destacados y cierre
- THEN sus encabezados y acciones quedan dentro del área útil, sin quedar tapados por la cabecera ni por la flecha
- THEN el contenido se compacta con alturas y espaciados reducidos en lugar de salirse del viewport

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
