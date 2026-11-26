# Diseño: f2-admin-rates

## 1. Contexto y límites

- El panel sigue siendo una app Next.js independiente con Ant Design 6.7 (D5). No se introduce
  shadcn/ui en `apps/admin` ni Ant Design en `apps/web`.
- Los pagos siguen simulados (D9). F-FINAL-003 corrige la atomicidad del reembolso dentro del
  proveedor simulado; no conecta una pasarela real.
- No se activan plugins ni modos de autenticación nuevos. Usuarios y roles se gestionan con las rutas
  ya existentes de Better Auth bajo `/api/auth/organization/*`, con el inventario y la política de
  rutas sin sesión actualizados en el delta de `auth-access`.
- Las reglas de dinero no cambian: `DECIMAL` en base, montos y tasas calculados en servidor, tasa
  congelada por pago (`exchange_rate_id` + `amount_ves`) y redondeo half-up.

## 2. Specs y trazabilidad

| Dominio | Tipo | Escenarios nuevos | Obligatorios | Deseables |
| --- | --- | ---: | ---: | ---: |
| `api-errors` | delta ADDED | 1 | 1 | 0 |
| `exchange-rates` | delta ADDED | 12 | 9 | 3 |
| `payments` | delta ADDED | 12 | 8 | 4 |
| `audit` | delta ADDED | 10 | 6 | 4 |
| `catalog` | delta ADDED | 8 | 8 | 0 |
| `auth-access` | delta ADDED | 6 | 6 | 0 |
| `admin-ui` | spec base nueva | 10 | 7 | 3 |
| `reports` | spec base nueva | 5 | 5 | 0 |
| `security` | spec base nueva | 13 | 13 | 0 |
| **Total** | | **77** | **63** | **14** |

Las specs base nuevas se crean desde el principio (spec primero) para que `tasks.md` pueda referenciar
dominios existentes y `scripts/check-specs.mjs` siga en verde durante la change. Los deltas se fusionan
en las specs base al archivar. El detalle por escenario está en `scope.md`.

## 3. Identidad visual del panel

- `apps/admin/src/components/providers.tsx` ya tiene un `ConfigProvider`; se amplía con `theme.token`
  y `theme.components`: `colorPrimary = #0E2A3D`, `colorWarning = #F4A300`,
  `colorSuccess = #1FA6A0`, `colorBgLayout = #FBF7EF`. Se conserva el paquete de idioma `es_ES`/`en_US`.
- `apps/admin/src/components/site-header.tsx` deja los colores fijos actuales y usa los mismos tokens;
  la marca «Caribe» y el subtítulo «Panel de agencia» pasan a Clash Display.
- **Paquete compartido de fuentes**: crear `packages/fonts` con los ocho `.woff2` que hoy están en
  `apps/web/public/fonts`, un `package.json` privado (`@caribe/fonts`) y exportaciones de las rutas.
  `apps/web` y `apps/admin` las consumen con `next/font/local` apuntando al paquete. Es una tarea con
  verificación de build: si Next 16 no resuelve la ruta del workspace, se documenta la alternativa
  antes de cambiar el enfoque. No se añaden dependencias de terceros.
- Todo texto nuevo va en `apps/admin/messages/es.json` y `en.json`; ninguna cadena fija en componentes.

## 4. Superficie de API

Endpoints existentes que reutiliza el panel (sin cambiar su contrato):

| Necesidad | Endpoint | Origen |
| --- | --- | --- |
| Tasa vigente / override | `GET /admin/exchange-rates/current`, `PUT /admin/exchange-rates/override` | T-F1-5 |
| Pagos | `GET /admin/payments`, `PATCH /admin/payments/:id/approve`, `.../reject` | T-F1-9 |
| Auditoría | `GET /admin/audit-logs`, `GET /admin/auth-events` | T-F0-9 |
| Catálogo | `GET/POST/PUT /admin/products`, `.../publish`, `.../archive` | T-F1-4 |
| Disponibilidad del panel | **`GET/POST /admin/products/:id/availability` (nuevo)** | F2 |
| Usuarios y roles | `/api/auth/organization/*`, `/api/auth/admin/*` | Better Auth |
| Reportes | **`GET /admin/reports/sales` (nuevo)** | F2 |
| Filtro de agencias del reporte | **`GET /admin/organizations` (nuevo, solo plataforma)** | F2 |

