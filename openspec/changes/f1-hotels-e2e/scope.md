# Alcance de f1-hotels-e2e

Clasificación de los escenarios de los diez deltas de `f1-hotels-e2e`, alineada con el contenido
actual de `openspec/changes/f1-hotels-e2e/specs/*/spec.md` (conteo real de `#### Scenario:` por spec)
el 2026-11-16 como parte de la remediación de T-F1-10b.

## Criterio

- **Obligatorio**: toca dinero (cálculo, congelamiento, redondeo, reembolso, serialización), concurrencia
  (bloqueo, carrera, idempotencia, numeración), aislamiento (RLS, tenant/owner, catálogo público),
  autorización (rol, permiso, segundo factor, propiedad) o integridad de la máquina de estados. Sin
  esto no hay F1.
- **Deseable**: valida o pule el contrato sin poner en riesgo dinero, aislamiento ni autorización;
  puede recortarse si el tiempo aprieta, pero entra en F1 si cabe.
- **Aplazable**: fuera de F1 por decisión del dueño; no está en los deltas.

## Totales (reales, alineados a deltas)

| Spec | Escenarios | Obligatorio | Deseable | Aplazable |
| --- | ---: | ---: | ---: | ---: |
| api-errors | 17 | 10 | 7 | 0 |
| audit | 24 | 13 | 11 | 0 |
| auth-access | 32 | 28 | 4 | 0 |
| booking | 51 | 34 | 17 | 0 |
| catalog | 36 | 19 | 17 | 0 |
| documents | 23 | 12 | 11 | 0 |
| exchange-rates | 24 | 18 | 6 | 0 |
| notifications | 13 | 2 | 11 | 0 |
| payments | 35 | 26 | 9 | 0 |
| tenant-isolation | 33 | 30 | 3 | 0 |
| **Total** | **288** | **192** | **96** | **0** |

Los aplazables no son escenarios de estos deltas: se listan al final como capacidades movidas a F2.

**Regla de cierre:** solo los **192 escenarios obligatorios** bloquean el cierre de F1. Los
**96 deseables** se implementan si son baratos y, si no, pasan a F2 con una nota en `tasks.md`. Ningún
obligatorio se recorta para meter un deseable.

> Nota de alineación (2026-11-16): esta tabla y las listas por spec sustituyen los conteos/títulos
> anteriores (281/188/93) para reflejar los escenarios y títulos reales presentes en los deltas actuales.
> Algunos escenarios aparecen duplicados en los deltas (p. ej. en `auth-access` y `booking`); se
> conservan y clasifican tal como existen para mantener trazabilidad 1:1 con los specs.

## api-errors (17)

- **Obligatorio (10)**: Sin sesión · Sin permiso · Cupo agotado · Reserva vencida · Sin tasa · Campo
  desconocido · Monto, tasa o campo calculado enviado por el cliente · Monto con dos decimales · Tasa
  con cuatro decimales · Recurso de otra agencia.
- **Deseable (7)**: Error de validación · Recurso inexistente · Query o parámetro inválido · Fecha valor
  · Marca de tiempo · Error inesperado · Sin traza en la respuesta.

## audit (24)

- **Obligatorio (13)**: Admin aprueba un pago · Cliente crea una reserva · Expiración de una reserva ·
  Cambio de ajustes de la agencia · Agente consulta auditoría · Rechazo por falta de segundo factor ·
  Sin sesión · Sin secretos en el evento · Evento de plataforma · Evento de agencia · Admin de agencia
  no ve eventos de plataforma · Agente no lee eventos · Super Admin consulta todos.
- **Deseable (11)**: Escritura de Better Auth deja fila tras confirmarse · Filtro por acción · Escritura
  administrativa exitosa · Error de validación de la lib · Petición limitada · Fallo al escribir el
  intento · Fallo al escribir el resultado · Inmutabilidad de los intentos · Agencia desconocida ·
  Filtro por resultado · Sin mensaje interno.

## auth-access (32)

- **Obligatorio (28)**: Proveedor edita su producto · Proveedor edita producto de otro proveedor ·
  Cliente ve solo sus reservas · Super Admin intenta editar un producto · Super Admin intenta aprobar un
  pago · Admin de otra agencia · Agente de otra agencia · Prueba con el rol de aplicación · Operación de
  agencia sin agencia activa · Elegir una agencia ajena · Reserva anónima · Cliente reserva en una
  agencia · Cliente con reservas en dos agencias · Cliente en un endpoint de agencia · Cliente intenta
  fijar la agencia o el usuario · Proveedor edita su producto · Proveedor edita el producto de otro
  proveedor · Proveedor edita un producto de otra agencia · Admin edita un producto de su agencia · Super
  Admin intenta publicar · Agente crea su propia reserva · Agente intenta reservar para otra persona ·
  Admin ve las reservas de su agencia · Admin cancela una reserva de su agencia · Agente intenta cancelar
  una reserva ajena · Proveedor intenta cancelar · Super Admin intenta cancelar · Revisor distinto del
  pagador.
