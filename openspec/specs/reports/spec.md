# reports Specification

## Purpose
Reporte de ventas de F2 para el panel administrativo. Fija el contrato de lectura, el alcance por rol y
las reglas de dinero para que totales y exportaciones sean reproducibles y no dependan de la tasa vigente
en el momento de consultar.

## Requirements

### Requirement: Reporte por rango de fechas
`GET /admin/reports/sales` SHALL aceptar filtros de rango de fechas (`from` y `to`, fechas `YYYY-MM-DD`,
ambos extremos inclusivos en `America/Caracas`) y de agencia (`agencyId`). El rango SHALL aplicarse a la
fecha del pago. Un rango invertido o una fecha inválida SHALL responder 422 sin datos parciales; una agencia no
permitida SHALL responderse sin datos, con el criterio de no revelación de `tenant-isolation`.

#### Scenario: Reporte por rango de fechas
- GIVEN pagos en varias fechas y agencias
- WHEN se llama a `GET /admin/reports/sales` con `from`, `to` y, si el rol lo permite, `agencyId`
- THEN se devuelven solo los pagos cuyas fechas caen dentro del rango inclusivo, en la zona horaria definida
- THEN el filtro de agencia reduce el resultado a esa agencia cuando el rol está autorizado
- THEN un rango invertido o una fecha inválida responde 422 con el código de validación de `api-errors`

### Requirement: Totales calculados en el servidor
Los totales SHALL calcularse en el servidor con `DECIMAL`, nunca con punto flotante. Cada pago SHALL
aportar su `amount_ves` y su `exchange_rate_id` congelados, sin recalcular con la tasa actual. Los montos
SHALL serializarse como cadenas con dos decimales y las tasas con cuatro, según `api-errors`.

#### Scenario: Totales calculados en el servidor
- GIVEN pagos con sus montos USD, montos VES y tasas congeladas, y una tasa vigente distinta al consultar
- WHEN se obtiene el reporte
- THEN el total USD es la suma `DECIMAL` de los `amount_usd` del rango y el total VES la suma de los `amount_ves` guardados
- THEN ningún total usa la tasa vigente ni vuelve a multiplicar los montos USD
- THEN los importes se devuelven como cadenas decimales con dos decimales, sin ceros artificiales ni coma como separador

### Requirement: Desglose por método y estado
El reporte SHALL incluir un desglose agrupado por método de pago y por estado del pago con recuentos y
sumas `DECIMAL`. Los estados SHALL ser los de la máquina de estados de `payments`. Sin pagos en el rango
SHALL devolverse estructuras vacías y totales en cero, nunca filas inventadas.

#### Scenario: Desglose por método y estado
- GIVEN pagos de varios métodos en estados distintos dentro del rango
- WHEN se obtiene el reporte
- THEN cada combinación método/estado presente muestra su recuento y sus sumas USD y VES con la tasa congelada
- THEN no aparece ningún estado fuera de la máquina de estados de `payments`
- THEN un rango sin pagos devuelve listas vacías y totales `"0.00"`

### Requirement: Alcance por rol
El acceso al reporte SHALL respetar los roles de `auth-access`: un Admin de agencia solo su agencia, un
Super Admin lectura de plataforma y de cualquier agencia, y cualquier otro rol SHALL recibir 403 sin
datos. El reporte SHALL ser de solo lectura para todos los roles.

#### Scenario: Alcance por rol
- GIVEN un admin de la agencia A, un Super Admin, un agente, un proveedor y un `member`
- WHEN cada uno pide el reporte con y sin `agencyId`
- THEN el admin recibe solo los datos de A, aunque pida otra agencia
- THEN el Super Admin puede leer la plataforma completa o filtrar por agencia, sin escribir nada
- THEN el agente, el proveedor y el `member` reciben 403 con `code = FORBIDDEN` y ningún dato del reporte

### Requirement: Exportación CSV del reporte
La exportación CSV SHALL aplicar exactamente los mismos filtros, validaciones y alcance por rol que la
respuesta JSON, con los mismos totales congelados. SHALL usar codificación UTF-8 y encabezados tomados de
los mensajes `es`/`en` según el idioma activo. SHALL NOT incluir secretos ni datos de tarjeta.

#### Scenario: Exportación CSV del reporte
- GIVEN un usuario autorizado y un rango con pagos
- WHEN descarga el CSV con los mismos filtros que usó para consultar
- THEN las filas y los totales coinciden con el JSON del reporte y respetan el alcance por rol
- THEN los encabezados salen de los mensajes `es` o `en` según el idioma activo
- THEN el archivo no contiene números de tarjeta, CVV, tokens, credenciales ni valores de secretos

## Casos límite

- Rango sin pagos: totales `"0.00"`, desgloses vacíos y CSV con encabezados pero sin filas de datos.
- Fecha de pago en el límite del rango: ambos extremos cuentan; la conversión a `America/Caracas` se aplica
  antes de filtrar.
- `agencyId` de otra agencia para un admin: se responde sin datos de esa agencia, con el mismo criterio de
  no revelación que `tenant-isolation`.
- Pago inconsistente sin `exchange_rate_id` o sin `amount_ves`: se reporta el dato como inconsistente y no
  se calcula con la tasa actual.
- Cambio de tasa entre la consulta y la exportación: el CSV conserva los importes congelados del pago.
- Método o estado sin filas: no se generan filas artificiales en el desglose.
- Pregunta abierta: ¿qué límite de filas o estrategia de paginación/streaming aplica la exportación para
  rangos grandes?
- Pregunta abierta: ¿cómo se elige el idioma del CSV cuando la petición no trae preferencia explícita?

## Acceptance

- Cada escenario tiene un test de integración o e2e, incluidos los errores 422 y 403.
- Un pago histórico sigue aportando el mismo `amount_ves` aunque la tasa vigente cambie antes de consultar.
- La matriz de roles se comprueba con datos de dos agencias; el CSV responde con la misma restricción.
- Los encabezados `es` y `en` se verifican en tests y el CSV se inspecciona en busca de secretos.
- No se usa punto flotante en ningún cálculo del reporte; lint, typecheck y tests en verde.

## Out of scope

- Facturación fiscal o comprobantes: el MVP solo emite documentos no fiscales.
- Reportes de inventario, ocupación, impuestos o comisiones.
- Gráficas, tableros o componentes visuales del panel: se rigen por `admin-ui`.
- Cálculo, publicación o override de tasas: se rige por `exchange-rates`.
