# admin-ui Specification

## Purpose
Panel administrativo de F2 en `apps/admin`. Fija la identidad visual Caribe dentro de Ant Design
(decisión D5 del SDD), la tipografía compartida, la cabecera, los textos localizados, la accesibilidad
y la manera en que la interfaz respeta la matriz de permisos. Así cada pantalla deja de improvisar
estilo, copia o visibilidad de módulos.

## Requirements

### Requirement: Identidad visual Caribe en Ant Design
El panel SHALL conservar Ant Design como librería de interfaz, según la decisión D5 del SDD, y SHALL
configurar sus tokens mediante `ConfigProvider` con azul `#0E2A3D`, ámbar `#F4A300`, turquesa
`#1FA6A0` y crema `#FBF7EF`. Ninguna pantalla SHALL introducir componentes de shadcn/ui en
`apps/admin` ni sobrescribir esos valores con tonos distintos.

#### Scenario: Tokens Caribe
- GIVEN una pantalla cualquiera del panel administrativo
- WHEN se renderiza
- THEN `ConfigProvider` aplica los tokens exactos `#0E2A3D`, `#F4A300`, `#1FA6A0` y `#FBF7EF`
- THEN los componentes Ant Design heredan esos tokens sin estilos locales que los contradigan
- THEN no se monta ningún componente de shadcn/ui en `apps/admin`

### Requirement: Tipografía compartida
La tipografía del panel SHALL consumirse desde un paquete compartido del monorepo: Clash Display para
titulares y General Sans para cuerpo. Los archivos y las declaraciones SHALL NOT copiarse en cada app,
y SHALL NOT solicitarse a un servicio externo.

#### Scenario: Tipografía compartida
- GIVEN `apps/admin` y `apps/web` mostrando un titular y un párrafo
- WHEN se aplican los estilos
- THEN ambos titulares usan Clash Display y ambos cuerpos usan General Sans desde el mismo paquete compartido
- THEN no existen copias de las fuentes ni declaraciones duplicadas dentro de `apps/admin`
- THEN ningún navegador pide fuentes a un dominio externo

### Requirement: Cabecera del panel
La cabecera SHALL mostrar la marca Caribe, la navegación permitida, el selector de idioma y las acciones
de sesión. El selector de agencia y la bandera del modo de aprobación se rigen por sus propios escenarios
deseables. SHALL NOT mostrar enlaces de la web pública ni acciones para las que el rol activo no tiene
permiso.

#### Scenario: Cabecera del panel
- GIVEN un usuario con sesión y una agencia activa, o un Super Admin en modo plataforma
- WHEN se renderiza la cabecera del panel
- THEN aparecen la marca, la navegación permitida, el selector de idioma y las acciones de sesión
- THEN no aparecen las acciones de la cabecera pública ni enlaces a módulos vedados al rol

### Requirement: Textos localizados
Todo texto visible del panel SHALL salir de mensajes `es` y `en`. Ningún componente SHALL contener
cadenas visibles fijas, y los estados vacíos y de error SHALL localizarse con el mismo mecanismo.

#### Scenario: Textos es y en
- GIVEN cualquier pantalla o estado del panel, incluidos vacíos y errores
- WHEN se renderiza con idioma `es` y con idioma `en`
- THEN cada texto visible procede del catálogo de mensajes correspondiente
- THEN no hay cadenas visibles escritas directamente en los componentes
- THEN no queda texto sin traducir al cambiar de idioma

### Requirement: Accesibilidad básica
Cada pantalla nueva del panel SHALL mantener foco visible, etiquetas asociadas a sus controles y
contraste AA con los tokens aprobados. Toda acción SHALL poder ejecutarse con teclado.

#### Scenario: Accesibilidad básica
- GIVEN un usuario que navega con teclado por una pantalla del panel
- WHEN tabula por controles, tablas, diálogos y acciones
- THEN cada control enfocable muestra un contorno de foco visible y sigue el orden visual
- THEN cada campo y control tiene una etiqueta accesible asociada y puede activarse con Enter o Espacio
- THEN el texto y sus estados cumplen contraste AA sobre los fondos con los tokens de la marca

### Requirement: Matriz de permisos F1 en la UI
La navegación y las pantallas SHALL derivarse de la matriz de permisos de F1. Un proveedor SHALL ver
solo su propio inventario y las reservas con productos suyos. Un `member` sin `booking:read` SHALL NO
ver módulos ni resúmenes de reservas. La UI SHALL comprobarse con tests que fallan si aparece un módulo
no permitido.

#### Scenario: Matriz de permisos F1 en la UI
- GIVEN un proveedor con productos propios y ajenos en su agencia, y un `member` sin `booking:read`
- WHEN cada uno abre el panel con su sesión
- THEN el proveedor ve solo su inventario y las reservas de sus líneas, sin productos ni reservas ajenas
- THEN el `member` no ve el módulo de reservas, sus enlaces ni ningún resumen o contador de reservas
- THEN un test de UI falla si la navegación o una pantalla muestra un módulo fuera de esa matriz

### Requirement: Coherencia con las respuestas de la API
La UI SHALL NOT mostrar datos que la API haya negado ni reconstruirlos a partir de respuestas anteriores
o de otro tenant. Un 403 o 404 SHALL traducirse en un estado de error o vacío localizado, sin datos
parciales.