- **Deseable (4)**: Una sola membresía · Varias membresías · Cero membresías · Super Admin sin agencia.

## booking (51)

- **Obligatorio (34)**: Hay cupo en todas las noches · Falta una noche · No hay cupo suficiente en una
  noche · Reservas concurrentes sobre el último cupo · Sin sesión · Monto, tasa o campo calculado
  enviados por el cliente · Producto no publicado · Vence sin pago · Retención configurada · Retención
  por defecto · Pago aprobado justo antes de vencer · Pago tardío sobre reserva vencida · Expiración
  idempotente · Carrera entre pago y expiración · Reintento del mismo POST · Misma clave con otro cuerpo
  · Clave en vuelo · Respuesta guardada mínima · Cliente cancela reserva confirmada · Cancelar reserva
  ajena · Agente cancela solo las propias · Cancelar una reserva pendiente sin pago · Cancelar con un
  pago en revisión · Política congelada · Cancelar una reserva vencida · Formato y unicidad · Código
  enviado por el cliente · Sin datos personales en logs ni auditoría · Dueño consulta su reserva ·
  Personal consulta una reserva de su agencia · Personal de otra agencia · Mis reservas entre agencias ·
  Confirmar una reserva pendiente · Confirmar una reserva cancelada · Cancelar una reserva vencida · Fallo
  de auditoría.
- **Deseable (17)**: Fechas inválidas · Falta la clave · Clave expirada · Reintento sin auditoría
  duplicada · Cancelación repetida · Horas antes del check-in · Colisión de código · Reserva sin
  viajeros · Demasiados viajeros · Viajero sin documento · Datos del viajero en el voucher · Producto
  despublicado después de reservar · Filtro por estado · Crear una reserva deja auditoría · Expirar una
  reserva deja auditoría.

