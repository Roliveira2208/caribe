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
