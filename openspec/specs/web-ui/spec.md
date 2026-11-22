# web-ui Specification

## Purpose
Interfaz pública de la web de F1: portada, búsqueda, detalle de hotel, checkout y área de cuenta.
Fija las rutas, la identidad visual, las animaciones y la accesibilidad para que el resultado no
dependa de decisiones improvisadas de estilo, movimiento o copia.

## Requirements

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
- THEN la petición contiene solo identificador del producto, fechas, cantidad y datos del viajero
- THEN la moneda elegida solo cambia la presentación del resumen; no se envía al servidor
- THEN el total y la tasa los calcula el servidor

#### Scenario: Checkout sin viajeros
- GIVEN el formulario de checkout sin viajeros
- WHEN el usuario intenta reservar
- THEN no se crea la reserva
- THEN se muestra el error asociado al bloque de viajeros

#### Scenario: Reserva creada
- GIVEN datos válidos y cupo en todas las noches
- WHEN se crea la reserva
- THEN checkout muestra el código de reserva y el estado "Pago en revisión"
- THEN no se navega a una ruta de pago o confirmación inexistente

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

### Requirement: Destino público del QR del voucher
El código QR del voucher SHALL llevar a una ruta pública de la web que exista en ambos idiomas. La
ruta SHALL ser fija e independiente del idioma (`/reservas/:code`, con prefijo `es` o `en`) y SHALL
registrarse en la configuración de enrutamiento junto al resto de rutas públicas. La página SHALL
mostrar únicamente el código de la reserva y una invitación a iniciar sesión para consultar «Mis
reservas». SHALL NOT mostrar datos personales, importes, estados, tokens ni pistas sobre la agencia;
SHALL NOT exigir sesión para abrirse.

#### Scenario: QR abre una página real en ambos idiomas
- GIVEN el QR de un voucher con código `CR-2026-0001`
- WHEN se abre `/es/reservas/CR-2026-0001` y `/en/reservas/CR-2026-0001`
- THEN ambas rutas devuelven 200, muestran el código y ofrecen iniciar sesión
- THEN el segmento `reservas` no cambia al cambiar de idioma

#### Scenario: Página sin datos de la reserva
- GIVEN la página pública del código
- WHEN se inspecciona su contenido
- THEN no aparece el nombre del viajero, el total, el estado ni la agencia

#### Scenario: Código con caracteres especiales
- GIVEN un código con caracteres que requieren codificación en la URL
- WHEN se abre su página
- THEN se muestra el código descodificado sin interpretarlo como HTML

## Casos límite

- Sin tasa global: se oculta el VES; nunca se calcula en el cliente.
- Producto no público o eliminado: detalle muestra error concreto y no expone atributos internos.
- Sin `backdrop-filter`: header azul sólido.
- Movimiento reducido: revelación y bajada instantáneas, sin transformación ni interpolación.
- Sin JavaScript: el formulario de búsqueda conserva su envío GET.
- Fallo de la API en detalle, checkout o reservas: estado de error con acción comprensible, sin dejar
  el formulario en un estado engañoso.
- Cambio de idioma: solo cambia el prefijo y los textos; el nombre de la ruta no se traduce.
- Anclas de la portada: el borde de la sección destino queda alineado con el viewport y su padding
  mantiene el contenido por debajo de la cabecera flotante.

## Acceptance

- Las pantallas públicas tienen captura de escritorio y móvil en claro y oscuro, revisadas antes del
  commit.
- Cada escenario de esta spec tiene evidencia en tests, capturas o ambos.
- Foco visible, etiquetas y errores verificados en las pantallas públicas.
- `verify:navigation` y `verify:contrast` en verde, además de lint, typecheck y tests del monorepo.
- Sin cambios en `apps/admin`.

## Out of scope

- Panel administrativo y sus ajustes: se rige por sus propias specs.
- Selector de tema oscuro o persistencia de preferencia.
- Logotipo de marca distinto del wordmark de texto.
- Pago real con tarjeta y emisión de comprobantes fiscales.
