# Plan: f1-hotels-e2e

Fecha: 2026-11-11 · Estado: **modo plan, sin tocar código** · Fase F1 del ROADMAP.
Este documento no reemplaza `proposal.md`, `design.md` ni `tasks.md`: los revisa, fija supuestos y
lista lo que falta por decidir antes de implementar.

## 1. Estado encontrado

- La change tiene `proposal.md`, `design.md` y `tasks.md`, pero **no tiene specs delta** en
  `openspec/changes/f1-hotels-e2e/specs/`. Las specs base cubren el camino feliz; el comportamiento
  nuevo de F1 (organización activa, intentos de auditoría, catálogo público entre agencias,
  resolución de tenant para un cliente sin membresía, contexto de trabajos de fondo, etc.) no está
  especificado. Por `docs/workflow.md`, eso es el primer artefacto que hay que escribir.
- Código: F0 archivada. Existen `TenantModule` (solo contextos `tenant` y `platform`), `AuditModule`
  (interceptor + hooks de Better Auth), stubs `TODO(F1)` de `products` y `bookings`, y el shell de
  web/admin con login y TOTP. No existen módulos de catálogo, reservas, pagos, tasas, documentos ni
  notificaciones.
- Esquema: solo tablas de Better Auth + `audit_logs`. Faltan todas las tablas de F1 y los ajustes de
  tenant (`payment_mode`, `hold_minutes`, `base_currency`, razón social/RIF); `user` no tiene
  `locale`.
- Dependencias: `zod` ya está en `packages/shared`; **no** hay cliente Redis/BullMQ, SMTP, PDF ni QR.
  La API no tiene pipe de validación Zod ni contrato de errores Problem Details.
- `docs/plans/inventory-hardening-f0.md` es un análisis correcto y completo; sus 7 mejoras se
  trasladan tal cual a T-F1-0. Estoy de acuerdo en que T-F1-0 va primero.

## 2. Supuestos que aplicaré (avísame si cambias alguno)

| # | Tema | Supuesto |
| --- | --- | --- |
| S1 | Orden | T-F1-0 primero. No cambia comportamiento: endurece tests y clasificación. La spec delta del comportamiento nuevo va antes de su código. |
| S2 | Auditoría de intentos | `audit_logs` es inmutable (solo INSERT/SELECT + trigger), así que un intento no se puede "actualizar" con el resultado. Se usan **dos filas append-only** (intento y resultado) con un `correlation_id`, o una tabla `auth_events` aparte (decisión Q5). |
| S3 | Organización activa | Es UX del panel, no un control de seguridad. La API sigue fallando cerrada: sin agencia activa, las operaciones de agencia dan 403. |
| S4 | Tenant del cliente | El cliente sin membresía no tiene `activeOrganizationId`. El servidor resuelve el tenant desde el producto al crear y aplica una comprobación de propiedad explícita al leer. El catálogo público usa un contexto RLS `public` (solo `PUBLISHED` y no borrado); el personal de agencia usa `tenant`; los jobs usan `system`. |
| S5 | Dinero | Todo cálculo con `Prisma.Decimal` (decimal.js), nunca `number`. En JSON, montos y tasas se serializan como **strings**. Redondeo VES: `ROUND_HALF_UP` a 2 decimales. |
| S6 | Disponibilidad | `availability` es un cubo por rango (`starts_on`/`ends_on`) con `capacity`/`reserved`; `quantity` son habitaciones; el total es `price_usd × quantity` (sin multiplicar por noches) salvo que Q9 diga otra cosa. |
| S7 | Ajustes de tenant | `hold_minutes`, `payment_mode`, `base_currency`, razón social y RIF viven en una tabla `tenant_settings` propia, no en `organization` (modelo generado por Better Auth). Default de retención: 30 min. |
| S8 | Tasas | Filas globales de BCV con `tenant_id NULL` + overrides por tenant en la misma tabla, con política RLS específica (Q14). |
| S9 | Documentos | PDF en disco local bajo un directorio configurable, servido por una ruta autenticada; `file_url` guarda la ruta relativa. Sin URL pública. |
| S10 | Dependencias | Se añadirán, justificadas en `design.md`: `bullmq` + `ioredis` (jobs/caché), `nodemailer` (SMTP), una librería PDF (`pdfkit` o `pdf-lib`) y `qrcode`. Pines exactos y revisión de `pnpm-workspace.yaml` tras instalar. |
| S11 | Demo | F1 se demuestra en local. Una demo pública exige antes M1 (`trustedProxies`) y M2 (Helmet/CSP/CORS). |
| S12 | Tests | e2e con PostgreSQL y Redis reales (CI ya los tiene); DolarAPI y SMTP se sustituyen por dobles; ningún test llama a red externa. |
| S13 | Wireframes | Un SVG de baja fidelidad por pantalla, **justo antes** de construirla, aprobado por el dueño. Los SVG de F0 quedan como referencia y se actualizan si la pantalla cambia. |

