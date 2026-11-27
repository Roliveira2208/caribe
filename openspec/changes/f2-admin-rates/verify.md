# Verificación independiente — PAUSA 1 (T-F2-10)

**Fecha:** 2026-11-25  
**Change:** `f2-admin-rates`  
**Alcance verificado:** override de tasa y revisión de seguridad antes de tocar pagos, catálogo ni usuarios.  
**Veredicto:** **PASS** — 22/22 escenarios obligatorios cubiertos (9 de `exchange-rates` + 13 de `security`).  
**Deseables de `exchange-rates`:** 3/3 completos con evidencia tras la corrección de la observación 1 (§6).  
**Bloqueos para avanzar:** ninguno. Las observaciones de la sección final son no bloqueantes.

Durante la verificación independiente no se modificó código fuente, specs, `tasks.md`, dependencias
ni historial de Git; antes de este informe `git status --short` estaba limpio. La corrección posterior
de la observación 1 se documenta en §6 y no cambia el veredicto de las 22 escenas obligatorias.

---

## 1. Comandos ejecutados

| Comando | Resultado |
| --- | --- |
| `node scripts/check-specs.mjs` | `OK: 15 specs válidas` |
| `pnpm exec openspec validate f2-admin-rates` | `Change 'f2-admin-rates' is valid`. 5 warnings no bloqueantes por requirements >500 caracteres en `audit`, `auth-access`, `catalog`, `exchange-rates` y `payments`. 0 errores. |
| `apps/api`: `vitest run` de 13 archivos enfocados | **13 archivos / 157 tests en verde**. Incluye `f2-exchange-rates.e2e.ts`, `security.e2e.ts`, `client-ip.test.ts`, `business-rate-limit.e2e.ts`, `refund-idempotency.e2e.ts`, `tenant.e2e.ts`, `active-membership.e2e.ts`, `api-errors.e2e.ts`, `api-errors.test.ts`, `two-factor.e2e.ts`, `access.test.ts`, `rates.test.ts` y `audit.e2e.ts`. |
| `apps/api`: verbose de `f2-exchange-rates.e2e.ts`, `business-rate-limit.e2e.ts`, `refund-idempotency.e2e.ts` | **3 archivos / 18 tests en verde**. |
| `apps/api`: verbose de `security.e2e.ts`, `client-ip.test.ts` | **2 archivos / 12 tests en verde**. |
| `apps/admin`: `vitest run` de 7 archivos enfocados | **7 archivos / 56 tests en verde**. Incluye `rates-client.test.ts`, `rates-panel.test.ts`, `panel-access.test.ts`, `csp.test.ts`, `accessibility.test.ts`, `messages.test.ts` y `visual-identity.test.ts`. |
| `apps/admin`: verbose de los 4 archivos nucleares | **4 archivos / 40 tests en verde**. |
| `apps/admin`: verbose de `accessibility.test.ts`, `messages.test.ts` | **2 archivos / 11 tests en verde**. |

Las corridas se solapan; los recuentos se listan como evidencia de cada ejecución, no para sumarlos.
No hubo tests fallidos. Los `WARN [ExchangeRateService] ... se usa el respaldo guardado: fetch failed`
son el fallback deliberado del proveedor en el stub de tests; las aserciones correspondientes pasaron.

---

## 2. `exchange-rates` — escenarios obligatorios

| # | Escenario | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | Ver tasa vigente | Cubierto | `apps/api/test/f2-exchange-rates.e2e.ts` → *"ver tasa vigente: owner, admin, agente y proveedor leen el texto del servidor"*. `apps/admin/test/rates-client.test.ts` → *"lee la tasa del servidor sin calcular nada"*. `apps/admin/test/rates-panel.test.ts` → ruta/componente y ausencia de `amountUsd`/`amountVes`/`type="number"`. `apps/admin/test/accessibility.test.ts` → *"foco visible..."* y *"controles etiquetados..."*. Código: `rates-client.ts:75-102`, `rates-panel.tsx:230-265,311-341`. |
| 2 | Override con motivo desde el panel | Cubierto | `f2-exchange-rates.e2e.ts` → *"override con motivo desde el panel: se crea is_override y se audita"* (rate `950.0000`, `source=MANUAL`, `reason`, `createdBy`, `audit.before=null`, `audit.after.reason`). `rates-panel.test.ts` → modal antes→después. Código: `exchange-rate.service.ts:225-255`, `exchange-rates.controller.ts:43-74`. |
| 3 | Sin segundo factor | Cubierto | `f2-exchange-rates.e2e.ts` → *"sin segundo factor: 403 TWO_FACTOR_REQUIRED y ninguna escritura"*. `rates-client.test.ts` → *conserva el código* `TWO_FACTOR_REQUIRED`. Código: `admin-two-factor.guard.ts:60-74`, `auth.ts:224-232`, `rates-panel.tsx:72-75`. |
| 4 | Sin permiso de tasa | Cubierto | `f2-exchange-rates.e2e.ts` → *"sin permiso de tasa: member, agente y Super Admin de agencia reciben 403"*. `rates-client.test.ts` → matriz *"member y roles desconocidos no ven ni resumen"*. Código: `exchange-rates.guard.ts:97-104,114-117`; `access.ts:56-66,73-110,117` (owner/admin `exchange-rate: read+update`, agent/provider solo `read`, member vacío, Super Admin solo `read` y sin override de agencia). |
| 5 | Membresía revocada | Cubierto | `f2-exchange-rates.e2e.ts` → *"membresía revocada: 403 ACTIVE_ORGANIZATION_REQUIRED"*. Código: `active-membership.guard.ts:14-21`, `active-membership.ts:43-63` (revalida `member` en cada petición; fallo cerrado). |
| 6 | Campos calculados del cliente | Cubierto | `f2-exchange-rates.e2e.ts` → *"campos calculados del cliente: 422 y ninguna tasa escrita"* (`amountUsd`, `amountVes`, `amount_ves`, `exchange_rate_id`, `calculatedRate`). `rates-client.test.ts` → 6 tests que rechazan esos campos antes de `fetch` y construyen el payload campo por campo. Código: `exchange-rate.schemas.ts:19-33` (`strictObject`, `rate` como texto), `rates-client.ts:108-152`. |
| 7 | Confirmación de override vigente | Cubierto | `f2-exchange-rates.e2e.ts` → *"confirmación de override vigente: el segundo guarda el antes y el después"*. `rates-panel.test.ts` → *"el modal muestra antes → después y exige confirmación explícita"*; `onCancel={closeModal}` y `closeModal` sin `setRateOverride`. `exchange-rate.service.ts:373-391` devuelve el `before` real. |
| 8 | Override de otra agencia | Cubierto (equivalente aprobado) | `f2-exchange-rates.e2e.ts` → *"auditoría y override de otra agencia: A no ve la fila ni el motivo de B"*: `/admin/audit-logs` de A no contiene el motivo de B y un `entityId` inyectado responde 422. `rates-client.test.ts` → *"no oculta un 404 de la API"*. `design.md:65-68` decide explícitamente no crear ruta por id: un override ajeno no existe en el ámbito activo. Véase observación 2. |
| 9 | Auditoría del override | Cubierto | `audit.e2e.ts` → *"deja fila con actor, accion, antes, despues, IP y fecha de la sesion"* (`tenantId`, `actorId`, `action`, `before`, `after.reason`, `ip` truthy, `at`). `f2-exchange-rates.e2e.ts` admite `ip === null` o string. Código: `audit-interceptor.ts:66-95` (misma transacción, actor/IP de sesión/petición, `attachAuditData`), `audit.service.ts:32-45` (sanitiza y `ip ?? null`). |

### Deseables