**Excepción aditiva para el panel de pagos (T-F2-11).** `GET/POST/PATCH /admin/payments` conservan
sus rutas, filtros, códigos y reglas de autorización; la única variación de contrato es el campo
`exchangeRateId` en `PaymentResponse`, para que la UI muestre el par congelado `rate` +
`exchange_rate_id` como texto del servidor sin calcularlo ni adivinarlo. No se añaden entradas nuevas
ni se permiten campos calculados en las peticiones.

El endpoint de reportes se añade al módulo admin, con guard de sesión, TOTP, memberships activa y un
guard dedicado que solo permite lectura a owner/admin de agencia y Super Admin. Los totales se calculan
en SQL con `DECIMAL`, sobre todos los estados del rango y con la tasa congelada de cada pago; nunca se
recalcula `amount_ves`. El CSV comparte la ruta con `format=csv` y el idioma se elige con `lang=es|en`
(`es` por defecto), sin límite de filas en el MVP. Decisión aprobada antes de T-F2-23: los pagos
rechazados y en revisión también suman y se muestran en el desglose. El selector de agencia del Super
Admin se puebla con `GET /admin/organizations`, que corre en contexto `platform` y responde `id`,
`name` y `slug` de todas las agencias; un rol de agencia recibe 403 y no ve opciones ajenas.

**Decisiones del panel de catálogo (T-F2-17/18/19).** La delta hablaba de «endpoints de escritura ya
existentes» para disponibilidad, pero solo existe la lectura pública. Se añade una ruta de escritura
autenticada del panel, con el mismo guard `ActiveMembershipGuard`/`ProductsGuard` y propiedad de fila
del resto de `/admin/products`; entra en el inventario de rutas como protegida, nunca pública. El
precio viaja como texto decimal y la noche duplicada responde 409 `AVAILABILITY_DUPLICATED` sin crear
una segunda fila. Además, `en` pasa a ser obligatorio en `title` y `description` de las escrituras del
panel: la API responde 422 si falta, mientras la lectura pública conserva el fallback a `es` de la
spec base. La propiedad de fila se decide en `ProductsAdminService.findProduct`: un producto de otro
proveedor de la misma agencia devuelve ahora 404 como el de otra agencia, para no revelar propiedad;
el 403 se reserva para permisos insuficientes. El delta de `auth-access` sustituye el escenario 403 de
la spec base y el e2e de `products-admin` se ajusta en consecuencia. Para que la interfaz oculte
acciones que la API rechazaría sin adivinar la propiedad, el listado `GET /admin/products` devuelve
`viewerProviderId`: el id del registro de proveedor del actor, o `null` si no lo tiene. El panel
recalcula su matriz con ese valor; la API sigue siendo la única fuente de verdad y valida cada
operación. La propagación de título y atributos compartidos por `hotel_key` se acota al ámbito del
actor: el Proveedor solo alcanza los productos de su `provider_id`, mientras owner/admin propagan a
toda la agencia; así un `hotel_key` compartido nunca habilita una escritura cross-provider. El cuerpo
de `POST /admin/products/:id/availability` es `{ nights: [{ night, capacity,
priceUsd }] }`: `night` es `YYYY-MM-DD` en `America/Caracas`, `priceUsd` es texto decimal y el servidor
guarda `reserved` (se conserva al ajustar, cero al crear). Una noche repetida en el cuerpo se detecta
antes de escribir y responde 409 `AVAILABILITY_DUPLICATED` dentro de la misma transacción. `GET
/admin/products/:id/availability` acepta `from`/`to` como la lectura pública y devuelve `night`,
`capacity`, `reserved` y `priceUsd` para que el panel pueda mostrar cupo y reservadas sin inferirlos de
`remaining`; el panel nunca calcula importes.