## 3. Dudas que bloquean o condicionan el diseño

### Decisiones del dueño (2026-11-11)

- **T-F1-0**: arrancar ya, con tests primero y un commit por tarea.
- **Q5 (intentos de auditoría)**: tabla `auth_events` separada; `audit_logs` conserva su semántica
  actual (acción sensible con antes/después).
- **Q1 (catálogo público)**: GUC `app.public='on'` + política `status='PUBLISHED' AND deleted_at IS NULL`.

Las demás preguntas de este apartado siguen abiertas.

### A. Tenant y RLS (bloquea T-F1-1)

1. **Catálogo público entre agencias.** Un usuario anónimo debe ver productos de todas las agencias,
   pero RLS filtra por `app.tenant_id` y sin sesión el contexto es `none` (no ve nada). Opciones:
   (a) GUC `app.public='on'` + política `status='PUBLISHED' AND deleted_at IS NULL`; (b) rol de BD
   `caribe_public` separado; (c) modelo de lectura en Redis. **Recomiendo (a)**: menos invasivo y
   mantiene RLS con tests. ¿Lo apruebas?
2. **Cliente sin membresía.** ¿Cómo resuelve el tenant para crear/leer/pagar/descargar? Opciones:
   (a) resolver el tenant desde el producto al crear y, para leer, una función `SECURITY DEFINER`
   `booking_tenant(id)` + `withTenant` + comprobación de propiedad; (b) GUC `app.user_id` + política
   de propiedad en `bookings`, `payments` y `documents`; (c) contexto `client` que solo lee filas con
   `user_id = app.user_id`. **Recomiendo (b)/(c) para lecturas y (a) solo para crear.** Además:
   ¿un cliente puede tener reservas en varias agencias? Si sí, "Mis reservas" exige lectura
   cross-tenant por propietario.
3. **Jobs de fondo y RLS.** Expiración, refresco de tasa, PDF y correo necesitan leer/escribir sin
   sesión. `app.platform` es el contexto del Super Admin; usarlo para jobs mezcla privilegios.
   Opciones: (a) GUC `app.system='on'` + políticas estrechas por tabla; (b) rol `caribe_jobs` con
   BYPASSRLS (no recomendado); (c) iterar agencias con `withTenant` (correcto pero más consultas).
   **Recomiendo (a)**, con una política que no permita leer `audit_logs`.

### B. Auditoría de intentos (bloquea la tarea nueva)

4. **Alcance.** ¿Solo las 22 rutas administrativas de Better Auth? ¿Todas las `/api/auth/*`
   (incluidos fallos de login)? ¿Solo escrituras? **Recomiendo escrituras administrativas + fallos de
   TOTP**, no login: el rate limit corre antes de los hooks y los fallos de credenciales merecen una
   spec de eventos de autenticación aparte.
5. **Almacenamiento.** ¿Dos filas en `audit_logs` con `correlation_id`, `phase` (`attempt`/`result`) y
   `outcome` (`success`/`error`), o una tabla `auth_events` separada? **Recomiendo `auth_events`** si
   no queremos ensuciar la semántica de `audit_logs` (que hoy es "acción sensible con antes/después");
   dos filas en `audit_logs` es aceptable si el panel filtra intentos. Tu decisión.
6. **Fallo al escribir el intento.** ¿Falla cerrada (bloquea la acción) o best-effort (log y sigue)?
   **Recomiendo falla cerrada en escrituras administrativas**, coherente con el interceptor de Nest.
   Consecuencia: `audit_logs` pasa a ser dependencia dura del panel.
7. **Imputación de un intento sin agencia determinable** (`cancel-invitation`, `create`): ¿`tenant_id`
   NULL (plataforma) o la agencia activa? **Recomiendo NULL + `app.platform`**, visible solo para
   Super Admin; la fila de resultado se imputa a la agencia de la entidad devuelta.