| Escenario | Estado | Evidencia |
| --- | --- | --- |
| Tasa global del Super Admin | Completo | `f2-exchange-rates.e2e.ts` → *"tasa global del Super Admin: tenant NULL sin revelar la de las agencias"* (audit `tenantId=null`, agencia sigue con su tasa). `rates-client.test.ts` → *"fija la tasa global con la ruta de plataforma"*. `panel-access.test.ts` → modo plataforma. Código: `exchange-rates.guard.ts:82-95`, `exchange-rate.service.ts:262-291`, migración `20261114210000_exchange_rates_platform_global_write`. |
| Fecha valor futura | Completo | `f2-exchange-rates.e2e.ts` → *"fecha valor futura: no se aplica como vigente antes de esa fecha"* (fila futura `is_override=true`, `current` sigue en `today`). Código: `exchange-rate.schemas.ts:25-32` (solo prohíbe pasado) y `exchange-rate.service.ts:325-354` (`value_date <= fecha`). |
| Historial de overrides | Completo | `rates-client.test.ts` → filtra por `exchange-rate.override`, oculta `tenantId`, deja historial vacío en 403 y comprueba *"ordena el historial por fecha valor, no por el orden de auditoría"*. `rates-client.ts:184-195` ordena por `after/before.valueDate` con desempate por `at`; aunque la API ordena por `at desc` (`audit.controller.ts:75`), el panel presenta la fecha valor primero. `audit.controller.ts:49-75` restringe a la agencia activa (owner/admin) o plataforma. `rates-panel.tsx:173-214,266-279` muestra actor, motivo y antes→después. |

---

## 3. `security` — 13 escenarios obligatorios

| # | Escenario | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | IP tras proxy de confianza | Cubierto | `security.e2e.ts` → *"IP tras proxy de confianza"*; `client-ip.test.ts` → *"recorre la cadena hasta el primer salto que no es proxy"*. Código: `client-ip.ts:108-130,149-169`. |
| 2 | Cabecera de proxy no confiable | Cubierto | `security.e2e.ts` → *"Cabecera de proxy no confiable"*; `client-ip.test.ts` → *"ignora la cabecera cuando el socket no es de confianza"* e *"ignora una cadena cuyo último salto no es el socket"*. `client-ip.ts:115-121` exige que el último salto coincida con el socket. |
| 3 | Rate limit por IP real | Cubierto | `security.e2e.ts` → *"Rate limit por IP real"* (contadores separados, cabecera falsificada no contamina) y aserción `code=RATE_LIMITED` (`security.e2e.ts:235`). Código: `bootstrap.ts:68-72`, `login-rate-limit.ts:50`, `problem-details.filter.ts:161`. |
| 4 | Cabeceras de seguridad en la API | Cubierto | `security.e2e.ts` → *"Cabeceras de seguridad en la API"*. Código: `bootstrap.ts:48-51` registra Helmet antes de rutas, filtros y 429. |
| 5 | CSP sin scripts inline | Cubierto | `apps/admin/test/csp.test.ts` → 5 tests: nonce por petición, sin `unsafe-inline` en `script-src`, applied a páginas de error, `unsafe-eval` solo en desarrollo. Código: `lib/csp.ts:8-22`, `proxy.ts:15-26`. |
| 6 | CORS con orígenes permitidos | Cubierto | `security.e2e.ts` → *"CORS con orígenes permitidos"*. Código: `bootstrap.ts:52-66`: callback devuelve exactamente el origen listado, sin `*`. |
| 7 | CORS con origen desconocido | Cubierto | `security.e2e.ts` → *"CORS con origen desconocido"*; el callback devuelve `false`, por lo que no hay ACAO ni credenciales. |
| 8 | Límite en creación de reservas | Cubierto | `business-rate-limit.e2e.ts` → *"Límite en creación de reservas"*: 429 `application/problem+json`, `code=RATE_LIMITED`, sin reserva ni cupo bloqueado. |
| 9 | Límite en alta y revisión de pagos | Cubierto | `business-rate-limit.e2e.ts` → *"Límite en alta y revisión de pagos"*: pago sigue en revisión y la reserva no cambia. |
| 10 | Límite en descargas | Cubierto | `business-rate-limit.e2e.ts` → *"Límite de descargas"*: 429 sin bytes ni ruta interna; descarga posterior permitida. |
| 11 | Reembolso idempotente | Cubierto | `refund-idempotency.e2e.ts` → *"Reembolso idempotente: repetir cancelación no emite un segundo reembolso"* y *"no expone secretos del proveedor en la respuesta de cancelación"*. El delta `security` exige `refundId` generado por servidor y 409 `REFUND_ALREADY_ISSUED` para otro id sobre el mismo pago. |
| 12 | Rollback sin reembolso externo | Cubierto | `refund-idempotency.e2e.ts` → *"si revierte la transacción no se llama al proveedor"* y *"un fallo al registrar el resultado deja la fila pendiente"*. |
| 13 | Reconciliación de reembolsos | Cubierto | `refund-idempotency.e2e.ts` → *"cierra los aplicados, deja los pendientes y audita"*. |

---

## 4. Revisión de seguridad del override

- **Tenant activo y RLS.** `active-membership.ts:43-63` revalida la membresía antes de fijar el GUC;
  `tenant.e2e.ts:181-192` demuestra que `caribe_app` es `NOBYPASSRLS` y que RLS aísla *sin* `where`;
  `tenant.e2e.ts:407-420` exige RLS habilitada y forzada en toda tabla de negocio. La migración
  `20261114012056_bookings_payments_documents.sql:830-855` habilita/fuerza RLS en `exchange_rates` y
  limita la escritura de agencia a `tenant_id = app.tenant_id`. El controller toma el `tenantId` del
  actor (`exchange-rates.controller.ts:50-58`), nunca del cuerpo.
- **2FA/TOTP.** `admin-two-factor.guard.ts:60-74` y `auth.ts:224-232` responden 403
  `TWO_FACTOR_REQUIRED` a roles administrativos sin TOTP en rutas `/admin`, antes de validar permisos o
  cuerpo. La UI redirige a `/two-factor` al recibir ese código (`rates-panel.tsx:72-75`).
- **Roles.** `access.ts:73-110` da `exchange-rate: read+update` a owner/admin, solo `read` a
  agent/provider y nada a `member`; `superAdminRole` solo `read`. `exchange-rates.guard.ts:82-117`
  rechaza el override de agencia del Super Admin y exige modo plataforma sin agencia activa para la
  tasa global. La matriz de la UI coincide (`rates-client.ts:190-209` y su test).
- **Campos calculados y decimal.** `exchange-rate.schemas.ts:19-33` usa `strictObject`, exige `rate`
  como texto decimal y `reason` no vacío, y rechaza fecha valor pasada. El servicio inserta
  `${body.rate}::numeric` (`exchange-rate.service.ts:237-252`), sin `float` ni monto del cliente.
- **Auditoría.** `@Auditable` y `attachAuditData` (`exchange-rates.controller.ts:43-74`) capturan
  `before` real y `after` con motivo; `audit-interceptor.ts:76-95` escribe en la misma transacción con
  el GUC correcto y fallo cerrado si falta la fila. `audit.service.ts:32-45` sanitiza JSON y tolera
  `ip=null`. `audit.e2e.ts:122-153` verifica actor, acción, antes/después, IP y fecha en un override real.
- **IP real.** `client-ip.ts:149-169` borra la cabecera interna aportada por el cliente, fija
  `request.ip` y publica el mismo valor para Better Auth; `bootstrap.ts:68-72` registra el middleware
  antes del limitador y de la sesión. `resolveClientIp` devuelve `null` cuando no hay cliente
  identificable (`client-ip.ts:129-130`, test *"devuelve null cuando todos los saltos son proxies de confianza"*).
- **Rate limiting / CORS / CSP.** Ver filas 3-7 y 8-10 de la sección 3: Helmet antes de errores,
  orígenes exactos sin comodín, y CSP con nonce por petición sin `unsafe-inline` en `script-src`.
- **Cancelar el modal.** `rates-panel.tsx:120-126` solo limpia estado local; `confirmOverride` es el
  único llamador de `setRateOverride` (`rates-panel.tsx:150-171`). `rates-panel.test.ts:103-122` lo
  comprueba estáticamente. No hay escritura porque no se emite petición.

---

## 5. Observaciones (no bloqueantes)