**Decisiones del panel de tasas (T-F2-8/9).** No se crea una ruta por id ni se acepta `tenantId` en el
cuerpo: un override de otra agencia simplemente no existe en el ámbito de la agencia activa, así que no
hay fila que ver ni reemplazar; un 404 se traduce como "tasa no disponible" sin ocultar el código. El
historial se lee de `GET /admin/audit-logs` filtrando por `exchange-rate.override`, sin endpoint nuevo.
La matriz del diseño se hace efectiva con un delta en `auth-access`: `agent` y `provider` reciben solo
`exchange-rate: read`; no ven historial ni pueden escribir.

**Inventario de rutas sin sesión (F-FINAL-002).** La política es «fallo cerrado»: solo se permite
sin sesión lo que lleva `@AllowAnonymous` explícito, el guard global de Better Auth exige sesión en
el resto y no se activa ningún plugin ni modo de autenticación nuevo.

| Ruta | Política |
| --- | --- |
| `GET /api/v1/products`, `GET /api/v1/products/:id/availability`, `GET /api/v1/products/:id` | Público (`@AllowAnonymous`), solo datos `PUBLISHED` y no borrados |
| `GET /api/v1/rates/today` | Público (`@AllowAnonymous`), tasa global vigente |
| `/api/auth/*` | Rutas propias de Better Auth (alta/inicio de sesión y las ya existentes de organización/admin); no cambia su clasificación ni se añaden plugins |
| `GET /api/v1/admin/organizations` | Protected: sesión + rol de plataforma; solo lectura de `id`, `name` y `slug` para el filtro de reportes |
| `POST /api/v1/bookings`, `POST /api/v1/bookings/:id/payments`, `PATCH /api/v1/admin/payments/:id/approve`, `PATCH /api/v1/admin/payments/:id/reject`, `GET /api/v1/documents/:id/download` | Protected: sesión + permiso + TOTP donde aplica; T-F2-4 añade límite pero no acceso anónimo |

El guard de T-F2-4 no crea rutas públicas y no altera este inventario: las cinco rutas limitadas ya
exigían sesión antes del cambio. El límite de login de T-F2-2 actúa sobre `/api/auth/*` sin sesión,
con la misma ventana y umbral que la librería.

## 5. Matriz de permisos en la UI

| Pantalla | owner/admin | agent | provider | member | Super Admin |
| --- | --- | --- | --- | --- | --- |
| Tasas | ver y override con TOTP | ver solo tasa vigente | ver solo tasa vigente | sin acceso | ver global; fijar global (deseable) |
| Pagos | listar y revisar (revisor ≠ pagador) | listar, no revisar | no ver | no ver | solo lectura, no revisar |
| Auditoría | sí, su agencia | no | no | no | sí, plataforma y agencias |
| Catálogo | CRUD | ver | solo sus productos | no ver | solo lectura |
| Usuarios/roles | invitar y cambiar rol | no | no | no | revocar sesiones, consultar agencias y crear/configurar agencias |
| Reportes | sí, su agencia | no | no | no | sí, solo lectura |

La API sigue siendo la fuente de autoridad: la UI deshabilita acciones y oculta resúmenes, y además
maneja 403/404/409 del servidor. Los tests de UI comprueban explícitamente que un `provider` no ve
inventario ajeno y que un `member` sin `booking:read` no ve reservas ni resumen (matriz F1).

## 6. Seguridad heredada

- **M1**: `TRUSTED_PROXIES` configura un middleware propio que conoce la dirección del socket. Solo si
  el socket es un proxy de confianza y el último salto de `X-Forwarded-For` coincide con él se recorre
  la cadena hacia la izquierda; en cualquier otro caso la cabecera se ignora y se usa el socket. El
  resultado se publica como `request.ip` y en una cabecera interna (`x-caribe-client-ip`) que Better
  Auth consume mediante `advanced.ipAddress.ipAddressHeaders`: la librería no puede comprobar quién
  emitió la cabecera, así que no se le entrega la cadena original ni `trustedProxies`. El límite de
  login se aplica antes del handler con la misma ventana/umbral (60 s, 10 intentos) y devuelve 429
  Problem Details con `code = RATE_LIMITED`. Si no hay IP resoluble, el valor es `null` y la auditoría
  lo registra así, sin fingir uno ni compartir bucket global.