8. **Forma del error estructurado.** Propongo `{ outcome: "error", error: { code, status, name } }`,
   sin mensaje libre (o mensaje saneado). Además, verificado en `better-auth@1.7.18`
   (`dist/api/dispatch.mjs`): si un hook `before` lanza, **`after` no corre**. El fallo de TOTP debe
   escribir su fila de resultado dentro del `catch` del `before`, no confiar en el `after`.

### C. Reservas y dinero (bloquea T-F1-7/T-F1-9)

9. **Semántica de disponibilidad.** ¿`capacity` es por rango o por noche? ¿`quantity` son habitaciones
   o personas? ¿El total es `price_usd × quantity` o `× noches × habitaciones`? Los escenarios de la
   spec implican un contador por rango; sin regla explícita, el total y la prueba de concurrencia
   quedan indefinidos.
10. **`Idempotency-Key`.** ¿Alcance (usuario + endpoint + clave)? ¿Cuerpo distinto → 409
    `IDEMPOTENCY_KEY_REUSED`? ¿Duplicado en vuelo → 409/425? ¿TTL y limpieza? **Recomiendo** tabla
    `idempotency_keys(user_id, endpoint, key, request_hash, response_status, response_body, expires_at)`
    con único por `(user_id, endpoint, key)`, sin `tenant_id` (el tenant se resuelve después).
11. **Orden de locks y carrera pago/expiración.** Propongo: bloquear siempre `bookings` primero y
    `availability` después; revalidar estado y `expires_at` dentro de la transacción; la expiración
    omite reservas con pago `IN_REVIEW` o `APPROVED`; pagar una `EXPIRED` → 410. Confirmar y llevar a
    la spec.
12. **Matemática del reembolso.** ¿`refund_ves = round(refund_usd × tasa_congelada, 2)` o
    `round(amount_ves_original × pct, 2)`? Pueden diferir un céntimo. **Recomiendo la primera** y
    guardar ambos importes.
13. **Precedencia de tasa/override.** ¿Una fila por `value_date`? ¿El override sustituye a BCV para
    esa fecha? ¿Qué pasa si BCV publica después? **Recomiendo** único `(tenant_id, value_date)` con el
    override ganando y sin ser sobrescrito por el proveedor.
14. **Tenant de `exchange_rates`.** El SDD omite `tenant_id`, pero AGENTS exige `tenant_id` en toda
    tabla de negocio. **Recomiendo** filas globales con `tenant_id NULL` (política de lectura) +
    overrides con `tenant_id`; RLS debe permitir leer las globales sin abrir el resto.
15. **Pagos sin columnas de revisor.** El SDD no incluye `reported_by`, `reviewed_by`, `reviewed_at`,
    `rejection_reason`, `refund_amount_usd/ves`, `refunded_at` ni `created_at`. Sin `reported_by` no se
    puede cumplir "nadie aprueba su propio pago". ¿Se añaden? ¿Un reembolso parcial deja el pago en
    `REFUNDED` con importes o hace falta `PARTIALLY_REFUNDED`?
16. **Métodos de pago.** Campos obligatorios por método (Pago Móvil: banco/teléfono/referencia; Zelle:
    nombre o correo + confirmación; Binance: id de orden; tarjeta: últimos 4 + marca) y alcance del
    duplicado (¿`tenant_id` + método + referencia?). **Recomiendo** esquemas Zod en shared y único por
    `(tenant_id, method, reference)`.
17. **Política de cancelación.** ¿Forma de `rules` y regla de selección? **Recomiendo**
    `[{ hours_before, percentage }]`, elegir la primera regla cuyo `hours_before` cubra el tiempo
    restante hasta el check-in; `policy_snapshot` guarda la regla elegida y la política completa.
18. **Datos del viajero.** El voucher pide "datos del viajero". ¿Basta la cuenta (nombre/email) o hace
    falta `booking_travelers` (nombre, documento, teléfono)? El checkout del SDD dice "Datos del
    viajero". **Recomiendo** tabla o JSONB en la reserva.
19. **Código de reserva.** ¿Formato y unicidad (por tenant o global)? **Recomiendo** global para que el
    QR resuelva sin conocer la agencia.

### D. Catálogo (bloquea T-F1-1/T-F1-3)