1. **Baja — orden del historial.** La spec deseable pide orden por fecha valor; `audit.controller.ts:75`
   ordena por `at desc` y `listRateAudits` no reordena. El historial muestra la fecha valor en cada fila,
   pero el orden observable es cronológico de auditoría. No afecta a dinero, autorización ni aislamiento.
2. **Informativa — 404 literal en "override de otra agencia".** No existe ruta por id por decisión
   expresa en `design.md:65-68`; la evidencia es funcional (422 al inyectar `entityId`, ausencia de fila
   y motivo en `/admin/audit-logs`) y el cliente conserva un 404 real si la API lo devuelve. No se ejecutó
   un test de 404 HTTP literal.
3. **Informativa — cancelación del modal sin test runtime.** La cobertura es inspección estática del
   componente (`closeModal` no contiene `setRateOverride`), no un test de interacción en navegador.
4. **Informativa — IP del override con proxy confiable.** `audit.e2e.ts` comprueba que el override deja
   IP truthy con socket directo y `security.e2e.ts` comprueba que la IP resuelta se usa en auditoría y
   rate limit de login; no hay un único test que afirme que `audit.ip` de un override trasladado por un
   proxy confiable iguala la IP reenviada. El código usa el mismo `request.ip` en ambos caminos
   (`audit-interceptor.ts:94`, `client-ip.ts:163-168`).

**Conclusión:** la PAUSA 1 puede cerrarse en verde. La observación del historial se resolvió después
del informe independiente (§6) y no impide el inicio de pagos/catálogo/usuarios.

---

## 6. Corrección posterior a la verificación

Tras recibir el informe independiente se cerró la **observación 1** (orden del historial), única
salvedad de los escenarios deseables:

- `apps/admin/src/lib/rates-client.ts:184-196` ordena las filas por `after.valueDate` (o
  `before.valueDate` si no hay `after`) con desempate por `at` descendente. La API sigue ordenando
  por `at desc`, pero el panel presenta la fecha valor primero, como exige la spec.
- `apps/admin/test/rates-client.test.ts` añade *"ordena el historial por fecha valor, no por el
  orden de auditoría"*: tres auditorías con `at` y `valueDate` en órdenes opuestos y una aserción
  explícita del orden resultante. Falló en rojo antes del cambio y pasa después.
- Ejecución de comprobación: `pnpm --filter @caribe/admin exec vitest run` → 11 archivos /
  **72 tests en verde** (antes 71). `eslint` sobre los dos archivos tocados, en verde.

Las observaciones 2-4 siguen registradas como informativas/no bloqueantes; no se ha tocado código
de API, specs, `tasks.md` ni dependencias.

---

# Verificación independiente — PAUSA 2 (T-F2-13)

**Fecha:** 2026-11-25  
**Change:** `f2-admin-rates`  
**Alcance verificado:** panel de pagos (T-F2-11 y T-F2-12) y no regresión de seguridad antes de
catálogo y usuarios/roles.  
**Veredicto:** **PASS** — 8/8 escenarios obligatorios de `payments` con test concreto y 13/13
obligatorios de `security` en verde; auditoría de seguridad sin hallazgos Critical/High/Medium.  
**Deseables de `payments`:** 0 completos, 2 parciales (estado vacío y estado de error) y 2 pendientes
(exportación CSV y columnas configurables). No bloquean F2; se retoman en T-F2-25 o se recortan con
nota en la verificación final.  
**Bloqueos para avanzar:** ninguno.

La verificación la hicieron dos agentes independientes en conversaciones limpias y modo solo lectura:
uno derivó tests por escenario y el otro auditoría de seguridad. Antes de los informes `git status
--short` estaba vacío en `main` @ `98029bc`; ninguno modificó código, specs, `tasks.md`, dependencias
ni historial de Git. La corrección de la observación L1 se documenta en §7 y no cambia el veredicto.

## 1. Comandos ejecutados por los verificadores

| Comando | Resultado |
| --- | --- |
| `node scripts/check-specs.mjs` | `OK: 15 specs válidas` |
| API: `vitest run` de `payments.e2e.ts`, `security.e2e.ts`, `business-rate-limit.e2e.ts`, `refund-idempotency.e2e.ts`, `two-factor.e2e.ts` | **5 archivos / 78 tests en verde** |
| API: `security.e2e.ts`, `business-rate-limit.e2e.ts`, `refund-idempotency.e2e.ts` aislados | **3 archivos / 14 tests en verde** |
| Admin: `vitest run` de `payments-client`, `payments-panel`, `panel-access`, `accessibility`, `messages` | **5 archivos / 73 tests en verde** |

Los recuentos se listan como evidencia de cada ejecución, no para sumarlos. No hubo tests fallidos.

## 2. `payments` — 8 escenarios obligatorios

| # | Escenario | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | Listado filtrable | Cubierto | `payments.e2e.ts` → *"el panel lista solo la agencia activa, pagina y filtra"* (solo A, `status`/`method`, cursor, decimales del servidor y `exchangeRateId`). `payments-client.test.ts` → filtros y cursor; `payments-panel.test.ts` → *"pide cada página al servidor con el cursor y no pagina en el cliente"*. Código: `admin-payments.controller.ts:49-56`, `payments.service.ts:333-372`, `payments-client.ts:132-149`, `payments-panel.tsx:101-143`. |
| 2 | Aprobar con TOTP | Cubierto | `payments.e2e.ts` → *"aprueba en modo MANUAL, confirma la reserva y audita el antes/después"*. `two-factor.e2e.ts` → *"inventario Nest: toda ruta administrativa exige segundo factor"* (incluye `approve`/`reject`, sin TOTP → 403 `TWO_FACTOR_REQUIRED`). La UI redirige a `/two-factor` (`payments-panel.tsx:74-77`). |
| 3 | Rechazo con motivo en el panel | Cubierto | `payments.e2e.ts` → *"rechaza con motivo, deja la reserva pendiente y guarda el motivo"* y *"rechaza sin motivo con 422"*. `payments-client.test.ts` → *"exige motivo antes de llamar a la API"*. Código: `payments.schemas.ts:40-45`, `payments.service.ts:503-525`. |
| 4 | Revisor distinto del pagador en la UI | Cubierto | `payments.e2e.ts` → *"impide que el pagador revise su propio pago"* (403 y sigue `IN_REVIEW`). `payments-client.test.ts` → matriz `canReviewPayment`; `payments-panel.test.ts` → botones deshabilitados con mensaje es/en. Código: `payments.service.ts:412-419`, `payments-panel.tsx:215-230`, `page.tsx:44-62`. |
| 5 | Par congelado solo lectura | Cubierto | `payments.e2e.ts` → *"rechaza montos, tasas y campos calculados enviados por el cliente"* (422). `payments-client.test.ts` → par del servidor como texto; `payments-panel.test.ts` → sin `type="number"` ni `Number(row.*)`. Código: `payments.schemas.ts:30-45`, `payments-panel.tsx:185-201`. |
| 6 | Revisión concurrente en la UI | Cubierto | `payments.e2e.ts` → *"resuelve dos revisiones concurrentes con una sola ganadora"* (200 + 409 `PAYMENT_ALREADY_REVIEWED` con solapamiento forzado). `payments-client.test.ts` → conserva el código y recarga; `payments-panel.test.ts` → recarga y deshabilita acciones. Código: `payments.service.ts:427-451`, `payments-panel.tsx:82-121`. Véase observación L1 y §7. |
| 7 | Sin permiso de lectura de pagos | Cubierto | `payments.e2e.ts` → *"niega el listado a member y provider; agente y plataforma solo leen"*. `payments-client.test.ts` → matriz de roles y Super Admin de solo lectura. Código: `payments.guard.ts:98-130`, `payments-client.ts:42-56`, `page.tsx:40-62`. |
| 8 | Pago de otra agencia | Cubierto | `payments.e2e.ts` → *"el detalle respeta la agencia y el Super Admin ve todas"* (404 para B desde A) y *"rechaza filtros fuera del contrato y no cruza reservas de otra agencia"* (lista vacía). Código: `payments.service.ts:333-386,412-416`. Véase observación 2. |