- **M2**: Helmet con HSTS y `X-Content-Type-Options` en **toda** respuesta de la API (éxito, error y
  429); CORS con `TRUSTED_ORIGINS` y credenciales solo para esos orígenes; preflight desconocido
  rechazado sin cabeceras de autorización. Se desactiva el CORS que la integración de Better Auth
  registraba por su cuenta: devolvía `Access-Control-Allow-Credentials` incluso a orígenes no
  autorizados.
- **CSP del panel**: se eligen **nonces por petición**, no hashes. `src/proxy.ts` genera el nonce,
  lo publica en `Content-Security-Policy` y lo entrega a Next por `x-nonce` para que marque sus
  propios scripts; el layout llama a `connection()` para forzar renderizado por petición (guía de
  CSP de Next 16, donde los hashes estáticos no cubren scripts generados en cada respuesta).
  `script-src` usa `'nonce-…'` y `'strict-dynamic'`, nunca `'unsafe-inline'`; `style-src` lo permite
  únicamente por el cssinjs de Ant Design. La cabecera se fija en el proxy, de modo que también la
  reciben las páginas de error.
- **F-FINAL-002**: `@nestjs/throttler` aporta el almacenamiento en memoria; un guard propio marca
  las cuatro rutas con un decorador y lanza `RATE_LIMITED` (429 Problem Details) con `Retry-After`.
  No se usa el `ThrottlerGuard` de la librería porque aplicaría todas las políticas a todas las
  rutas. La identidad es la IP real resuelta en T-F2-2 (o el usuario autenticado como respaldo), con
  hash SHA-256 en la clave: ni la IP ni la ruta se exponen en la respuesta. `approve` y `reject`
  comparten el cupo de revisión para que no se eluda alternando operaciones.
  Umbrales por defecto (ventana común de 60 s, configurables por entorno): reservas 10, alta de
  pagos 10, revisión de pagos 20 y descargas 60. Un valor inválido cae al valor por defecto en lugar de
  desactivar la protección. El inventario de rutas sin sesión se actualiza en el delta de
  `auth-access`: estas cuatro rutas siguen exigiendo sesión y el limitador no crea ninguna ruta
  pública nueva.
- **F-FINAL-003**: `refundId` lo genera el servidor (UUID) y viaja en `RefundIntent` al proveedor;
  no se añade un campo al `POST /bookings/:id/cancel` ni un endpoint nuevo. La spec base `security`
  decía «enviado por el cliente»; el delta de esta change corrige esa frase para que el dueño del
  identificador sea el servidor, decisión confirmada con el producto antes de implementar. La
  intención se escribe como fila `refund_dispatches` en la MISMA transacción que cancela la reserva y
  crea el `refund` (append-only); el despacho al proveedor y el marcado `COMPLETED` ocurren después
  del commit. Así un rollback local no deja una llamada externa sin fila y un fallo al registrar el
  resultado deja el despacho `PENDING` para el barrido de reconciliación. El proveedor simulado es
  idempotente por `refundId`: repetir el mismo par no provoca un segundo efecto; un `refundId`
  distinto sobre el mismo pago ya reembolsado responde 409 `REFUND_ALREADY_ISSUED`. El barrido
  consulta el estado con `getRefund(refundId)` antes de reintentar, sin volver a emitir. El puerto
  `PaymentProvider` se inyecta desde un módulo compartido para que pagos y reconciliación hablen con
  la misma instancia; el token vive en su propio archivo para evitar un ciclo con `JobsModule`. No
  cambia la interfaz pública de los otros cuatro proveedores.

**Dependencias nuevas justificadas**: `@nestjs/throttler` (rate limiting de rutas de negocio, no
cubierto por Better Auth) y `helmet` (cabeceras de seguridad de M2). CORS usa el soporte integrado de
Nest, sin paquete adicional. Tras `pnpm add` se revisa `pnpm-workspace.yaml` según la regla del
proyecto sobre `allowBuilds`.