20. **Atributos de hotel.** La spec solo exige `stars`; la búsqueda por "personas" necesita
    `maxGuests`; las imágenes necesitan tabla o JSONB. **Recomiendo** Zod con `stars`, `maxGuests`,
    `amenities`, `images` (máx. 10) y, si hay tabla, orden + alt i18n.
21. **Búsqueda y cursor.** ¿Filtrar por nombre de destino (JSONB i18n) o por id? ¿Cursor opaco base64
    de `(sort_key, id)`? ¿Orden por precio/fecha? **Recomiendo** `destinationId` + `q` opcional sobre
    el título i18n, cursor opaco y orden explícito.
22. **Disponibilidad suficiente.** ¿Personas o habitaciones? Con cubos por rango, un producto está
    disponible si `reserved + quantity <= capacity` en el rango que cubre las fechas.
23. **Estados y borrado lógico.** ¿`DRAFT`, `PUBLISHED`, `ARCHIVED`? ¿`deleted_at`? La política
    pública debe ser `PUBLISHED` y no borrado.
24. **Imágenes.** ¿Tabla `product_images` o `attributes.images`? La tabla da orden/alt i18n pero suma
    migración.

### E. Documentos, notificaciones y API (bloquea T-F1-11/T-F1-12)

25. **Almacenamiento y acceso a PDF.** ¿Disco local + ruta autenticada (recomendado) o S3/Blob?
    ¿`file_url` es ruta relativa o URL firmada?
26. **Librería PDF y QR.** ¿`pdfkit` + `qrcode` (recomendado, maduros y sin navegador) o `pdf-lib`?
    Justificar en `design.md`.
27. **Numeración.** Propongo `document_counters(tenant_id, type, next_value)` con
    `UPDATE ... RETURNING` en la transacción y único `(tenant_id, type, number)`. Además, único por
    reserva/pago para que un reintento no emita dos números.
28. **Correo.** ¿Qué eventos? (confirmación, pago aprobado/rechazado, cancelación/reembolso). ¿Plantillas
    es/en? Falta `user.locale`. **Recomiendo** confirmación + pago aprobado/rechazado en F1 y añadir
    `locale` por `additionalFields` de Better Auth o tabla `user_settings`.
29. **Errores de API.** No existe spec de Problem Details (RFC 9457) con códigos estables, aunque el
    SDD §7 lo exige. **Recomiendo** spec nueva `api-errors` y montos como strings.
30. **OpenAPI/Swagger.** ¿Entra en F1 o se difiere a F5? El SDD lo pide; no hay tarea. **Recomiendo**
    diferirlo a F5 salvo que lo quieras ya.

### F. Organización activa y panel

31. **Dónde vive el selector.** ¿Solo `apps/admin`? ¿Qué ve un usuario con 0 membresías? ¿Y un Super
    Admin sin agencia? **Recomiendo**: login de admin → consultar membresías; 1 → `set-active` +
    panel; >1 → pantalla selectora; 0 → mensaje y enlace a la web; Super Admin → modo plataforma sin
    agencia activa.
32. **Persistencia.** `set-active` es por sesión; cada login repite la selección. ¿Aceptable?
33. **Pantalla mínima de aprobación de pagos.** La propuesta la menciona, pero no hay tarea. ¿Alcance
    F1: listar `IN_REVIEW`, aprobar/rechazar con motivo, wireframe previo, Ant Design? ¿Sin filtros ni
    reportes hasta F2?

### G. Verificación

34. **Playwright y k6 en CI.** ¿Job aparte (navegador + binario k6) o ejecución local antes de la
    puerta? **Recomiendo** job de Playwright (solo Chromium) y k6 manual documentado en F1.
35. **Accesibilidad.** ¿Playwright + `@axe-core/playwright` en reserva y pago? **Recomiendo** sí.
36. **Seed.** ¿Actualizo `pnpm db:seed` con hotel, disponibilidad, política, tasa y `payment_mode`?
    Es necesario para la demo y la QA manual.

## 4. Reglas que veo incompletas (specs)