## 3. `security` — confirmación de no regresión

Los 13 escenarios obligatorios siguen respaldados por las mismas pruebas de la PAUSA 1, ejecutadas
otra vez sobre `98029bc`: `security.e2e.ts` (IP real, proxy no confiable, cabeceras, CORS y límite de
login), `business-rate-limit.e2e.ts` (reservas, pagos y descargas) y `refund-idempotency.e2e.ts`
(idempotencia, rollback, fila pendiente, reconciliación y sin secretos). **14/14 tests en verde.**
Los dos commits de pagos no tocaron `bootstrap.ts`, `security/*`, migraciones ni el flujo de reembolsos.

## 4. Auditoría de seguridad independiente

**Veredicto: PASS**, riesgo residual 10/100, sin hallazgos Critical/High/Medium. Comprobaciones
explícitas:

1. **Montos/tasa/id de tasa:** `paymentBodySchema` es `strictObject` sin campos calculados; la UI pinta
   cadenas del servidor y no contiene `Number(row.amount*)`. No hallazgo.
2. **Roles, TOTP y autorrevisión:** matriz única en `access.ts`, guard global de segundo factor en
   rutas `/admin`, `PaymentsGuard` falla cerrado y el servicio niega la revisión propia. La UI solo
   refleja la matriz; la autoridad es la API. No hallazgo.
3. **Tenants y `exchangeRateId`:** `tenantId` de sesión revalidada, RLS forzada, listado/detalle/revisión
   filtrados y `exchangeRateId` serializado desde la fila con FK y trigger de inmutabilidad. No hallazgo.
4. **Concurrencia:** bloqueo `bookings` → `payments` con `FOR UPDATE`, second check y una sola escritura;
   pago, reserva, documentos, aviso y auditoría comparten transacción. No hallazgo (véase L1).
5. **Secretos y mensajes:** 5xx convertidos a `INTERNAL_ERROR` con `correlationId`; la UI usa solo
   claves es/en y nunca muestra `cause.message`; el contrato no acepta PAN/CVV. No hallazgo.
6. **Regresiones de red y reembolsos:** Helmet/CORS/CSP, IP real, rate limiting y outbox intactos. No hallazgo.

## 5. Deseables de `payments`

| Escenario | Estado | Motivo |
| --- | --- | --- |
| Exportación CSV de pagos | Pendiente | Sin endpoint, botón ni test. |
| Columnas configurables | Pendiente | Columnas fijas; sin preferencias persistentes ni test. |
| Estado vacío | Parcial | Texto es/en en `locale.emptyText`; sin test de render ni de foco. |
| Estado de error | Parcial | `handleError` cubre 401/2FA/403/409/410/422 y genérico; faltan mensajes propios para `ACTIVE_ORGANIZATION_REQUIRED` y 404, y comprobación de foco. |

## 6. Observaciones de los verificadores

1. **L1 (baja) — conflicto secuencial:** una segunda revisión que llega después del primer commit
   recibe 409 `INVALID_STATE_TRANSITION` (estado terminal observado en la lectura inicial), mientras
   que `PAYMENT_ALREADY_REVIEWED` se reserva para el solapamiento real. Es la distinción exigida por
   la spec base, así que **no se cambió la API**; la UI sí debe recargar en ambos casos. Corregida en §7.
2. **L2 (baja) — cobertura de UI estática:** los tests del panel comprueban el código fuente; las
   funciones puras sí tienen tests unitarios. No hay test de interacción con navegador para el botón
   deshabilitado ni para la recarga. Coherente con la limitación ya registrada en PAUSA 1.
3. **Informativa — trazabilidad:** la cobertura F2 de pagos vive en `payments.e2e.ts` heredado y en los
   tests de `apps/admin`; no hay un `f2-payments.e2e.ts` con ese nombre.
4. **Baja — 404 en revisión ajena:** el 404 HTTP se afirma para el detalle; `approve`/`reject` de otra
   agencia está bloqueado por `tenantId` en el servicio, pero sin aserción HTTP directa.
5. **Baja — TOTP payments-específico:** el 403 se verifica con el inventario global de rutas `/admin`,
   no con un caso puntual de aprobación; la redirección de UI es inspección estática.
6. **Baja — claves calculadas exactas:** el e2e rechaza `amount_usd`, `amount_ves`, `rate`, `tenant_id`
   y `user_id`; no envía literalmente `amountUsd`/`amountVes`/`exchange_rate_id`. El `strictObject`
   las rechazaría por desconocidas.

## 7. Corrección posterior a la verificación

Se cerró la observación L1 sin cambiar el contrato de la API:

- `apps/admin/src/lib/payments-client.ts` añade `isReviewConflict`, que reconoce como conflicto
  `PAYMENT_ALREADY_REVIEWED` e `INVALID_STATE_TRANSITION` con estado 409; otros 409 (por ejemplo
  `BOOKING_CANCELLED`) siguen mostrando el error genérico.
- `apps/admin/src/components/payments-panel.tsx` usa esa función en `handleError`, de modo que una
  vista desactualizada recarga la lista y deshabilita las acciones, sin presentar un segundo resultado.
- `payments-client.test.ts` y `payments-panel.test.ts` añaden tests que fallaron en rojo antes del
  cambio: ambos códigos se tratan como conflicto y otros errores no.

Comprobación: `pnpm --filter @caribe/admin exec vitest run` → 12 archivos / **116 tests en verde**;
`pnpm lint`, `pnpm typecheck` y `pnpm test` en verde. Las observaciones 2-6 siguen registradas como
informativas o no bloqueantes; no se ha tocado specs ni dependencias.

**Conclusión:** la PAUSA 2 puede cerrarse en verde. Se autoriza iniciar catálogo y usuarios/roles.

---

# Verificación independiente — PAUSA 3 (T-F2-19d)

**Fecha:** 2026-11-26  
**Change:** `f2-admin-rates`  
**Alcance verificado:** catálogo del panel (T-F2-18, T-F2-19 y correctoras T-F2-19a/b/c), antes de
reportes y de la verificación final.  
**Veredicto:** **PASS** — 8/8 escenarios obligatorios de `catalog` con evidencia ejecutable, sin
hallazgos Critical/High/Medium y riesgo residual bajo.  
**Bloqueos para avanzar:** ninguno.

La primera ejecución de esta pausa fue **FAIL**: H1 (la propagación por `hotel_key` alcanzaba
productos de otro proveedor) y M1 (el panel solo editaba noches, no las creaba). H1 se cerró con la
spec/design/tareas en `ebfecca` y el fix en `029d6dd` con rojo→verde documentado; M1 se cerró con el
wireframe aprobado en `64d41ea` y la UI en `d05c1ec`. La trazabilidad y las aserciones HTTP
pendientes se cerraron en `815884e`.

La re-verificación la hicieron dos agentes independientes en conversaciones limpias y modo solo
lectura (auditoría de código + derivación de tests por escenario) sobre `main` @ `815884e`; antes de
sus informes `git status --short` estaba vacío y ninguno modificó archivos, specs, `tasks.md`,
dependencias ni historial. Las correcciones posteriores a sus informes se documentan en §4.

