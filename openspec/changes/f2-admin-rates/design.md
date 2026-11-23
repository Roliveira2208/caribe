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
| `exchange-rates` | delta ADDED | 12 | 9 | 3 |
| `payments` | delta ADDED | 12 | 8 | 4 |
| `audit` | delta ADDED | 10 | 6 | 4 |
| `catalog` | delta ADDED | 7 | 7 | 0 |
| `auth-access` | delta ADDED | 6 | 6 | 0 |
| `admin-ui` | spec base nueva | 10 | 7 | 3 |
| `reports` | spec base nueva | 5 | 5 | 0 |
| `security` | spec base nueva | 13 | 13 | 0 |
| **Total** | | **75** | **61** | **14** |

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
| Catálogo | `GET/POST/PATCH /admin/products` y disponibilidad | T-F1-4 |
| Usuarios y roles | `/api/auth/organization/*`, `/api/auth/admin/*` | Better Auth |
| Reportes | **`GET /admin/reports/sales` (nuevo)** | F2 |

El endpoint de reportes se añade al módulo admin, con guard de sesión, TOTP, memberships activa y un
guard dedicado que solo permite lectura a admin de agencia y Super Admin. Los totales se calculan en
SQL con `DECIMAL`, sobre los pagos `APPROVED` y su tasa congelada; nunca se recalcula `amount_ves`.

## 5. Matriz de permisos en la UI

| Pantalla | owner/admin | agent | provider | member | Super Admin |
| --- | --- | --- | --- | --- | --- |
| Tasas | ver y override con TOTP | ver solo tasa vigente | ver solo tasa vigente | sin acceso | ver global; fijar global (deseable) |
| Pagos | listar y revisar (revisor ≠ pagador) | listar, no revisar | no ver | no ver | solo lectura, no revisar |
| Auditoría | sí, su agencia | no | no | no | sí, plataforma y agencias |
| Catálogo | CRUD | ver | solo sus productos | no ver | solo lectura |
| Usuarios/roles | invitar, cambiar rol, revocar | no | no | no | crear/configurar agencias |
| Reportes | sí, su agencia | no | no | no | sí, solo lectura |

La API sigue siendo la fuente de autoridad: la UI deshabilita acciones y oculta resúmenes, y además
maneja 403/404/409 del servidor. Los tests de UI comprueban explícitamente que un `provider` no ve
inventario ajeno y que un `member` sin `booking:read` no ve reservas ni resumen (matriz F1).

## 6. Seguridad heredada

- **M1**: `TRUSTED_PROXIES` se pasa a `advanced.ipAddress.trustedProxies` de Better Auth y al middleware
  que calcula `request.ip`. Una cabecera `X-Forwarded-For` de un origen no confiable se ignora. El
  rate limit de login usa la IP resuelta; si no hay proxy de confianza, la IP puede ser `null` y la
  auditoría lo registra así, sin fingir un valor.
- **M2**: Helmet con CSP sin `unsafe-inline`, HSTS y `X-Content-Type-Options`; CORS con
  `TRUSTED_ORIGINS` y credenciales solo para esos orígenes; preflight desconocido rechazado sin
  cabeceras de autorización.
- **F-FINAL-002**: `@nestjs/throttler` aplicado a `POST /bookings`, alta y revisión de pagos y
  descargas, con 429 en formato Problem Details. Los umbrales se deciden antes de la tarea y quedan
  en variables de entorno; se actualiza el inventario de rutas sin sesión.
- **F-FINAL-003**: `refundId` idempotente en la interfaz `PaymentProvider` y registro atómico/outbox
  para que un rollback de la base no deje un reembolso externo sin fila; barrido de reconciliación de
  pendientes. No cambia la interfaz pública de los otros cuatro proveedores.

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

- Ya aprobado: `docs/wireframes/panel-pagos.svg`.
- Pendientes de aprobación, uno por uno, antes de implementar su pantalla: `panel-tasas.svg`,
  `panel-auditoria.svg`, `panel-catalogo.svg`, `panel-usuarios-roles.svg` y `panel-reportes.svg`.
  Todos siguen `docs/wireframes/README.md` y el formato de baja fidelidad de `panel-pagos.svg`.
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