| Spec | Falta | Impacto |
| --- | --- | --- |
| `catalog` | Lectura pública cross-tenant; atributos de hotel además de `stars`; imágenes; estados y borrado lógico; semántica de `availability`; precio que usa la reserva; formato de cursor; búsqueda i18n | T-F1-1/T-F1-3 |
| `booking` | Tenant del cliente sin membresía; orden de locks; carrera pago/expiración; semántica de `Idempotency-Key`; origen de `hold_minutes`; datos del viajero; código de reserva; cancelar `PENDING_PAYMENT`; auditoría de crear/expirar | T-F1-7/T-F1-8/T-F1-10 |
| `exchange-rates` | Tenancy y precedencia de override; caché 1 h vs refresco diario; modo de redondeo explícito; matemática del reembolso; parseo/timeout/reintento/circuit breaker del proveedor; zona horaria de `value_date` | T-F1-5/T-F1-6/T-F1-10 |
| `payments` | `reported_by`/`reviewed_by`; máquina de estados completa (uso de `PENDING`); reembolsos (tabla/importes); estado tras reembolso parcial; campos por método; alcance del duplicado; tarjeta (últimos 4 + marca); códigos de pago sobre reserva `CONFIRMED`/`EXPIRED`/`CANCELLED` | T-F1-9/T-F1-10 |
| `documents` | `tenant_id`; almacenamiento; tabla de contadores; idempotencia por reserva/pago; nota de reembolso; idioma del PDF; destino del QR; autorización de descarga; firma de `InvoiceProvider` (`issue(booking, payment)` vs `issue(booking)`) | T-F1-11 |
| `audit` | Intento/resultado; error estructurado; alcance; imputación RLS; allowlist de payload en acciones críticas; auditoría de jobs; filtro de intentos en la lectura | Tarea nueva |
| `auth-access` | Organización activa; tenant del cliente; permiso de creación de reserva/pago (cliente vs agente); revisor distinto; Super Admin de solo lectura; 0 membresías | T-F1-0b/T-F1-9b |
| — | **No existe spec `notifications`** y T-F1-12 no tiene contrato | T-F1-12 |
| — | **No existe spec `api-errors`** (Problem Details + códigos) | T-F1-0d |
| — | **No hay spec de contextos RLS** (`public`, `tenant`, `platform`, `system`, `client-owner`) ni qué tablas puede leer/escribir cada uno | T-F1-1 |
| `AGENTS.md` | Dice "acciones sobre pagos, tasas, reservas y roles" a auditoría; `audit` no incluye crear reserva. Decidir si crear/expirar reserva audita | T-F1-7/T-F1-8 |
| — | Serialización de dinero (strings vs números) y zona horaria (America/Caracas vs UTC) no están en ninguna spec | Transversal |

## 5. Revisión de los seis puntos que pediste

### (1) Organización activa: auto-seleccionar si hay una sola membresía, selector si hay varias

- La decisión está registrada en `design.md` de F0 (2026-11-10), pero **no está implementada ni tiene
  tarea**. El panel de auditoría hoy devuelve 403 hasta llamar a `set-active`.
- Propuesta: tarea propia en `apps/admin` antes de la pantalla mínima de pagos. Tras el login, el
  servidor de la app consulta las membresías del usuario; con una sola llama a
  `POST /api/auth/organization/set-active`; con varias muestra el selector; con cero no entra al
  panel. Super Admin entra en modo plataforma sin agencia.
- La API no cambia: sigue fallando cerrada sin agencia activa. La autoselección es UX, no seguridad.
- No lo haría en un hook `after` de Better Auth: añade escrituras y recursión; mejor en la app de
  admin, con comprobación de membresía en servidor.
- Tests: una membresía → sesión con `activeOrganizationId`; varias → selector y ninguna activa hasta
  elegir; cero → sin panel; Super Admin → contexto plataforma; sin agencia activa → 403 en operaciones
  de agencia. Wireframe del selector antes de construirlo.

### (2) T-F1-0 primero

- De acuerdo. Es el prerrequisito de cualquier plugin o autenticación por token y del trabajo de
  auditoría de rutas. No cambia comportamiento y no toca el esquema.
- Sus 7 mejoras del plan de inventario se mantienen: registro cerrado de rutas no administrativas,
  huérfanas en todas las declaraciones y en la allowlist, todos los métodos, fallo explícito con `:`,
  justificación por entrada, política para rutas sin sesión y espejo en Nest.
- Antes de implementarlo hay que decidir Q4 (alcance de la auditoría de intentos), porque si se auditan
  rutas de login, el registro cerrado de no administrativas cambia de forma.

### (3) Tarea nueva: `before` registra intento y `after` el resultado, fallo como evento estructurado