## 1. Comandos ejecutados

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @caribe/api exec vitest run test/products-admin.e2e.ts test/products-admin.test.ts` | **2 archivos / 48 tests en verde** (29 E2E + 19 unitarios). Sin fallos. |
| `pnpm --filter @caribe/admin exec vitest run` | **18 archivos / 171 tests en verde** durante la verificación; **172** tras la corrección de §4. |
| `pnpm --filter @caribe/admin exec vitest run test/catalog-client.test.ts test/catalog-panel.test.ts` | **2 archivos / 25 tests en verde** (26 tras la corrección). |
| `pnpm --filter @caribe/api exec vitest run test/bookings.e2e.ts -t "retiene cupo en todas las noches"` | **1 test en verde**, 49 omitidos por el filtro. Confirma que la noche de salida no se ocupa. |
| `pnpm --filter @caribe/api exec vitest run test/catalog-api.e2e.ts test/catalog.e2e.ts` | **43 tests en verde**, incluido el fallback público `es`→`en`. |
| `pnpm lint` · `pnpm typecheck` | Turbo **4/4** y **5/5 successful**; el auditor además ejecutó `turbo run typecheck --force` → **5/5 sin caché**. |
| `node scripts/check-specs.mjs` | `OK: 15 specs válidas`. |
| `pnpm exec openspec validate f2-admin-rates` | `Change 'f2-admin-rates' is valid`. **6 warnings** no bloqueantes por requirements >500 caracteres; **0 errores**. |

Los recuentos se listan como evidencia de cada ejecución, no para sumarlos. Los
`WARN [ExchangeRateService] ... se usa el respaldo guardado` son el fallback deliberado del stub de
tasa; ninguna aserción falló.

## 2. `catalog` — 8 escenarios obligatorios

| # | Escenario | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | Alta de producto en el panel | Cubierto | `products-admin.e2e.ts` → alta del Proveedor sin `providerId` (201, `DRAFT`) y alta por Admin; `catalog-client.test.ts` → POST con `basePriceUsd` texto y sin campos calculados; `products-admin.service.ts` fija `tenantId` y estado. |
| 2 | Edición de producto de la agencia | Cubierto | `products-admin.e2e.ts` → edición y propagación de hotel, 422 a claves calculadas y referencias ajenas; `products-admin.schemas.ts` usa `strictObject`; `catalog-client.test.ts` refleja el estado del servidor. |
| 3 | Proveedor edita solo sus productos | Cubierto | `products-admin.e2e.ts` → mismo `hotel_key` no propaga a otro proveedor ni a otra agencia, `PUT` directo ajeno da 404 con el mismo `detail` que un UUID inexistente, y publish/archive también 404; `products-admin.service.ts` acota `hotelScope` por `providerId`; la UI oculta acciones por matriz. |
| 4 | Publicar y archivar producto | Cubierto | `products-admin.e2e.ts` → público 200 → archivado 404 → **re-publicar 200 y visible de nuevo**; Super Admin 403 con estado inalterado; `products.guard.ts` y `catalog-client.test.ts`. |
| 5 | Disponibilidad por noche | Cubierto | `products-admin.e2e.ts` → alta con `reserved: 0`, actualización de una sola fila conservando `reserved`, 409 `AVAILABILITY_DUPLICATED` sin escritura y 422 a `reserved`/precio numérico/campos calculados; `schema.prisma` con `UNIQUE(productId, night)` y `Decimal(14,2)`; `bookings.e2e.ts` → noche de salida libre. |
| 6 | Lectura de disponibilidad del panel | Cubierto | `GET /admin/products/:id/availability` con `from`/`to` devuelve `night`, `capacity`, `reserved` y `priceUsd` texto; 404 ajeno con cuerpo indistinguible, 403 agente/Super Admin y 401 anónimo; `catalog-client.test.ts` y el panel consumen el rango. |
| 7 | Precio como texto decimal | Cubierto | Esquemas `strictObject` y cadena decimal 14,2; `products-admin.test.ts` rechaza el `number`; e2e rechaza `totalUsd`, `totalVes`, `exchangeRate` y `reserved` en producto y disponibilidad; persistencia `DECIMAL(14,2)` y serialización con `formatAmount`. |
| 8 | Traducciones es y en | Cubierto | 422 con `title.en`/`description.en` faltantes en alta y edición; fallback público a `es`; 48 claves `catalog.*` presentes en ambos idiomas; `catalog-panel.test.ts` comprueba `t(...)`, `htmlFor`/`id` de los cinco controles y ausencia de `onClick` en `div`. |

## 3. Hallazgos y observaciones

| ID | Severidad | Estado | Detalle |
| --- | --- | --- | --- |
| F1 | Low | Corregido | `scope.md` y `design.md` seguían con 7/7 y 75/61 frente a los 8/8 y 77/63 vigentes. |
| F2 | Low | Corregido | El campo `providerId` era editable al crear como Proveedor, aunque la API rechaza cualquier valor distinto del suyo. Ahora está deshabilitado para ese rol; Admin sí puede elegirlo. |
| F3 | Low | Corregido | El 404 de disponibilidad ajena no comparaba cuerpo con el de un producto inexistente. Ahora ambos comparten el mismo `detail`. |
| F4 | Low | Informativo | Los tests del panel son inspección de código fuente, no interacción DOM/navegador; limitación ya registrada en PAUSAS 1 y 2. No bloquea. |
| F5 | Low | Confirmado | Una corrida adicional y no requerida de tres E2E en paralelo agotó el `beforeAll` de `bookings.e2e.ts` (30 s) por carga. Aislado, el test de la noche de salida pasa. No se aumentó ningún timeout. |

No hay hallazgos Critical, High ni Medium. El riesgo residual es bajo (~10/100).

## 4. Corrección posterior a la verificación

Sin cambiar contratos ni decisiones del SDD, se cerraron las observaciones ejecutables de los informes:

- `apps/api/test/products-admin.e2e.ts` añade el caso combinado «otra agencia con el mismo
  `hotel_key`» y un `PUT` directo del Proveedor sobre ese producto: 404 indistinguible y fila intacta.
- El mismo archivo compara el cuerpo del 404 de disponibilidad ajena con el de un UUID inexistente.
- `apps/admin/src/components/catalog-panel.tsx` deshabilita `providerId` para el rol `provider`;
  `catalog-panel.test.ts` lo afirma como contrato.
- `scope.md` y `design.md` alinean el inventario con 8 escenarios de `catalog`, 77 totales y 63
  obligatorios.

Comprobación tras las correcciones: `products-admin.e2e.ts` + `products-admin.test.ts` → **48/48**;
admin completo → **172/172**; `pnpm lint` y `pnpm typecheck` en verde; el test aislado de la noche de
salida → **1/1**. Las observaciones F4 y F5 quedan documentadas como no bloqueantes.

**Conclusión:** la PAUSA 3 puede cerrarse en verde. Se autoriza continuar con la fase de reportes
(T-F2-22 y T-F2-23).

## 5. Reportes (T-F2-23)

Evidencia del reporte de ventas y del listado de agencias que puebla su filtro:

- `apps/api/test/reports.e2e.ts` → **5/5**: rango inclusivo y agencia permitida, totales calculados en
  el servidor con importes y tasa congelados, desglose por método y estado, alcance por rol y CSV por
  la misma ruta con encabezados es/en. La matriz incluye un admin de agencia (miembro con rol
  `admin`, no Super Admin): recibe **200** con los totales de su agencia y no ve los de otra aunque pida
  `agencyId`; agent, provider y member reciben **403** sin datos, y el Super Admin ve todas.
- `apps/api/test/organizations-admin.e2e.ts` → **3/3**: el Super Admin sin membresías ve todas las
  agencias (`id`, `name`, `slug`, sin secretos ni memberships); owner y admin de agencia con agencia
  activa reciben **403** en `GET /admin/organizations`, porque ese selector es solo de plataforma.
- `apps/api/test/active-membership.e2e.ts` → **2/2** con el inventario sin cambios: la ruta de
  agencias es de plataforma y no consume la agencia activa, así que no pertenece a ese inventario.
- `apps/api/test/reports-csv.test.ts` → **3/3**: el CSV prefija con `'` las celdas que empiezan por
  `=`, `+`, `-` o `@`, mantiene el doble comillas y no altera los valores ordinarios. Corrección
  añadida tras la revisión de T-F2-23, con su THEN en el delta `reports`.
- `apps/admin/test/reports-client.test.ts` y `reports-panel.test.ts` → **16/16**: el selector usa
  `GET /api/v1/admin/organizations`, no las membresías de Better Auth; rechaza respuestas que no sean
  un listado y conserva el `agencyId` elegido en la descarga CSV.
