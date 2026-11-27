# Delta: reports — f2-admin-rates

## MODIFIED Requirements

### Requirement: Reporte por rango de fechas
`GET /admin/reports/sales` SHALL aceptar filtros de rango de fechas (`from` y `to`, fechas
`YYYY-MM-DD`, ambos extremos inclusivos en `America/Caracas`) y de agencia (`agencyId`). El rango SHALL
aplicarse a la fecha del pago. Un rango invertido o una fecha inválida SHALL responder 422 sin datos
parciales; una agencia no permitida SHALL responderse sin datos, con el criterio de no revelación de
`tenant-isolation`. La exportación CSV SHALL servirse por la misma ruta con `format=csv`, sin añadir
una ruta nueva al inventario, y SHALL compartir exactamente las mismas validaciones, filtros y alcance.

#### Scenario: Reporte por rango de fechas
- GIVEN pagos en varias fechas y agencias
- WHEN se llama a `GET /admin/reports/sales` con `from`, `to` y, si el rol lo permite, `agencyId`
- THEN se devuelven solo los pagos cuyas fechas caen dentro del rango inclusivo, en la zona horaria definida
- THEN el filtro de agencia reduce el resultado a esa agencia cuando el rol está autorizado
- THEN un rango invertido o una fecha inválida responde 422 con el código de validación de `api-errors`
- THEN `format=csv` devuelve los mismos datos filtrados por la misma ruta, sin nueva ruta ni filtro distinto

### Requirement: Totales calculados en el servidor
Los totales SHALL calcularse en el servidor con `DECIMAL`, nunca con punto flotante. Cada pago SHALL
aportar su `amount_ves` y su `exchange_rate_id` congelados, sin recalcular con la tasa actual. Los montos
SHALL serializarse como cadenas con dos decimales y las tasas con cuatro, según `api-errors`. Los totales
SHALL sumar todos los pagos del rango con independencia de su estado, cualquiera que sea el estado de
la máquina de pagos; el desglose SHALL presentarlos agrupados por estado sin excluir ninguno del total.

#### Scenario: Totales calculados en el servidor
- GIVEN pagos con sus montos USD, montos VES y tasas congeladas, y una tasa vigente distinta al consultar
- WHEN se obtiene el reporte
- THEN el total USD es la suma `DECIMAL` de los `amount_usd` de todos los pagos del rango, en cualquier estado
- THEN el total VES es la suma de los `amount_ves` guardados, sin usar la tasa vigente ni volver a multiplicar los montos USD
- THEN los importes se devuelven como cadenas decimales con dos decimales, sin ceros artificiales ni coma como separador

### Requirement: Exportación CSV del reporte
La exportación CSV SHALL aplicar exactamente los mismos filtros, validaciones y alcance por rol que la
respuesta JSON, con los mismos totales congelados. SHALL usar codificación UTF-8 y encabezados tomados de
los mensajes `es`/`en` según el idioma activo. SHALL NOT incluir secretos ni datos de tarjeta. En el MVP
SHALL NOT imponer un límite de filas ni paginar el CSV; si la petición no trae preferencia explícita de
idioma, los encabezados SHALL salir de `es`. La detección de fórmulas SHALL ignorar los espacios y el BOM
(`U+FEFF`) iniciales sin eliminarlos del valor escrito.

#### Scenario: Exportación CSV del reporte
- GIVEN un usuario autorizado y un rango con pagos
- WHEN descarga el CSV con `format=csv` y los mismos filtros que usó para consultar
- THEN las filas y los totales coinciden con el JSON del reporte y respetan el alcance por rol
- THEN los encabezados salen de los mensajes `es` o `en` según el idioma activo, y por defecto de `es` sin preferencia explícita
- THEN el archivo no contiene números de tarjeta, CVV, tokens, credenciales ni valores de secretos
- THEN toda celda cuyo primer carácter no blanco ni BOM sea `=`, `+`, `-` o `@` se escribe con un apóstrofo como prefijo para que Excel y Sheets la abran como texto y no como fórmula, conservando los espacios o el BOM iniciales en el valor
- THEN en el MVP no hay límite de filas ni paginación del CSV