## 7. Auditoría

Toda acción sensible del panel (override de tasa, aprobación/rechazo de pago, invitación, cambio de
rol, revocación de sesión) escribe `audit_logs` en la misma transacción con `actor_id`, `before`,
`after` e `ip`. El visor muestra esos campos sin secretos ni mensajes internos, respeta RLS y usa
cursor. La IP se muestra como «—» cuando sea `null`.

## 8. Wireframes y puertas

- Ya aprobados: `docs/wireframes/panel-pagos.svg`, `panel-tasas.svg`, `panel-auditoria.svg`,
  `panel-catalogo.svg`, `panel-usuarios-roles.svg` y `panel-reportes.svg`.
  Todos siguen `docs/wireframes/README.md` y el formato de baja fidelidad de `panel-pagos.svg`.
- Decisiones aprobadas de usuarios/roles (T-F2-20): el listado muestra miembro, rol, estado de 2FA y
  última sesión; los modales cubren invitación, cambio de rol antes/después y revocación de sesiones
  con la IP mostrada como «—». La organización objetivo se elige solo entre las membresías del actor;
  Super Admin consulta agencias en modo plataforma sin fijar agencia activa. No se incluye exportación
  ni otra acción sin ruta existente en la spec.
- Decisiones aprobadas del wireframe de reportes (T-F2-22): rango inclusivo en `America/Caracas`,
  selector de agencia solo para el Super Admin, totales USD/VES y desglose por método/estado calculados
  en servidor con importes y tasa congelados, y CSV con los mismos filtros y encabezados es/en.
- Decisión aprobada durante T-F2-23: el selector de agencia del Super Admin usa la nueva ruta de
  plataforma `GET /admin/organizations` en lugar de `/api/auth/organization/list`, porque esta última
  solo devuelve membresías y no basta para consultar todas las agencias.
- Ajuste de seguridad del CSV aprobado tras la revisión de T-F2-23: además de comas, comillas y saltos
  de línea, cada celda que empiece por `=`, `+`, `-` o `@` se prefija con `'` para evitar inyección de
  fórmulas al abrir el archivo en Excel o Sheets. No cambia filtros, totales ni contrato de la ruta.
- Decisiones aprobadas antes de T-F2-23 (delta `reports`): el CSV se sirve por
  `GET /admin/reports/sales?format=csv` sin nueva ruta; los totales suman todos los estados del rango;
  en el MVP no hay límite de filas y, sin preferencia explícita de idioma, los encabezados son `es`. El
  delta MODIFIED no añade escenarios nuevos, solo precisa los cinco ya contabilizados.
- Ajuste aprobado en T-F2-21: la revocación de sesiones queda reservada al Super Admin en modo
  plataforma. `systemUserRole` no tiene `session:revoke` y `admin({ adminRoles: ["super_admin"] })`
  rechazaría al admin de agencia, así que su panel no ofrece la pestaña de sesiones ni el botón de
  revocar. No se amplían permisos F0 ni se añaden rutas ni plugins.
- **Pausa 1** tras el override de tasa: verificación independiente de los escenarios obligatorios de
  `exchange-rates` y `security`.
- **Pausa 2** tras la aprobación/rechazo de pagos: verificación independiente y revisión de seguridad
  en sesión limpia antes de catálogo y usuarios/roles.

## 9. Pruebas y verificación

- Un commit por tarea, tests primero (rojo → verde), `pnpm lint`, `pnpm typecheck` y `pnpm test`
  en verde antes de marcar la tarea.
- Cobertura ≥ 70 % en tasas, pagos y reservas (DoD). Sin `any` nuevos ni `@ts-ignore` sin justificar.
- `node scripts/check-specs.mjs` y `pnpm exec openspec validate --all` en verde tras cada tanda.
- Cada escenario obligatorio de `scope.md` se mapea a un test o verificación documentada en `verify.md`.
- No se aumentan timeouts sin investigar la causa raíz (aprendizaje del flake de F1).