- Suite completa: `pnpm test` → 5/5 tareas y API 59 archivos / 710 tests; `pnpm lint`,
  `pnpm typecheck`, `node scripts/check-specs.mjs` (15 specs) y `openspec validate --all`
  (16 passed, 0 failed) en verde.

Las observaciones F4 y F5 siguen siendo no bloqueantes. `scope.md` queda actualizado en 78 escenarios
y 64 obligatorios tras añadir el scenario de `auth-access`.

## 6. Matriz F1 en la UI (T-F2-24)

Evidencia de los dos escenarios obligatorios de `admin-ui`:

- `apps/admin/src/lib/panel-navigation.ts` centraliza los seis módulos del panel y
  `resolvePanelModules(status, role)` deriva la navegación de la matriz F1: owner y admin ven todo,
  agente ve catálogo/pagos/tasas, proveedor ve catálogo/tasas, `member` no ve ninguno y el Super Admin
  entra en modo plataforma con todos los módulos en solo lectura. El inventario no incluye módulo de
  reservas ni enlace o resumen de reservas.
- `apps/admin/src/components/site-header.tsx` solo pinta los módulos resueltos
  (`PANEL_MODULES.map(navLink)`) con las etiquetas `nav.*` en es/en. Antes ofrecía catálogo, pagos y
  tasas a cualquier sesión, incluido un `member` sin `booking:read`.
- `apps/admin/src/lib/denied-data.ts` clasifica 403 y 404. Catálogo, pagos, tasas, reportes y usuarios
  descartan filas, importes, historial y resúmenes del recurso antes de mostrar el aviso localizado;
  auditoría ya lo hacía con su estado `forbidden`. Las respuestas tardías se descartan con
  `generation.current` en catálogo y pagos.
- `apps/admin/test/panel-navigation.test.ts` → **11/11**: matriz por rol, ausencia de reservas,
  cabecera derivada y limpieza ante 403/404. Falló en rojo antes de crear los dos módulos nuevos.