#### Scenario: Sin datos negados por la API
- GIVEN una pantalla del panel y una API que responde 403 o 404 para una lista, un detalle o un resumen
- WHEN la UI procesa esa respuesta
- THEN no se muestran filas, importes, contadores ni resúmenes procedentes de ese recurso
- THEN no se reutilizan datos en caché de otra agencia ni de una respuesta denegada antes
- THEN se muestra un estado de error o vacío traducido, comprobado con tests de UI

### Requirement: Selector de agencia en la cabecera
El selector SHALL reflejar la organización activa de la sesión y SHALL ofrecer solo agencias de las que
el usuario es miembro. Con una sola membresía SHALL fijarse sin elección; con varias SHALL exigir una
elección; con cero SHALL impedir la entrada al panel salvo en modo plataforma del Super Admin. Al cambiar
de agencia SHALL descartarse todo dato en memoria de la agencia anterior.

#### Scenario: Selector de agencia en la cabecera
- GIVEN usuarios con una, varias y ninguna membresía, y un Super Admin en modo plataforma
- WHEN abren el panel y, cuando procede, eligen otra agencia desde la cabecera
- THEN con una sola membresía la agencia queda activa sin selector de elección
- THEN con varias se muestra el selector y ninguna agencia queda activa hasta elegir
- THEN con cero no se entra al panel, mientras el Super Admin entra en modo plataforma sin agencia activa
- THEN al cambiar de agencia los datos de la anterior desaparecen y se recargan bajo la nueva

### Requirement: Bandera del modo de aprobación
La cabecera SHALL mostrar el `payment_mode` de la agencia activa (`AUTO` o `MANUAL`) con una etiqueta
localizada. Las acciones de revisión de pagos SHALL aparecer solo cuando el modo sea `MANUAL` y el rol
permitido, y SHALL NOT inventarse cuando el modo no pueda determinarse.

#### Scenario: Bandera del modo de aprobación
- GIVEN una agencia con `payment_mode = MANUAL` y otra con `payment_mode = AUTO`
- WHEN se renderiza la cabecera de cada agencia
- THEN la bandera muestra el modo vigente con su etiqueta en el idioma activo
- THEN las acciones de aprobación o rechazo solo se ofrecen en `MANUAL` y al rol autorizado
- THEN un modo indeterminado o desconocido no muestra acciones de revisión ni un modo inventado

### Requirement: Idioma del panel
El idioma del panel SHALL ser `es` por defecto y SHALL persistirse entre rutas, recargas y nuevos
inicios de sesión del mismo usuario. El mismo valor SHALL aplicarse a la cabecera, al contenido y a los
mensajes de error localizados.

#### Scenario: Idioma persistido
- GIVEN un usuario que elige `en` en la cabecera del panel
- WHEN navega a otra ruta, recarga la página y cierra e inicia sesión de nuevo
- THEN la interfaz sigue en `en`, incluidos encabezados, contenido y mensajes de error
- THEN sin elección previa el panel arranca en `es`
- THEN el selector de idioma indica cuál está activo en todo momento

## Casos límite

- Membresía revocada mientras la sesión conserva la agencia activa: la cabecera deja de ofrecer esa
  agencia y las pantallas muestran el error de la API sin datos residuales.
- `member` sin `booking:read`: ni el módulo, ni el enlace, ni el resumen; un enlace directo recibe el
  403 de la API y no una pantalla vacía con cifras.
- Proveedor sin productos propios: estado vacío localizado, sin inventario ni reservas de otros.
- Cambio de agencia con peticiones en vuelo: se descartan las respuestas de la agencia anterior antes
  de pintar las nuevas.
- Mensaje ausente en `en`: se usa el texto `es` y se reporta la falta; nunca se inventa copia en el
  componente.
- Modo de aprobación indeterminado: se ocultan las acciones de revisión y se muestra el estado
  traducido como no disponible.
- Cabecera con `ConfigProvider` sin tokens: la pantalla no se considera terminada; no se permiten
  valores aproximados de la paleta.
- Pregunta abierta: ¿dónde se persiste el idioma (perfil, sesión o navegador) y qué prevalece si el
  navegador pide un idioma distinto al guardado?

## Acceptance

- `apps/admin` sigue usando Ant Design y no contiene componentes ni estilos de shadcn/ui.
- Los cuatro tokens exactos están configurados en `ConfigProvider` y son verificables en tests o
  capturas.
- Clash Display y General Sans se importan desde el paquete compartido; no hay copias por app.
- No quedan cadenas visibles fijas: todos los textos, estados vacíos y errores existen en `es` y `en`.
- Tests de UI cubren la matriz F1, la negación de datos por la API, el selector de agencia, la bandera
  de modo y la persistencia del idioma.
- Foco visible, etiquetas y contraste AA verificados en las pantallas nuevas; lint, typecheck y tests
  en verde.

## Out of scope

- Rediseñar la web pública o mover sus decisiones visuales: se rige por `web-ui`.
- Cambiar Ant Design por otra librería o redefinir la decisión D5 del SDD.
- Definir permisos de API o jerarquía de roles: se rige por `auth-access`.
- Diseñar reportes, exportaciones o políticas de seguridad HTTP: se rigen por sus propias specs.