- **Restricción técnica verificada** en `better-auth@1.7.18` (`dist/api/dispatch.mjs`): si un hook
  `before` lanza (por ejemplo, el 403 `TWO_FACTOR_REQUIRED`), `runAfterHooks` **no se ejecuta**. Si el
  `before` devuelve una respuesta, también se salta el `after`. Por tanto, el fallo del `before` debe
  escribir su fila de resultado en el propio `catch`; no se puede confiar en el `after`.
- **Restricción de inmutabilidad:** `audit_logs` solo permite INSERT/SELECT y tiene trigger que rechaza
  UPDATE/DELETE. No se puede insertar el intento y "completarlo" después. Hay dos caminos: dos filas
  append-only con `correlation_id` + `phase` + `outcome`, o una tabla `auth_events` aparte.
- Contenido mínimo del intento: actor (si hay sesión), ruta, método, IP, fecha, agencia objetivo si se
  conoce. Del resultado: `outcome` (`success`/`error`), código de error estable (`TWO_FACTOR_REQUIRED`,
  validación, permisos, interno), estado HTTP y entidad afectada. Sin secretos ni cuerpos completos;
  allowlist de claves.
- Imputación RLS: rutas de plataforma → `tenant_id NULL`; rutas de organización con agencia conocida →
  esa agencia; agencia desconocida (`cancel-invitation`, `create`) → NULL y visible solo para Super
  Admin, con la fila de resultado imputada a la entidad devuelta.
- Fallo de la escritura del intento: recomiendo falla cerrada en escrituras administrativas. Fallo de
  la escritura del resultado: se registra en el log y la acción ya confirmada sigue (regla actual de la
  spec para el middleware).
- Tests: TOTP fallido → intento + resultado error; éxito → intento + resultado success; error de
  validación de la lib → resultado error; sin sesión → sin filas; rate limit → sin filas (los hooks no
  corren); visibilidad por tenant; inmutabilidad intacta.
- Orden: delta de `audit` (commit propio) → implementación (commit propio). No mezclar con T-F1-0.

### (4) Concurrencia de reservas

- La spec cubre el camino feliz, pero faltan orden de locks, carrera pago/expiración y semántica de
  idempotencia. Propuesta concreta:
  - **Crear:** resolver producto/tenant (lectura pública) → `withTenant` → `SELECT ... FOR UPDATE`
    sobre la fila de `availability` (orden determinista por id si algún día hay varias) → comprobar
    `reserved + quantity <= capacity` y producto `PUBLISHED` → incrementar → insertar reserva
    `PENDING_PAYMENT` + líneas con `unit_price_usd` y `policy_snapshot` → guardar la respuesta
    idempotente → commit.
  - **Aprobar pago:** `withTenant` → bloquear `bookings` (`FOR UPDATE`) → revalidar estado y
    `expires_at` → actualizar pago y reserva en la misma transacción → auditoría en la misma
    transacción.
  - **Expirar:** job por agencia (contexto `system`) → `FOR UPDATE SKIP LOCKED` sobre reservas
    vencidas → omitir si hay pago `IN_REVIEW` o `APPROVED` → `EXPIRED` + decremento de `reserved`.
  - **Idempotencia:** único `(user_id, endpoint, key)`, hash del cuerpo; mismo cuerpo → misma
    respuesta; cuerpo distinto → 409; en vuelo → 409/425; TTL 24 h y limpieza. El replay no genera
    segunda fila de auditoría.
  - **Invariantes en BD:** `CHECK (reserved >= 0 AND reserved <= capacity)` y decrementos
    idempotentes.
- Tests: dos reservas simultáneas por el último cupo (una 201, otra 409); pago y expiración
  simultáneos (uno gana, sin doble decremento); misma clave dos veces (una reserva); misma clave con
  otro cuerpo (409); pago tardío (410); `IN_REVIEW` impide expirar; cancelar libera una sola vez.

### (5) Tasa congelada al pagar y redondeo half-up

- Usar `Prisma.Decimal` con `ROUND_HALF_UP`; prohibido `number` en el servidor. Tests unitarios de
  `.005`, `.015`, `.004`, etc.
- Congelar al **iniciar el pago**, no al reservar. Guardar `exchange_rate_id`, `amount_usd`,
  `amount_ves` y, además, una copia de `rate` y `value_date` en el pago para que el comprobante no
  dependa de una fila de tasa que pueda cambiar. La spec dice que el par no cambia: recomiendo un
  trigger `BEFORE UPDATE` que rechace cambios en esos campos (defensa en profundidad, como
  `audit_logs`).