- Suite de admin → **21 archivos / 200 tests en verde**. Seis tests de pantalla existentes se ajustaron
  a la navegación derivada sin cambiar sus contratos. `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `node scripts/check-specs.mjs` (15 specs) y `openspec validate --all` (16 passed, 0 failed) en verde.
- Observación informativa: el inventario del proveedor sigue limitado por `viewerProviderId` de la API
  (`catalog-client.ts` y `catalog-panel.tsx`), nunca por un id elegido por el cliente. El panel F2 no
  tiene pantalla de reservas; la matriz F1 se materializa ocultando cualquier resumen de reservas,
  como indica `design.md:137-139`.

---

# Verificación final — T-F2-25 y T-F2-26

**Fecha:** 2026-11-26  
**Change:** `f2-admin-rates`  
**Alcance verificado:** cierre de F2 sobre `main` @ `5f7375a`, con los cinco commits pendientes de
push (`7658041`, `047d5ce`, `144c319`, `d54a4d8`, `5f7375a`).  
**Veredicto:** **PASS** — 64/64 escenarios obligatorios y 14/14 deseables con evidencia ejecutable o
contractual; sin hallazgos Critical/High/Medium y riesgo residual bajo.  
**Bloqueos para cerrar F2:** ninguno. Las observaciones de la sección 5 son no bloqueantes.

La verificación la hicieron dos agentes independientes en conversaciones limpias y modo solo lectura:
uno derivó tests por escenario y ejecutó la batería completa; el otro auditó seguridad, secretos,
tenants y rutas sin sesión. Antes de sus informes `git status --short` estaba vacío; ninguno modificó
código, specs, `tasks.md`, dependencias ni historial. Ambos informaron **FAIL** por trazabilidad, no
por el comportamiento: faltaban 19 obligatorios mapeados en este archivo y el delta de `admin-ui`
omitía el escenario base «Idioma persistido». Las correcciones están en la sección 4.

## 1. Comandos ejecutados

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | `eslint .` + Turbo **4/4 successful**, 0 errores. |
| `pnpm typecheck` | Turbo **5/5 successful**, 0 errores. |
| `pnpm test` | Turbo **5/5** en **6m21.62s** (rerun tras C1): API **64 archivos / 734 tests**, admin **23 / 228**, web **19 / 128**, shared **5 / 82**. Total **111 archivos / 1.172 tests**, 0 fallos. Solo warnings esperados del fallback de tasa. |
| `pnpm --filter @caribe/api exec vitest run test/audit-csv.e2e.ts test/reports.e2e.ts` | **2 archivos / 9 tests en verde** tras C1; antes de C1, **1 archivo / 4 tests** tras la limpieza del e2e. |
| `node scripts/check-specs.mjs` | `OK: 15 specs válidas`. |
| `pnpm exec openspec validate --all` | Tras corregir el delta: `Totals: 16 passed, 0 failed (16 items)`. Los warnings de requisitos largos son preexistentes y no bloquean. |
| Inventario sin sesión: `two-factor.e2e.ts`, `active-membership.e2e.ts`, `admin-route.test.ts`, `api-errors.e2e.ts` | **4 archivos / 52 tests en verde**. |
| Foco deseables: 4 archivos de API, 9 de admin y 1 de shared | **22 + 131 + 7 tests en verde**, respectivamente. |

Los recuentos se listan como evidencia de cada ejecución, no para sumarlos. No se añadieron `any`
nuevos ni `@ts-ignore`: las únicas coincidencias en los archivos tocados son `expect.any(Object)` en
`payments-client.test.ts` y una mención literal en `design.md:242`.

## 2. T-F2-25 — 14 deseables

| # | Escenario | Evidencia |
| --- | --- | --- |
| 1 | Tasa global del Super Admin | `f2-exchange-rates.e2e.ts` → *"tasa global del Super Admin: tenant NULL sin revelar la de las agencias"*; `rates-client.test.ts` → *"fija la tasa global con la ruta de plataforma"*. |
| 2 | Fecha valor futura | `f2-exchange-rates.e2e.ts` → *"fecha valor futura: se anuncia como pendiente sin aplicarse como vigente"*; `rates-client.test.ts` → *"conserva el pendiente sin aplicarlo"*. |
| 3 | Historial de overrides | `rates-client.test.ts` → filtra por `exchange-rate.override`, ordena por fecha valor y deja historial vacío en 403; `rates-panel.test.ts` → actor, motivo y antes→después. Sin e2e HTTP específico del historial (obs. O2). |
| 4 | Exportación CSV de pagos | `payments-csv.e2e.ts` → *"aplica los mismos filtros, límite y cursor que el JSON"*, *"no mezcla agencias ni expone tenant, tarjeta o CVV"* y *"localiza encabezados con lang y rechaza parámetros no previstos"*; `payments-csv.test.ts` → celdas, idiomas y vacío. |
| 5 | Columnas configurables | `payments-client.test.ts` → `parsePaymentColumns` fila duplicados/claves prohibidas y `storePaymentColumns`/`loadPaymentColumns` persisten en `localStorage`; `payments-panel.test.ts` → *"exporta CSV y configura columnas sin alterar filtros ni ámbito"*. La interacción de UI es inspección de código (obs. O1). |
| 6 | Estado vacío | `payments-panel.test.ts` → *"da etiqueta y foco al estado vacío y al error de agencia"* y `it.each` de claves es/en. Confirmación estática del render/foco (obs. O1). |
| 7 | Estado de error | `payments-client.test.ts` → códigos 401/2FA/403/409/410/422/`ACTIVE_ORGANIZATION_REQUIRED`; `payments-panel.test.ts` → *"da etiqueta y foco..."*. El 404 cae a `genericError`, sin inventar un modo (obs. O1). |
| 8 | Auditoría del override de tasa | `f2-audit-actions.e2e.ts` → *"Auditoría del override de tasa"*; `audit.e2e.ts` → fila con actor, antes/después, IP y fecha. |
| 9 | Auditoría de la revisión de pagos | `f2-audit-actions.e2e.ts` → aprobación, rechazo y *"si falla la auditoría se revierte la revisión del pago"*; `payments.e2e.ts` → transacción compartida. |
| 10 | Auditoría del cambio de rol | `f2-audit-actions.e2e.ts` → *"Auditoría del cambio de rol"* con audit y par `attempt`/`result` con el mismo `correlation_id`. |
| 11 | Exportación CSV de auditoría | `audit-csv.e2e.ts` → filtros/cursor, alcance por rol, encabezados y estados es/en sin secretos, y escape de fórmulas; `audit-client.test.ts` y `audit-panel.test.ts` → descarga y control accesible. |
| 12 | Selector de agencia en la cabecera | `panel-access.test.ts` → una, varias y cero membresías, plataforma y `set-active` real; `admin-ui-selectors.test.ts` → cabecera, `set-active` y recarga completa. Interacción de UI estática (obs. O1). |
| 13 | Bandera del modo de aprobación | `tenant-settings-client.test.ts` → lee `AUTO`/`MANUAL` con la sesión y falla cerrado en 403 o modo desconocido; `admin-ui-selectors.test.ts` y `payments-panel.test.ts` → bandera y gating solo en `MANUAL`. |
| 14 | Idioma persistido en perfil y cookie | `shared.test.ts` → `preferredLocale`, `replacePathLocale` y `updateUserLocale` por `/api/auth/update-user`; `tenant-settings.e2e.ts` → el perfil cambia a `en` por la ruta self-service; `admin-ui-selectors.test.ts` → escritura antes de navegar, login y 2FA. Sin test DOM de recarga (obs. O1). |

## 3. T-F2-26 — matriz de los 64 obligatorios

| # | Spec · escenario | Evidencia |
| --- | --- | --- |
| 1 | api-errors · Límite excedido | `security.e2e.ts` → *"Rate limit por IP real"*; `business-rate-limit.e2e.ts` → 3 límites con `code = RATE_LIMITED`. |
| 2 | exchange-rates · Ver tasa vigente | PAUSA 1 §2 fila 1; `f2-exchange-rates.e2e.ts`, `rates-client.test.ts`. |
| 3 | exchange-rates · Override con motivo | PAUSA 1 §2 fila 2; `f2-exchange-rates.e2e.ts`, `rates-panel.test.ts`. |
| 4 | exchange-rates · Sin segundo factor | PAUSA 1 §2 fila 3; `f2-exchange-rates.e2e.ts`, `rates-client.test.ts`. |
| 5 | exchange-rates · Sin permiso de tasa | PAUSA 1 §2 fila 4; `f2-exchange-rates.e2e.ts` y matriz `access.ts`. |
| 6 | exchange-rates · Confirmación antes/después | PAUSA 1 §2 fila 7; `rates-panel.test.ts` → modal explícito. |
| 7 | exchange-rates · Override de otra agencia | PAUSA 1 §2 fila 8; equivalente aprobado sin ruta por id. |
| 8 | exchange-rates · Auditoría del override | PAUSA 1 §2 fila 9; `audit.e2e.ts`. |
| 9 | exchange-rates · Campos calculados del cliente | PAUSA 1 §2 fila 6; `f2-exchange-rates.e2e.ts` → 422. |
| 10 | exchange-rates · Membresía revocada | PAUSA 1 §2 fila 5; `f2-exchange-rates.e2e.ts` → `ACTIVE_ORGANIZATION_REQUIRED`. |
| 11 | payments · Listado filtrable | PAUSA 2 §2 fila 1; `payments.e2e.ts`, `payments-client.test.ts`, `payments-panel.test.ts`. |
| 12 | payments · Aprobar con TOTP | PAUSA 2 §2 fila 2; `payments.e2e.ts`, `two-factor.e2e.ts`. |
| 13 | payments · Rechazo con motivo | PAUSA 2 §2 fila 3; `payments.e2e.ts`, `payments-client.test.ts`. |
| 14 | payments · Revisor distinto del pagador | PAUSA 2 §2 fila 4; `canReviewPayment` y botones deshabilitados. |
| 15 | payments · Par congelado solo lectura | PAUSA 2 §2 fila 5; esquemas `strictObject` y texto decimal del servidor. |
| 16 | payments · Revisión concurrente | PAUSA 2 §2 fila 6; `PAYMENT_ALREADY_REVIEWED`/`INVALID_STATE_TRANSITION`. |
| 17 | payments · Sin permiso de lectura | PAUSA 2 §2 fila 7; `payments.guard.ts` y matriz de roles. |
| 18 | payments · Pago de otra agencia | PAUSA 2 §2 fila 8; `payments.service.ts` acota `tenantId`. |
| 19 | audit · Filtros y cursor | `f2-audit.e2e.ts` → *"filtra por acción, entidad, actor y rango y recorre el cursor sin duplicados ni huecos"*; `audit-panel.test.ts` → pila de páginas. |
| 20 | audit · Pestaña de eventos de autenticación | `auth-events.e2e.ts` → alcance por agencia, plataforma, filtros por ruta/`outcome` y cursor. |
| 21 | audit · Alcance del admin de agencia | `f2-audit.e2e.ts` → *"el admin de agencia ve solo su tenant; agente y member reciben 403"*; `audit.e2e.ts`. |
| 22 | audit · Modo plataforma del Super Admin | `f2-audit.e2e.ts` → *"el Super Admin lee plataforma y todas las agencias en modo lectura"*; `audit.e2e.ts` → inmutabilidad. |
| 23 | audit · Sin permiso de auditoría | `f2-audit.e2e.ts` → 403 a agente y member; `audit-panel.test.ts` → sin resumen ni enlaces. |
| 24 | audit · Sin secretos ni mensajes internos | `f2-audit.e2e.ts` → *"no expone secretos aunque la fila los contuviera antes de redactarse"*; `audit.e2e.ts` → *"record redacta claves sensibles"*. |
| 25 | catalog · Alta de producto | PAUSA 3 §2 fila 1; `products-admin.e2e.ts`, `catalog-client.test.ts`. |
| 26 | catalog · Edición de la agencia | PAUSA 3 §2 fila 2; esquemas `strictObject`. |
| 27 | catalog · Proveedor edita solo sus productos | PAUSA 3 §2 fila 3; 404 indistinguible y `hotelScope` por `providerId`. |
| 28 | catalog · Publicar y archivar | PAUSA 3 §2 fila 4; republicar y visibilidad pública. |
| 29 | catalog · Disponibilidad por noche | PAUSA 3 §2 fila 5; `UNIQUE(productId, night)` y bloqueo de cupo. |
| 30 | catalog · Lectura de disponibilidad del panel | PAUSA 3 §2 fila 6; `GET /admin/products/:id/availability`. |
| 31 | catalog · Precio como texto decimal | PAUSA 3 §2 fila 7; `DECIMAL(14,2)`. |
| 32 | catalog · Traducciones es y en | PAUSA 3 §2 fila 8; 422 si falta `en` y fallback público. |
| 33 | auth-access · Invitar miembro con 2FA | `two-factor.e2e.ts` → sin TOTP 403 antes de validar; `auth.e2e.ts` → invitación 200; `audit.e2e.ts` → fila y evento con `correlation_id`. |
| 34 | auth-access · Cambiar rol | `f2-audit-actions.e2e.ts` → *"Auditoría del cambio de rol"*; `two-factor.e2e.ts` → ruta existente y 403 sin TOTP. |
| 35 | auth-access · Revocar sesión desde el panel | `auth.e2e.ts` → *"super admin revoca la sesión... 401 a la víctima"*; `users-panel.test.ts` → la agencia no ofrece la acción. |
| 36 | auth-access · Organización objetivo ajena | `auth.e2e.ts` → *"una sesión no accede a la organización de otra agencia"*; `two-factor.e2e.ts` → rechazo con `organizationId` ajeno sin filas en B. |
| 37 | auth-access · Super Admin en modo plataforma | `panel-access.test.ts` → *"entra en modo plataforma aunque el Super Admin tenga membresías"*; `organizations-admin.e2e.ts` y `f2-audit.e2e.ts`. |
| 38 | auth-access · Operación sin agencia activa | `tenant-settings.e2e.ts` → `ACTIVE_ORGANIZATION_REQUIRED`; `two-factor.e2e.ts` → fallo cerrado; `panel-access.test.ts` → selector/estado vacío. |
| 39 | auth-access · Listado de agencias para el filtro | `organizations-admin.e2e.ts` → 3 tests (Super Admin ve `id`/`name`/`slug`; owner y admin 403); `reports-panel.test.ts` → selector y CSV con el mismo `agencyId`. |
| 40 | admin-ui · Tokens Caribe | `visual-identity.test.ts` → *"ConfigProvider aplica la paleta exacta"* y *"no quedan colores genéricos"*. |
| 41 | admin-ui · Tipografía compartida | `visual-identity.test.ts` → fuentes en un único paquete y cargadas por ambas apps. |
| 42 | admin-ui · Cabecera del panel | `visual-identity.test.ts` → *"Cabecera del panel: marca, navegación, idioma y sesión desde mensajes"*; `panel-navigation.test.ts`. |
| 43 | admin-ui · Textos es y en | `accessibility.test.ts` → *"no hay cadenas visibles fijas en los componentes"*; `messages.test.ts` → paridad de claves. |
| 44 | admin-ui · Accesibilidad básica | `accessibility.test.ts` → foco visible, controles etiquetados, tablas con encabezados y avisos con tipo. |
| 45 | admin-ui · Matriz F1 en la UI | Verificación §6; `panel-navigation.test.ts` → 11 tests, sin módulo de reservas. |
| 46 | admin-ui · Sin datos negados por la API | Verificación §6; `denied-data.ts` descarta filas/importes ante 403/404. |
| 47 | reports · Reporte por rango de fechas | T-F2-23 §5; `reports.e2e.ts` → rango inclusivo y CSV por la misma ruta. |
| 48 | reports · Totales calculados en el servidor | T-F2-23 §5; importes y tasa congelados, `DECIMAL`. |
| 49 | reports · Desglose por método y estado | T-F2-23 §5; `reports.e2e.ts`. |
| 50 | reports · Alcance por rol | T-F2-23 §5; owner/admin solo su agencia, Super Admin todas, roles sin permiso 403. |
| 51 | reports · Exportación CSV del reporte | T-F2-23 §5; `reports-csv.test.ts` → prefijo `'` para fórmulas (también con espacios/BOM iniciales) y encabezados es/en. |
| 52 | security · IP tras proxy de confianza | PAUSA 1 §3; `security.e2e.ts`, `client-ip.test.ts`. |
| 53 | security · Cabecera de proxy no confiable | PAUSA 1 §3; `security.e2e.ts` → *"Cabecera de proxy no confiable"*. |
| 54 | security · Rate limit por IP real | PAUSA 1 §3; `security.e2e.ts` → *"Rate limit por IP real"*. |
| 55 | security · Cabeceras de seguridad | PAUSA 1 §3; `security.e2e.ts` → *"Cabeceras de seguridad en la API"*. |
| 56 | security · CSP sin scripts inline | PAUSA 1 §3; `csp.test.ts` → nonce por petición y sin `unsafe-inline`. |
| 57 | security · CORS con orígenes permitidos | PAUSA 1 §3; `security.e2e.ts`. |
| 58 | security · CORS con origen desconocido | PAUSA 1 §3; `security.e2e.ts`. |
| 59 | security · Límite en creación de reservas | `business-rate-limit.e2e.ts` → *"Límite en creación de reservas"*. |
| 60 | security · Límite en alta y revisión de pagos | `business-rate-limit.e2e.ts` → *"Límite en alta y revisión de pagos"*. |
| 61 | security · Límite en descargas | `business-rate-limit.e2e.ts` → *"Límite de descargas"*. |
| 62 | security · Reembolso idempotente | `refund-idempotency.e2e.ts` → `refundId` y una sola escritura. |
| 63 | security · Rollback sin reembolso externo | `refund-idempotency.e2e.ts`. |
| 64 | security · Reconciliación de reembolsos | `refund-idempotency.e2e.ts` → fila pendiente y reconciliación, sin secretos. |