> Nota: el delta `booking` contiene 51 escenarios con algunos títulos duplicados (p. ej. "Cancelar una
> reserva vencida"). La clasificación anterior mantiene la intención: escenarios de cupo, dinero, bloqueo,
> idempotencia, estados, autorización y aislamiento como obligatorios; validaciones/UX/auditoría no crítica
> como deseables.

## catalog (36)

- **Obligatorio (19)**: Filtro por destino y fechas · Una noche sin cupo · Sin tasa disponible ·
  Equivalente en VES · Precio enviado por el cliente · Producto en borrador · Producto archivado ·
  Producto con borrado lógico · Hay cupo en todas las noches · Falta una noche · Una noche sin cupo ·
  Noche duplicada · Precio o fechas inválidos · Total por noche y habitación · Precio distinto por noche ·
  Detalle de un producto no público · Catálogo de dos agencias · Sin datos internos · Escritura anónima.
- **Deseable (17)**: Atributos inválidos · Clave desconocida en los atributos · Sin resultados ·
  Paginación sin duplicados ni huecos · Cursor inválido · Límite fuera de rango · Personas por encima de
  la capacidad · Falta traducción · El proveedor ve su borrador · Hotel válido · Más de diez imágenes ·
  Imagen con esquema no permitido · Imagen de un dominio no permitido · Estrellas o capacidad fuera de
  rango · Estancia demasiado larga · Detalle de un producto publicado · Disponibilidad de un producto
  publicado.

## documents (23)

- **Obligatorio (12)**: Descargar voucher ajeno · Numeración correlativa · Reintento del mismo pago ·
  Descarga autenticada · Personal de la agencia descarga · Sin sesión · Documento de otra agencia ·
  Nombre no adivinable · Ruta manipulada · Un voucher por reserva · Un comprobante por pago · Número
  único por agencia y tipo.
- **Deseable (11)**: Reserva confirmada · QR sin datos personales · Generación fallida · Impuestos ·
  Pago rechazado · Cambiar de proveedor · Voucher sin pago · URL pública · Documento en preparación ·
  Documento agotado · Reintentos automáticos.

## exchange-rates (24)

- **Obligatorio (18)**: Fuente disponible · Fuente caída · Tasa inválida del proveedor · Override sin
  motivo o sin permiso · Precedencia del override · El proveedor no pisa el override · Override global
  gana a la tasa BCV · Segundo login del mismo día no consulta · Alta de pago asegura la tasa del día ·
  Agencia no ve el override de otra · Catálogo público usa la tasa global · Pago usa el override de la
  agencia · El refresco de la tasa no escribe overrides · La tasa cambia después · Cálculo del monto en
  VES · Redondeo half-up · Modificación directa del par congelado · Reembolso con la tasa congelada.
- **Deseable (6)**: Sin ninguna tasa guardada y fuente caída · Circuit breaker · Sábado · Zona horaria
  de la fecha valor · Override con motivo · Override global.

Nota (T-F1-5b): el dueño cambió la fuente a Cotizave y el refresco diario programado por un refresco
perezoso al login y al alta de pago. Se mantienen como obligatorios "Segundo login del mismo día no
consulta" y "Alta de pago asegura la tasa del día".

## notifications (13)

- **Obligatorio (2)**: Destinatario único · Sin datos sensibles.
- **Deseable (11)**: Correo encolado · SMTP caído · Pruebas sin red · Reserva confirmada · Sin otros
  avisos · Usuario en inglés · Falta la plantilla inglesa · Sin locale · Reintento del mismo evento ·
  Evento repetido · Fallo definitivo.

El correo de confirmación es el único aviso de F1; sin él la reserva sigue siendo válida, por eso sus
escenarios funcionales de entrega son deseables y no bloquean el cierre.

## payments (35)

- **Obligatorio (26)**: Pago en VES por Pago Móvil · Cliente envía un monto o una tasa · Reserva vencida
  · Reserva cancelada · Reserva ya confirmada · Pago de una reserva ajena · Sin sesión · Modo AUTO ·
  Modo MANUAL aprobado · Modo MANUAL rechazado · Aprobar sin permiso · Revisor distinto del pagador ·
  Dos revisiones concurrentes · Aprobar sobre una reserva vencida · Política flexible con 100 % ·
  Reembolso parcial · La tasa cambia después del pago · Reembolso duplicado · Reembolso por encima del
  pago · Aprobar desde `IN_REVIEW` · Transición no listada · Número completo o CVV · Referencia
  duplicada · Misma referencia en otra agencia · Montos como cadenas · Monto enviado por el cliente.
- **Deseable (9)**: Rechazo sin motivo · Agencia de una sola persona · Reembolso del 0 % · Reembolsar un
  pago en revisión · Pago Móvil sin banco · Teléfono inválido · Zelle sin confirmación · Binance sin
  orden · Tarjeta de prueba.

## tenant-isolation (33)

- **Obligatorio (30)**: Sin contexto no se lee · Sin contexto no se escribe · Contexto de agencia no ve
  otra agencia · Contexto de plataforma escribe tasas globales · Contexto de plataforma no escribe filas
  de agencia · Contexto de agencia no ve filas de plataforma · Catálogo público no ve borradores ·
  Catálogo público no escribe · Cliente A no ve la reserva de cliente B · Agente de A no ve una reserva
  de B · Personal de A ve las reservas de su agencia · Cliente no puede escribir con un `user_id` ajeno
  · Agente no puede insertar en otra agencia · Cliente sin membresía ve su propia reserva · Claves de
  idempotencia no cruzan usuarios · Cliente sin membresía reserva en una agencia · Cuerpo con agencia o
  usuario ajenos · Cliente con reservas en dos agencias · Cliente no ve la reserva de otra persona ·
  Personal de A no ve una reserva de B · Cliente no accede a endpoints de agencia · La expiración solo
  toca su agencia · El trabajo de la tasa es global · El trabajo de la tasa no lee datos de agencia ·
  El trabajo de la tasa no toca otras tablas · El trabajo de la tasa no escribe filas de agencia · Sin
  rol que ignore RLS · Rol de aplicación sin contexto no ve nada · Tabla nueva sin RLS · RLS forzada
  también para el dueño · `rates_global` probado como el rol de aplicación.
- **Deseable (3)**: Contexto de plataforma ve todas las agencias · Un fallo en A no detiene B.

## Aplazados a F2 (no cuentan en los deltas)

1. Aviso de pago aprobado.
2. Aviso de pago rechazado.
3. Aviso de cancelación y de expiración.
4. Nota de reembolso en el PDF.
5. PDF del voucher en inglés.
6. Reintento manual de documentos desde la web.
7. Reembolsos parciales múltiples sobre un mismo pago.
8. Retención por producto.
9. Almacenamiento externo de PDF (S3/Blob) y enlaces públicos firmados.

## Recortes aplicados a los deltas

- `api-errors`: se conservan Problem Details, tabla de códigos, 422 estricto y serialización; fuera
  OpenAPI, localización de mensajes y errores de Better Auth salvo `TWO_FACTOR_REQUIRED`.
- `documents`: se conservan voucher, comprobante, numeración, descarga autenticada y ciclo de vida;
  fuera nota de reembolso, PDF en inglés y reintento manual.
- `notifications`: un solo correo (confirmación); el resto a F2.
- `booking` y `catalog`: inventario por noche, sin `btree_gist`; se eliminó `AVAILABILITY_OVERLAP` y se
  añadió `AVAILABILITY_DUPLICATED`.
