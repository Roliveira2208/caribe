# Delta: admin-ui — f2-admin-rates

## MODIFIED Requirements

### Requirement: Idioma del panel
El idioma del panel SHALL resolverse con dos fuentes: el perfil del usuario (`user.locale`, escrito
por Better Auth) y la cookie `NEXT_LOCALE` que gestiona next-intl. El perfil SHALL ser la fuente
autoritativa al iniciar sesión: si existe y es `es` o `en`, el panel SHALL abrir en ese idioma aunque
la cookie o la URL pidan otro. Sin preferencia guardada en el perfil SHALL usarse `es`. Al cambiar de
idioma desde la cabecera SHALL escribirse `user.locale` y preservarse `NEXT_LOCALE` con el mismo valor;
si la escritura falla, SHALL NOT cambiarse la interfaz ni inventarse éxito. El valor SHALL aplicarse a
la cabecera, al contenido y a los mensajes de error localizados.

#### Scenario: Idioma persistido
- GIVEN un usuario que elige `en` en la cabecera del panel
- WHEN navega a otra ruta, recarga la página y cierra e inicia sesión de nuevo
- THEN `user.locale` y `NEXT_LOCALE` quedan en `en` y la interfaz sigue en `en`, incluidos encabezados, contenido y mensajes de error
- THEN sin elección previa en el perfil el panel arranca en `es`
- THEN el selector de idioma indica cuál está activo en todo momento

#### Scenario: Idioma persistido en el perfil y la cookie
- GIVEN un usuario que elige `en` en la cabecera del panel y después cierra e inicia sesión de nuevo
- WHEN vuelve a abrir el panel, navega a otra ruta y recarga la página
- THEN `user.locale` es `en`, la cookie `NEXT_LOCALE` es `en` y la interfaz sigue en `en`
- THEN la cabecera, el contenido y los mensajes de error localizados usan `en`
- THEN el selector de idioma indica `en` en todo momento

#### Scenario: Precedencia y respaldo del idioma
- GIVEN un perfil sin preferencia guardada, o con un valor distinto de `es`/`en`
- WHEN el usuario inicia sesión con cualquier valor en la cookie `NEXT_LOCALE` o en la URL
- THEN el panel arranca en `es`, sin inventar otro idioma
- GIVEN un perfil con `user.locale = es` y una cookie o URL que piden `en`
- WHEN el usuario inicia sesión
- THEN el perfil prevalece y el panel abre en `es`

#### Scenario: Fallo al guardar el idioma
- GIVEN un usuario auténtico con sesión válida
- WHEN la escritura de `user.locale` falla al elegir otro idioma
- THEN se muestra un error localizado, la interfaz conserva el idioma anterior y no se anuncia el cambio