## 4. Correcciones tras los informes independientes

1. **H1 (auditoría, bloqueante de cierre):** este archivo no mapeada 19 obligatorios. La sección 3
   añade la matriz completa de 64 y la sección 1 registra la batería consolidada posterior a los cinco
   commits.
2. **V1 (verificación de tests, bloqueante de DoD):** `openspec validate --all` fallaba porque el delta
   `admin-ui` omitía el escenario base «Idioma persistido». Se copió al bloque `MODIFIED` con el mismo
   nombre y se actualizó para reflejar perfil + cookie. Ahora: **16 passed, 0 failed**.
3. **I1 (limpieza):** `audit-csv.e2e.ts` elimina las organizaciones y los usuarios creados en `afterAll`,
   igual que `payments-csv.e2e.ts`. Reejecutado: **4/4**.
4. **I3 (errata):** `scope.md` decía 75 escenarios en el encabezado; ahora dice 78, coherente con el
   total vigente de 64 obligatorios y 14 deseables.
5. **C1 (estabilidad de e2e tras el push):** `CI` (`45926839481`) y `web-checks` (`45926839424`)
   fallaron en `Tests` por `audit-csv.e2e.ts`: al ejecutar la suite completa, otras suites escriben
   auditorías con `at` en el presente y desplazaban las filas del fixture fuera de la primera página.
   Acotar el rango temporal no bastó porque la evaluación de módulos retrasa `baseTime`. El fixture
   usa ahora una acción única por corrida (`csv.test.<suffix>`) y todas sus consultas filtran por
   esa acción; la fila de fórmula usa `=SUM(1+1)-<suffix)` y se consulta por su propia acción.
   `reports.e2e.ts` tenía el mismo riesgo en la vista de plataforma: ahora los totales exactos se
   comprueban con `agencyId` (agencias del fixture) y la vista sin filtrar solo exige que incluya
   ambas. Reejecutado: **2 archivos / 9 tests en verde**; sin cambios de comportamiento ni de specs.

## 5. Observaciones no bloqueantes

- **O1 — UI estática:** varios tests de panel inspeccionan el código fuente en vez de montar el DOM
  (estado vacío/error, columnas, selector, bandera e idioma). Las funciones puras y los clientes sí
  tienen tests ejecutables. Es la limitación ya aceptada en las PAUSAS 1-3 (F4/L2); no se añadió una
  dependencia de testing de componentes sin justificarlo en `design.md`.
- **O2 — Historial de overrides:** cubierto por tests unitarios del cliente y del panel, sin un e2e HTTP
  específico. La API reutiliza `GET /admin/audit-logs`, ya protegido y cubierto por `f2-audit.e2e.ts`;
  no se creó una ruta nueva.
- **O3 — CSV (cerrado tras el cierre de F2):** `csvCell` neutraliza celdas cuyo primer carácter no
  blanco ni BOM es `=`, `+`, `-` o `@`, y conserva los espacios/BOM iniciales en el valor escrito. La
  limitación original (solo la primera posición) se endureció con test en rojo → verde y el delta
  `reports` recoge el contrato; ya no depende de que las columnas actuales sean UUID, enumeraciones,
  fechas, IP validada o estados traducidos.
- **O4 — CSV sin cookie:** no hay una llamada explícita a `?format=csv` sin sesión. El guard actúa por
  ruta, no por query, y los 52 tests del inventario cubren las dos rutas existentes; los cinco commits
  no añadieron ningún controlador ni decorador de ruta.
- **O5 — preguntas abiertas previas:** siguen pendientes de decisión del dueño los rangos/direcciones de
  `TRUSTED_PROXIES`, el valor de `TRUSTED_ORIGINS` y las observaciones F4/F5 del catálogo. Ninguna
  bloquea F2 ni fue introducida por T-F2-25/T-F2-26.

**Conclusión:** F2 puede cerrarse. Todos los escenarios obligatorios del `scope.md` están trazados, los
14 deseables tienen evidencia, la suite completa está en verde y no hay deuda de seguridad Critical,
High o Medium.