- Selección de tasa: última `value_date <= hoy` (America/Caracas), override con precedencia; fin de
  semana/feriado usa la última publicada; caché 1 h; job diario; proveedor con timeout 5 s, un
  reintento y circuit breaker; rechazar tasa <= 0 o con más de 4 decimales; parsear desde string.
- Reembolso: tasa congelada. Decidir Q12 para que USD y VES no se desalineen un céntimo.
- Catálogo: VES informativo con el mismo redondeo; sin tasa → solo USD (200) y endpoint de tasa 503.
- Tests: la tasa cambia después y el pago conserva el par; 100 USD × 900,0000 = 90000,00; redondeo
  half-up; reembolso 50 % coherente; proveedor caído → última guardada; sin tasa → 503; sábado → tasa
  del viernes.

### (6) Wireframes: generar cada pantalla justo antes de construirla

- Cambia el flujo de F0 (6 SVG de golpe). A partir de F1: **cada tarea de pantalla empieza por su SVG**
  en `docs/wireframes/`, se indexa en el README, lo apruebas y luego se implementa. No hay una tarea
  "wireframes de toda la fase".
- Pantallas de F1: búsqueda/resultados, detalle, checkout (viajero + moneda), pago (métodos +
  cuenta regresiva), confirmación (voucher/comprobante), "Mis reservas" (lista/detalle), cancelación y
  descarga de documentos; en admin, selector de organización y aprobación mínima de pagos. Variantes
  móviles donde aplique (mobile-first).
- Cada wireframe debe mostrar: USD + VES con tasa y fecha valor, cuenta regresiva de retención,
  estados del pago, leyenda "Documento no fiscal", campos por método, estados vacío/error/carga y
  orden de foco por teclado.
- Los SVG de F0 se conservan como referencia; se actualizan si la pantalla cambia.

## 6. Secuencia propuesta y paradas

| Fase | Tareas | Parada para aprobación |
| --- | --- | --- |
| 0. Especificar | Delta de specs de F1 + specs nuevas (`api-errors`, `notifications`, contextos RLS) y actualización de `design.md` (ajustes de tenant, tenancy de tasas, almacenamiento de PDF, dependencias) | **Sí**: revisar deltas antes de código |
| 1. Seguridad y contratos | T-F1-0 inventario → T-F1-0b/0c auditoría de intentos → T-F1-0d errores + Zod + pipe de validación | **Sí**: diff + tests de cada tarea |
| 2. Datos y catálogo | T-F1-1 (+ ajustes de tenant, providers, `user.locale`), T-F1-2, T-F1-3, T-F1-4, T-F1-5, T-F1-6 | **Sí**: demo de búsqueda + aislamiento entre tenants |
| 3. Reservas y pagos | T-F1-7 (+7b stubs), T-F1-8, T-F1-9, T-F1-9b organización activa, T-F1-9c aprobación mínima, T-F1-10 | **Sí**: demo reservar/pagar + prueba de concurrencia |
| 4. Documentos y avisos | T-F1-11, T-F1-12 | **Sí**: voucher/comprobante descargables |
| 5. Web por pantalla | T-F1-13a…e, T-F1-14a…b; cada una: wireframe → aprobación → código | **Sí por pantalla** |
| 6. Verificar | T-F1-15 Playwright/k6, T-F1-16 verificación y archivado | **Sí**: informe final |

M1 y M2 no entran en F1: siguen pendientes y bloquean una demo pública, no el desarrollo local. Se
anotan en el informe de verificación y en `tasks.md`.

## 7. Qué necesito del dueño para arrancar

1. Respuestas a Q1–Q3 (tenant/RLS): bloquean T-F1-1.
2. Respuestas a Q4–Q8 (auditoría de intentos): bloquean la tarea nueva.
3. Respuestas a Q9–Q19 (reservas/pagos): bloquean T-F1-7/T-F1-9.
4. Respuestas a Q20–Q24 (catálogo): bloquean T-F1-1/T-F1-3.
5. Respuestas a Q25–Q30 (documentos/notificaciones/API): bloquean T-F1-11/T-F1-12.
6. Confirmación de S1–S13.
7. Visto bueno para arrancar **T-F1-0 ahora**: no depende de las preguntas abiertas.
