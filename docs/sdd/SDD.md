# SDD – OTA Venezuela (MVP de portafolio)

Nov 9, 2026 · @Rodrigo

## 1. Introducción y descripción general

Este documento define el diseño de un MVP funcional de una Agencia de Viajes en Línea (OTA) pensada para Venezuela, construido como proyecto de portafolio por un solo desarrollador. Sigue la estructura del Software Design Document que recomienda Atlassian: arquitectura, datos, interfaces, componentes, interfaz de usuario, suposiciones y glosario. Cada decisión de diseño queda registrada con sus alternativas en la sección 3.

### Propósito y audiencia

Servir de plano técnico antes de escribir código y de evidencia de criterio de diseño para quien revise el portafolio. Sus lectores son el propio desarrollador, y reclutadores o revisores técnicos.

### Objetivos

- Vender cuatro tipos de producto (hoteles, tours, paquetes y vuelos) con un único flujo de búsqueda, reserva, pago y voucher.
- Fijar precios en USD y mostrar el equivalente en VES con la tasa BCV del día de la compra.
- Ofrecer un panel administrativo con varios roles y una arquitectura preparada para operar como SaaS multi-tenant.
- Entregar una PWA instalable, en español e inglés.
- Demostrar seguridad y rendimiento con metas medibles (secciones 10 y 11).

### Alcance del MVP

- Inventario propio cargado desde el panel por administradores y proveedores.
- Adaptadores opcionales en sandbox: Duffel para vuelos y LiteAPI para hoteles.
- Pagos simulados (Pago Móvil, Zelle, Binance Pay y tarjeta) con aprobación automática o manual.
- Voucher de reserva y comprobante de pago en PDF, en formato libre y no fiscal.
- Registro de auditoría de acciones administrativas.

### Fuera de alcance

- Cobros reales, conciliación bancaria y validación de comprobantes de pago.
- Facturación fiscal homologada ante el SENIAT.
- Multi-tenant completo con dominios propios y planes de suscripción (el diseño lo deja preparado).
- Aplicación nativa y emisión real de boletos aéreos.

## 2. Requisitos

El sistema atiende a cinco roles y debe cumplir metas no funcionales medibles; las metas son propuestas de diseño para validar durante el desarrollo.

### Requisitos funcionales por rol

| Rol | Capacidades principales |
| --- | --- |
| Cliente | Buscar y filtrar productos, ver detalle y política de cancelación, reservar (con o sin cuenta), pagar en USD o VES, descargar voucher y comprobante, ver y cancelar sus reservas. |
| Agente | Crear reservas en nombre de clientes, consultar el estado de pagos y reservas de su agencia. |
| Proveedor | Cargar y editar su propio inventario (productos, disponibilidad, precios en USD, política de cancelación) y ver las reservas de sus productos. |
| Admin de agencia | Gestionar usuarios, roles, catálogo, reservas y pagos; aprobar o rechazar pagos; ajustar la tasa de cambio; ver reportes y auditoría. |
| Super Admin | Crear y configurar tenants (agencias) y supervisar la plataforma. Solo activo cuando se habilite el modo SaaS. |

### Requisitos no funcionales

| Categoría | Meta | Cómo se mide |
| --- | --- | --- |
| Rendimiento web | LCP menor a 2,5 s en móvil con red 4G simulada | Lighthouse CI en cada pull request |
| Rendimiento API | p95 menor a 300 ms en búsqueda con caché y menor a 600 ms en creación de reserva | Pruebas de carga con k6 |
| Calidad web | Lighthouse de 90 o más en rendimiento, accesibilidad, buenas prácticas y SEO | Lighthouse CI |
| Accesibilidad | WCAG 2.1 nivel AA en flujos de reserva y pago | Revisión con axe y prueba de teclado |
| Seguridad | Cero vulnerabilidades altas o críticas abiertas; sin hallazgos altos en ZAP baseline | npm audit, Dependabot, OWASP ZAP |
| Disponibilidad | 99,5 % como objetivo de diseño (sin SLA en planes gratuitos) | Monitor de uptime externo |
| Consistencia | Cero sobreventa de cupos bajo reservas concurrentes | Prueba de concurrencia automatizada |
| Internacionalización | Español e inglés con todas las cadenas externalizadas | Revisión de claves faltantes en CI |
| Mantenibilidad | Cobertura de pruebas de 70 % o más en la lógica de reservas, tasas y pagos | Reporte de cobertura en CI |
| Auditoría | Toda acción administrativa sobre pagos, tarifas y reservas queda registrada | Revisión de la tabla de auditoría |

## 3. Decisiones de diseño

Se tomaron 15 decisiones que condicionan el resto del documento; cada una conserva sus alternativas para poder revisarla si cambia el contexto.

| # | Decisión | Elegido | Alternativas descartadas | Razón y costo |
| --- | --- | --- | --- | --- |
| D1 | Alcance del MVP | Cuatro productos (hoteles, tours, paquetes, vuelos) sobre un modelo único de producto | Un solo producto; cuatro módulos independientes | Comparten búsqueda, carrito, pago y voucher. Costo: el modelo debe ser genérico y se implementa por fases. |
| D2 | Origen del inventario | Inventario propio como fuente principal, más adaptadores sandbox de Duffel (vuelos) y LiteAPI (hoteles) | Solo agregador externo; solo inventario propio | El inventario propio no depende de terceros y los adaptadores muestran integración real. Amadeus Self-Service quedó descartado: [cerró el 17 de julio de 2026](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers). |
| D3 | Multi-tenant | Preparado: `tenant_id` en todas las tablas y aislamiento con Row-Level Security; un solo tenant activo en el MVP | Una sola agencia; SaaS completo con dominios y planes | Evita reescribir el modelo de datos después sin pagar el costo del SaaS completo. |
| D4 | Frontend público | Next.js (SSR/ISR) con shadcn/ui y Tailwind CSS | SPA en React puro | La OTA depende del SEO y del tiempo de carga; SSR resuelve ambos. |
| D5 | Panel administrativo | App Next.js separada con Ant Design | shadcn/ui también en el panel | Ant Design acelera tablas y filtros complejos. Costo: dos sistemas de diseño, aislados en apps distintas para no engordar el bundle público. |
| D6 | Backend | NestJS (TypeScript), monolito modular | Laravel; microservicios | Un solo lenguaje y tipos compartidos con el frontend; un monolito modular es lo que un desarrollador puede operar. |
| D7 | Base de datos y ORM | PostgreSQL con Prisma | MySQL; TypeORM; Supabase | Transacciones, `DECIMAL` exacto, JSONB y RLS nativo. |
| D8 | Moneda | Catálogo en USD; VES calculado con la tasa BCV del día de la compra | Listas de precio separadas por moneda | Un solo precio fuente y una tasa congelada por pago. |
| D9 | Pagos | Simulados, con interruptor de aprobación automática o manual detrás de una interfaz `PaymentProvider` | Integración real con una pasarela | El proyecto es de portafolio; la interfaz permite conectar una pasarela real después. |
| D10 | Comprobante | PDF de formato libre, no fiscal, detrás de una interfaz `InvoiceProvider` | Factura fiscal homologada | La normativa del SENIAT cambió en 2026 y sigue en transición (sección 12). |
| D11 | Canal | PWA instalable con lectura sin conexión de reservas y vouchers | Solo web responsive; app nativa | Conexiones inestables en el mercado objetivo. No se reserva sin conexión. |
| D12 | Repositorio | Monorepo con pnpm y Turborepo: `apps/web`, `apps/admin`, `apps/api`, `packages/shared` | Repos separados | Tipos y validaciones compartidos; un solo pipeline de CI. |
| D13 | Caché y trabajos | Redis para caché y BullMQ para trabajos en segundo plano | Cron simple; sin caché | Expiración de reservas, PDFs y correos no deben bloquear la API. |
| D14 | Hosting | Planes gratuitos (frontend, API, Postgres) y Docker para desarrollo local | Nube de pago | Presupuesto cero. Costo: arranques en frío y sin SLA. |
| D15 | Autenticación y autorización | Better Auth dentro de la API de NestJS, con los plugins Organization, Admin y Two-Factor; sesiones en cookie guardadas en PostgreSQL | JWT propio con refresh tokens y Passport; Auth.js | Aporta sesiones revocables, roles con permisos, organizaciones para el multi-tenant y segundo factor sin escribir ese código. Costo: la integración con NestJS es comunitaria y las apps Next.js deben reenviar /api/\* a la API para que la cookie sea de primera parte. |

## 4. Arquitectura del sistema

El sistema es un monorepo con tres aplicaciones (web pública, panel administrativo y API) sobre PostgreSQL y Redis, y los proveedores externos quedan aislados detrás de interfaces propias.

### Estilo arquitectónico

- **Monolito modular con puertos y adaptadores.** Un solo despliegue de NestJS con módulos de responsabilidad única (sección 8); los servicios externos entran por interfaces como `InventoryProvider` o `PaymentProvider`.
- **Frontend desacoplado.** La web pública y el panel son aplicaciones Next.js distintas que consumen la misma API REST y comparten tipos y validaciones desde `packages/shared`; ambas reenvían `/api/*` a la API para que la cookie de sesión sea de primera parte.
- **Autenticación con Better Auth.** Corre dentro de la API, expone sus rutas en `/api/auth/*` y guarda usuarios, sesiones y organizaciones en PostgreSQL; los guards de NestJS leen la sesión y los permisos (sección 10).
- **Multi-tenant preparado.** Cada agencia es una organización de Better Auth; cada solicitud resuelve un tenant, y PostgreSQL aplica Row-Level Security sobre `tenant_id`.
- **Trabajo asíncrono.** Redis sirve de caché y de cola para BullMQ: expiración de reservas, actualización de tasa, PDF y correo.

### Vista de alto nivel

El diagrama muestra quién llama a quién.

&#91;embedded content: arquitectura · 2 aplicaciones web, 1 API, 2 almacenes, 4 servicios externos\]

Las aplicaciones web solo hablan con la API; esta es la única que toca la base de datos, la caché y los servicios externos.

## 5. Diseño de datos

El modelo es relacional en PostgreSQL, con un único tipo `products` que cubre los cuatro productos y un `tenant_id` en cada tabla de negocio.

### Entidades principales

| Entidad | Propósito | Campos clave |
| --- | --- | --- |
| `organization` | Agencia (tenant), mediante el plugin Organization de Better Auth | `id`, `name`, `slug`, `metadata`, más campos propios: `base_currency` (USD), `payment_mode` (AUTO o MANUAL) y `hold_minutes` |
| `user`, `session` | Cuentas de todos los roles y sus sesiones, gestionadas por Better Auth | `user`: `id`, `email`, `name`, `role`, `banned`, `locale`; `session`: `token`, `expiresAt`, `activeOrganizationId` |
| `providers` | Proveedores de inventario | `id`, `tenant_id`, `user_id`, `name`, `contact` |
| `destinations` | Destinos geográficos | `id`, `tenant_id`, `name` (i18n), `country`, `code` |
| `products` | Hotel, tour, paquete o vuelo | `id`, `tenant_id`, `provider_id`, `type`, `title` y `description` (i18n), `destination_id`, `status`, `base_price_usd`, `cancellation_policy_id`, `source` (OWN, DUFFEL, LITEAPI), `external_ref`, `attributes` (JSONB) |
| `package_items` | Composición de un paquete | `package_id`, `product_id`, `position` |
| `availability` | Cupo y precio por fecha | `id`, `product_id`, `starts_on`, `ends_on`, `capacity`, `reserved`, `price_usd` |
| `cancellation_policies` | Reglas de penalización | `id`, `tenant_id`, `name`, `rules` (horas antes y porcentaje) |
| `bookings` | Reserva del cliente | `id`, `tenant_id`, `code`, `user_id`, `status`, `total_usd`, `expires_at`, `created_at` |
| `booking_items` | Líneas de la reserva | `booking_id`, `product_id`, `availability_id`, `quantity`, `unit_price_usd`, `policy_snapshot` |
| `exchange_rates` | Tasa BCV por fecha valor | `id`, `source`, `rate`, `value_date`, `fetched_at`, `is_override` |
| `payments` | Intento de pago | `id`, `booking_id`, `method`, `amount_usd`, `amount_ves`, `exchange_rate_id`, `reference`, `status`, `paid_at` |
| `documents` | Voucher y comprobante | `id`, `booking_id`, `type`, `number`, `file_url`, `issued_at` |
| `audit_logs` | Rastro de acciones | `id`, `tenant_id`, `actor_id`, `action`, `entity`, `entity_id`, `before`, `after`, `ip`, `at` |

Better Auth define y migra las tablas `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` y `twoFactor`; cada persona de una agencia aparece en `member` con su `role`, y los nombres de campo pueden mapearse a snake\_case. En el resto de las tablas, `tenant_id` referencia `organization.id`, y `providers.user_id` y `bookings.user_id` referencian `user.id`.

### Estados

- Reserva: `PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `EXPIRED`.
- Pago: `PENDING`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `REFUNDED`.

### Reglas de integridad

- El dinero se guarda como `DECIMAL`, nunca como punto flotante: 14,2 para montos y 18,4 para tasas.
- Cada pago guarda el monto en VES y una referencia a la tasa usada; esa tasa no se modifica después.
- `availability.reserved` no puede superar `capacity`; la reserva de cupo ocurre en una transacción con bloqueo de fila.
- El número de documento es único por `tenant_id` y tipo, y correlativo.
- Row-Level Security filtra por `tenant_id` en todas las tablas de negocio.
- Los textos visibles al usuario usan JSONB con las claves `es` y `en`.
- Los atributos propios de cada tipo (por ejemplo origen y destino de un vuelo, o duración de un tour) van en `attributes` y se validan con un esquema Zod por tipo; los campos de búsqueda frecuente tienen índice.
- Borrado lógico en productos y usuarios; los registros de auditoría no se modifican ni se borran.

## 6. Multimoneda y pagos

Los precios se guardan en USD, y el monto en VES se calcula con la tasa BCV vigente el día de la compra, que queda congelada junto al pago.

### Reglas de conversión

1. Catálogo, disponibilidad y totales de reserva se almacenan en USD.
2. En el catálogo, el precio en VES es informativo: USD por la tasa vigente, redondeado a 2 decimales.
3. Al iniciar el pago se registra la tasa del día y se calcula `amount_ves`; ese par no cambia aunque la tasa cambie después.
4. El BCV [publica una tasa por día hábil](https://allratestoday.com/es/central-bank-rates-api/bcv/); en fines de semana y feriados se usa la última fecha valor publicada.
5. Fuente primaria: DolarAPI, endpoint de tasa oficial sin autenticación ([documentación](https://dolarapi.com/docs/venezuela/operations/get-dolar-oficial)); su disponibilidad se debe verificar antes de implementar. Respaldo: la última tasa válida guardada.
6. El administrador puede fijar una tasa manual indicando el motivo; queda marcada como `is_override` y registrada en auditoría.
7. La tasa se guarda en caché una hora y se refresca una vez al día con un trabajo programado.
8. Los reembolsos se calculan sobre los montos USD y VES del pago original, es decir, con la tasa congelada del día en que se pagó; el porcentaje y las demás condiciones del reembolso los fija la política de cancelación de la agencia.

### Métodos de pago simulados

| Método | Moneda | Datos que captura el cliente |
| --- | --- | --- |
| Pago Móvil | VES | Banco, teléfono y número de referencia |
| Zelle | USD | Nombre o correo del emisor y número de confirmación |
| Binance Pay | USD (USDT) | Identificador de la orden |
| Tarjeta | USD | Datos de prueba; no se almacena número completo ni CVV |

### Modo de aprobación

El campo `payment_mode` del tenant define qué pasa tras reportar el pago. En modo AUTO el pago pasa a `APPROVED` y la reserva a `CONFIRMED` al instante, útil para demostraciones. En modo MANUAL el pago queda en `IN_REVIEW` hasta que un administrador lo apruebe o rechace, y cada decisión queda auditada.

### Retención de la reserva

Al crear la reserva se bloquea el cupo hasta `expires_at`. Para inventario propio el valor por defecto es de 30 minutos, configurable por tenant o producto; para proveedores externos se usa el vencimiento que devuelva su API. Un trabajo programado libera el cupo y marca la reserva como `EXPIRED`.

### Flujo de estados

El diagrama siguiente resume cómo cambian la reserva y el pago.

&#91;embedded content: estados de pago y reserva · 9 estados\]

La reserva pasa a `CONFIRMED` solo con un pago `APPROVED`; cancelar una reserva ya pagada genera un reembolso. Un pago rechazado deja la reserva pendiente hasta que vence la retención.

## 7. Diseño de interfaz (APIs)

La API es REST, versionada en `/api/v1` y documentada con OpenAPI (Swagger) generado desde NestJS; los proveedores externos quedan aislados detrás de cinco interfaces internas.

### Endpoints principales

| Recurso | Endpoints | Acceso |
| --- | --- | --- |
| Autenticación | Rutas de Better Auth bajo `/api/auth/*`: registro, inicio y cierre de sesión, sesión actual, verificación de correo, restablecer contraseña, segundo factor y organizaciones | Público para registro e inicio de sesión; sesión requerida en el resto |
| Catálogo | `GET /products`, `GET /products/:id`, `GET /products/:id/availability` | Público |
| Reservas | `POST /bookings` (crea y retiene cupo), `GET /bookings/:id`, `POST /bookings/:id/cancel` | Cliente, Agente |
| Pagos | `POST /bookings/:id/payments`, `PATCH /payments/:id/approve`, `PATCH /payments/:id/reject` | Cliente (crear); Admin (aprobar, rechazar) |
| Tasas | `GET /exchange-rates/current`, `PUT /admin/exchange-rates/override` | Público (leer); Admin (fijar) |
| Documentos | `GET /bookings/:id/voucher`, `GET /bookings/:id/receipt` | Dueño de la reserva, Admin |
| Administración | CRUD en `/admin/products`, `/admin/users`, `/admin/providers`; `GET /admin/audit-logs`, `GET /admin/reports/sales` | Admin, Proveedor (solo sus productos) |

Better Auth queda fuera del versionado `/api/v1`. El resto de la API exige sesión por defecto, salvo los endpoints marcados como públicos.

### Interfaces internas (puertos y adaptadores)

| Interfaz | Métodos | Implementaciones en el MVP | Futuras |
| --- | --- | --- | --- |
| `InventoryProvider` | `search`, `getDetails`, `checkAvailability`, `hold`, `confirm`, `cancel` | `OwnInventoryProvider` (principal), `DuffelProvider`, `LiteApiProvider` | Otros agregadores |
| `PaymentProvider` | `createPayment`, `confirm`, `refund` | `SimulatedPaymentProvider` | Pasarela con Pago Móvil C2P o tarjetas |
| `InvoiceProvider` | `issue(booking)` | `FreeFormReceiptProvider` | Imprenta digital autorizada |
| `ExchangeRateProvider` | `getRate(date)` | `DolarApiProvider`, `ManualOverrideProvider` | Fuente directa del BCV |
| `NotificationProvider` | `send(template, recipient)` | Correo SMTP | WhatsApp |

### Proveedores externos en sandbox

| Proveedor | Uso | Acceso y límites |
| --- | --- | --- |
| [Duffel](https://duffel.com/docs/api/overview/test-mode) | Vuelos | Token de prueba que empieza por `duffel_test_`, creado en el panel. Su aerolínea de prueba, Duffel Airways, es la más fiable, pero sin horarios ni precios realistas; los sandboxes de otras aerolíneas no tienen garantías de comportamiento. |
| [LiteAPI (Nuitee Connect)](https://docs.liteapi.travel/docs/faq) | Hoteles | Cuenta gratuita con clave sandbox en el perfil; flujo búsqueda, prebook y reserva, más cancelación; 5 solicitudes por segundo en sandbox. Documenta también APIs de vuelos y experiencias, a evaluar. |
| Amadeus Self-Service | Descartado | [Dejó de operar el 17 de julio de 2026](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers); solo sigue Enterprise, por contrato. |

Queda por verificar que el registro en Duffel y LiteAPI funcione desde Venezuela.

### Convenciones y manejo de errores

- Errores en formato Problem Details (RFC 9457) con un código de aplicación estable, por ejemplo `AVAILABILITY_EXHAUSTED` o `HOLD_EXPIRED`.
- Los `POST` de reserva y pago exigen un encabezado `Idempotency-Key` para evitar duplicados por reintentos.
- Validación de entrada con esquemas Zod compartidos entre frontend y API.
- Paginación por cursor y filtros explícitos en los listados.
- Llamadas a proveedores externos con tiempo máximo de 5 segundos, un reintento y circuit breaker; si un proveedor falla, el catálogo sigue mostrando el inventario propio.
- Las credenciales de proveedores se guardan solo en variables de entorno del servidor.

## 8. Diseño de componentes

La API es un monolito modular: cada módulo de NestJS tiene una responsabilidad única y solo se comunica con otros módulos a través de servicios exportados.

| Módulo | Responsabilidad | Entradas → salidas | Depende de |
| --- | --- | --- | --- |
| `AuthModule` | Integrar Better Auth con NestJS: montar sus rutas, leer la sesión y proteger las rutas con guards | Credenciales → sesión en cookie | Better Auth, PostgreSQL |
| `TenantModule` | Resolver el tenant de cada solicitud (organización activa o dominio) y aplicar RLS | Sesión o dominio → contexto de tenant | `AuthModule` |
| `UsersModule` | Perfiles, proveedores, invitaciones y asignación de roles mediante el plugin Organization | Invitación o cambio de rol → membresía | `TenantModule` |
| `CatalogModule` | Productos, destinos, disponibilidad y políticas | Filtros de búsqueda → página de productos | `InventoryModule` |
| `InventoryModule` | Orquestar los adaptadores `InventoryProvider` | Criterios → ofertas normalizadas | Adaptadores de proveedores |
| `BookingModule` | Crear reservas, retener cupo, expirar y cancelar | Producto y fechas → reserva con `expires_at` | `CatalogModule`, `ExchangeRateModule` |
| `PaymentModule` | Registrar pagos, aprobar o rechazar y reembolsar | Referencia de pago → pago con tasa congelada | `BookingModule`, `ExchangeRateModule` |
| `ExchangeRateModule` | Obtener, cachear y sobrescribir la tasa BCV | Fecha → tasa | `ExchangeRateProvider`, Redis |
| `DocumentModule` | Generar voucher y comprobante en PDF con numeración correlativa | Reserva → PDF | `BookingModule`, `InvoiceProvider` |
| `NotificationModule` | Enviar correos transaccionales | Evento → mensaje enviado | BullMQ |
| `AuditModule` | Registrar acciones sensibles de forma inmutable | Acción, antes y después → fila de auditoría | Todos (por interceptor) |
| `ReportModule` | Ventas, reservas y pagos por período | Rango de fechas → agregados | `BookingModule`, `PaymentModule` |
| `JobsModule` | Trabajos en segundo plano: expirar reservas, refrescar tasa, generar PDF, enviar correo | Evento programado → efecto | BullMQ, Redis |

### Lógica crítica: reservar cupo sin sobreventa

Crear una reserva abre una transacción de base de datos que bloquea la fila de `availability` con `SELECT ... FOR UPDATE`, comprueba que `reserved + quantity` no supere `capacity`, incrementa `reserved` y crea la reserva con su `expires_at`. Si la reserva expira o se cancela, otra transacción devuelve el cupo. Una prueba automatizada lanza reservas concurrentes sobre el mismo cupo para demostrar que no hay sobreventa.

### Selección de tasa al pagar

El módulo de pagos pide la tasa del día al módulo de tasas, que responde desde caché, desde la fuente primaria o desde el respaldo. El pago guarda el identificador de esa tasa y el monto en VES calculado, y no vuelve a consultarlas.

## 9. Diseño de la interfaz de usuario

Hay dos aplicaciones de interfaz: una web pública mobile-first con shadcn/ui y Tailwind, y un panel administrativo con Ant Design; ambas consumen la misma API.

### Pantallas clave

| App | Pantalla | Propósito |
| --- | --- | --- |
| Web | Inicio y buscador | Buscar por destino, fechas, personas y tipo de producto |
| Web | Resultados | Lista filtrable y ordenable, con precio en USD y equivalente en VES |
| Web | Detalle de producto | Galería, descripción, disponibilidad por fecha y política de cancelación |
| Web | Checkout | Datos del viajero, resumen y selector de moneda USD o VES |
| Web | Pago | Método simulado, referencia y cuenta regresiva de la retención |
| Web | Confirmación | Estado de la reserva y descarga de voucher y comprobante |
| Web | Mis reservas | Historial, detalle y cancelación; disponible sin conexión |
| Admin | Panel de control | Ventas, reservas y pagos pendientes de revisión |
| Admin | Productos e inventario | Alta, edición, disponibilidad y precios |
| Admin | Reservas y pagos | Tablas con filtros; aprobar o rechazar pagos |
| Admin | Tasas de cambio | Tasa vigente, historial y ajuste manual |
| Admin | Usuarios y roles | Alta y asignación de roles |
| Admin | Auditoría y reportes | Rastro de acciones y reportes de ventas |

### PWA

- Manifiesto y service worker (Serwist) para instalación en el dispositivo.
- Estrategia de caché: primero caché para recursos estáticos y primero red para la API.
- Sin conexión se pueden ver las reservas y los vouchers ya consultados; crear reservas y pagar exige conexión y la interfaz lo indica.

### Internacionalización

Español es el idioma por defecto e inglés el segundo, con `next-intl` y rutas por idioma (`/es`, `/en`). Los contenidos del catálogo usan los campos JSONB `es` y `en` de la sección 5. Las fechas, los números y las monedas se formatean con `Intl` según el idioma.

### Accesibilidad y diseño

- Meta WCAG 2.1 nivel AA: contraste, navegación por teclado, etiquetas en formularios y mensajes de error asociados a cada campo.
- Los componentes de shadcn/ui usan Radix, que ya resuelve gran parte del foco y de los roles ARIA.
- Tema claro y oscuro; los colores no son el único portador de significado.

Los wireframes de las pantallas clave quedan como entregable de la fase 0 (sección 13).

## 10. Seguridad

La seguridad se diseña a partir del OWASP Top 10, con el control de acceso y el aislamiento entre tenants como prioridad, porque un fallo ahí expone reservas y datos personales de otros usuarios.

### Autenticación y autorización con Better Auth

Better Auth es la única fuente de identidad: corre dentro de la API de NestJS, guarda usuarios y sesiones en PostgreSQL y reemplaza los tokens JWT propios del diseño inicial.

| Rol | Cómo se representa | Permisos clave |
| --- | --- | --- |
| Cliente | Usuario sin membresía en una agencia | Ver y cancelar sus reservas y descargar sus documentos |
| Agente | Miembro de la organización con rol `agent` | Crear y consultar reservas de la agencia; ver pagos |
| Proveedor | Miembro con rol `provider` | Crear y editar sus productos y su disponibilidad; ver sus reservas |
| Admin de agencia | Miembro con rol `owner` o `admin` | Gestionar su agencia: catálogo, reservas, pagos, tasas, usuarios y auditoría |
| Super Admin | Rol `super_admin` del plugin Admin, a nivel de plataforma | Crear agencias y supervisar la plataforma |

- **Plugins.** Organization (agencias, miembros, invitaciones y roles con control de acceso), Admin (rol de plataforma y bloqueo de usuarios) y Two-Factor (TOTP).
- **Permisos.** Se definen como pares de recurso y acción (`product`, `booking`, `payment`, `exchange-rate`, `report` y `audit`) asignados a cada rol; que un proveedor solo toque sus productos se verifica además en el servicio.
- **Integración con NestJS.** Usa la librería comunitaria `@thallesp/nestjs-better-auth`: exige desactivar el analizador de cuerpo integrado y registra un guard global, de modo que toda ruta pide sesión salvo las marcadas como públicas.
- **Sesiones.** Son cookies con registro en la base de datos, revocables desde el panel; Redis puede servir como almacenamiento secundario para acelerar su lectura.
- **Segundo factor.** El TOTP, un código temporal de una app autenticadora, es obligatorio para Admin de agencia y Super Admin.
- **Cookie de primera parte.** Las apps Next.js reenvían `/api/*` a la API, de modo que la cookie de sesión es del mismo sitio y se mantiene `SameSite=Lax`.

### Amenazas y controles

| Amenaza (OWASP Top 10) | Control en el diseño |
| --- | --- |
| Control de acceso roto | Control de acceso de Better Auth Organization por roles y permisos, guards en cada endpoint, Row-Level Security por `tenant_id` y verificación de propiedad en recursos del proveedor y del cliente; pruebas de autorización por rol. |
| Fallos criptográficos | Contraseñas con scrypt, el algoritmo por defecto de Better Auth; TLS en todo el tráfico, secretos solo en variables de entorno y sin números de tarjeta ni CVV almacenados. |
| Inyección | Consultas parametrizadas con Prisma, validación de entrada con Zod y escape de salida en el frontend. |
| Diseño inseguro | Modelo de amenazas por flujo (reserva, pago, aprobación), límites de negocio como la retención de cupo y las claves de idempotencia. |
| Configuración incorrecta | Helmet, Content Security Policy, CORS y `trustedOrigins` de Better Auth limitados a los orígenes propios, y cookies seguras con `HttpOnly`, `Secure` y `SameSite=Lax`. |
| Componentes vulnerables | `npm audit` y Dependabot en CI, y lockfile fijado. |
| Fallos de autenticación | Sesiones en PostgreSQL con cookie firmada, expiración deslizante y revocación desde el panel; segundo factor obligatorio para roles administrativos; verificación de correo y restablecimiento de contraseña; límite de intentos de Better Auth en registro e inicio de sesión. |
| Fallos de integridad | Montos calculados siempre en el servidor, nunca tomados del cliente; la tasa y el total se recalculan al pagar. |
| Registro y monitoreo insuficientes | Auditoría inmutable de acciones sensibles y registros estructurados con identificador de solicitud. |
| Falsificación de solicitudes del lado del servidor | Lista de destinos permitidos para las llamadas a proveedores externos. |

### Medidas transversales

- Limitación de tasa: la integrada de Better Auth en sus rutas y, en el resto de la API, `@nestjs/throttler`, más estricta en login, registro y pagos.
- Minimización de datos personales: solo los campos necesarios para viajar; documento de identidad cifrado en reposo.
- Separación de entornos y de claves entre desarrollo, pruebas y demostración pública.
- Revisión con OWASP ZAP baseline antes de publicar la demostración.

## 11. Rendimiento y escalabilidad

El rendimiento se logra sirviendo el catálogo casi estático, cacheando lo que cambia poco y evitando trabajo pesado en la ruta de la solicitud; las metas numéricas están en la sección 2.

### Técnicas

| Técnica | Dónde | Efecto esperado |
| --- | --- | --- |
| ISR y SSR en páginas de catálogo | Web pública | HTML listo para SEO y primera carga rápida |
| Caché Redis de búsquedas (TTL de 60 s) y de la tasa (TTL de 1 h) | API | Menos consultas a la base de datos y a DolarAPI |
| Índices compuestos en `products (tenant_id, type, destination_id, status)` y `availability (product_id, starts_on)` | PostgreSQL | Búsquedas y calendarios sin escaneo completo |
| Paginación por cursor | API | Costo estable en listados grandes |
| `select` explícito y carga controlada de relaciones en Prisma | API | Evita consultas N+1 |
| Trabajos asíncronos para PDF y correo | BullMQ | Respuesta de la API sin esperar tareas lentas |
| Imágenes con `next/image` en AVIF o WebP y carga diferida | Web pública | Menos bytes en móvil |
| Ant Design solo en `apps/admin` | Monorepo | El bundle público no carga la librería del panel |
| Service worker con caché de recursos estáticos | PWA | Recargas casi instantáneas |

### Presupuestos y pruebas

- Presupuesto de JavaScript inicial de la web pública: 170 KB comprimidos como punto de partida, ajustable al medir.
- Lighthouse CI en cada pull request, con fallo del pipeline si cae de 90 en rendimiento.
- Pruebas de carga con k6: escenario de búsqueda con 50 usuarios virtuales y de reserva con 20, ejecutadas antes de cada versión.
- Prueba de concurrencia sobre el mismo cupo, descrita en la sección 8.

### Escalabilidad

El monolito modular escala primero en vertical y con réplicas sin estado detrás de un balanceador, porque la sesión vive en tokens y la caché en Redis. Si un módulo lo exige, por ejemplo `InventoryModule` o `DocumentModule`, se puede extraer a un servicio aparte sin cambiar sus interfaces. Con `tenant_id` y RLS ya presentes, pasar a varios tenants no exige cambiar el modelo.

## 12. Voucher y comprobante de reserva

El MVP emite dos PDF no fiscales, un voucher de reserva y un comprobante de pago en formato libre, y deja la emisión fiscal detrás de la interfaz `InvoiceProvider` porque la normativa está en transición.

### Contexto normativo (consultado el 9 de noviembre de 2026)

- El 12 de agosto de 2026 la Providencia SNAT/2026/00084 [deroga el régimen que exigía homologar los sistemas de facturación](https://www.pwc.com/ve/es/assets/documentos/stl/NAC-SENIAT-Resoluciones-20260814-2026.pdf) (Providencia SNAT/2024/000121); según PwC Venezuela, no fija un régimen sustituto inmediato.
- El 21 de octubre de 2026 la Providencia SNAT/2026/00093 (Gaceta Oficial 43.484) [levanta la obligatoriedad de las máquinas fiscales](https://finanzasdigital.com/seniat-levanta-uso-obligatorio-maquinas-fiscales-gaceta-oficial/): el contribuyente elige entre medios digitales o electrónicos, como el portal y la app gratuitos del SENIAT, imprentas digitales y proveedores autorizados, o máquinas fiscales.
- La misma fuente indica un plazo de 180 días continuos desde su publicación, con entrada en vigor prevista para abril de 2027, y que el medio elegido no exime de datos fiscales, numeración, fecha, descripción e impuestos.

Por eso el sistema no emite documentos fiscales: cada PDF lleva la leyenda visible "Documento no fiscal". Esto no es asesoría tributaria; un uso comercial real requeriría validación con un contador.

### Voucher de reserva

- Código de reserva y código QR que enlaza a la reserva.
- Datos del viajero, producto, fechas, proveedor y cantidad.
- Política de cancelación aplicable, tomada del `policy_snapshot` de la reserva.
- Instrucciones de uso y datos de contacto de la agencia.

### Comprobante de pago

- Número correlativo por tenant y fecha de emisión.
- Emisor: razón social y RIF configurables por tenant.
- Cliente: nombre y, de forma opcional, cédula o RIF.
- Líneas con descripción, cantidad y monto en USD.
- Tasa BCV aplicada, su fecha valor y el monto total en VES.
- Impuestos como líneas configurables, desactivadas por defecto.
- Método de pago, referencia y estado.

### Interfaz `InvoiceProvider`

El método `issue(booking, payment)` devuelve el número, la URL del archivo y la fecha de emisión. `FreeFormReceiptProvider` es la única implementación del MVP. Un futuro `ImprentaDigitalProvider` podría enviar el documento a una imprenta digital autorizada o al SENIAT mediante su API, sin cambiar `BookingModule` ni `PaymentModule`.

## 13. Plan de entrega y riesgos

El MVP se entrega en seis fases con una puerta de salida cada una, de modo que cada fase deja algo demostrable y los productos finales, vuelos y paquetes, se pueden recortar sin romper lo anterior.

Pendiente: las horas semanales y la fecha objetivo del desarrollador; con ellas se asignan duraciones a cada fase.

### Fases y puertas de salida

| Fase | Entregable | Puerta de salida |
| --- | --- | --- |
| F0. Fundaciones | Monorepo, CI, Better Auth con organizaciones y roles, `tenant_id` y RLS, i18n y wireframes | Inicio de sesión por rol funcionando y pipeline en verde |
| F1. Hoteles de punta a punta | Catálogo, disponibilidad, reserva con retención, pago simulado y voucher | Una reserva completa en USD y VES, sin sobreventa en la prueba de concurrencia |
| F2. Panel y tasas | Panel Ant Design, aprobación de pagos, tasa BCV con respaldo y ajuste manual, auditoría y reportes | Un administrador aprueba un pago y queda auditado |
| F3. Tours y paquetes | Segundo y tercer tipo de producto sobre el modelo unificado | Un paquete de hotel y tour se reserva y se paga |
| F4. Vuelos y adaptadores | Vuelos con inventario propio; `DuffelProvider` y `LiteApiProvider` en sandbox | Búsqueda desde una fuente externa con respaldo en inventario propio |
| F5. PWA, seguridad y rendimiento | PWA, endurecimiento, ZAP, k6, Lighthouse CI y demostración pública | Metas de la sección 2 cumplidas y demostración publicada |

### Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Alcance excesivo para un solo desarrollador | Fases con puertas; vuelos y paquetes son lo primero que se recorta; modelo de producto unificado |
| Sandboxes externos inestables | Usar Duffel Airways para un flujo fiable y mantener inventario propio como respaldo |
| Caída de la fuente de tasa | Última tasa guardada y ajuste manual del administrador |
| Cambios en la normativa fiscal | Comprobante no fiscal detrás de `InvoiceProvider` |
| Complejidad multi-tenant | RLS desde la fase 0 y pruebas de aislamiento entre tenants |
| Arranque en frío en planes gratuitos | Aviso en la demostración y una petición programada que mantenga activa la API |
| Dos sistemas de diseño | Panel y web en aplicaciones separadas, sin componentes compartidos |

### Hoja de ruta

El siguiente diagrama muestra el orden de las fases y sus puertas.

&#91;embedded content: hoja de ruta · 6 fases, 6 puertas de salida\]

Cada fase deja algo demostrable; si el tiempo no alcanza, se recortan primero las fases con línea punteada.

## 14. Suposiciones y dependencias

El diseño descansa en las siguientes suposiciones y servicios de terceros; las que fallen tienen un plan alterno.

| Tipo | Elemento | Si falla |
| --- | --- | --- |
| Equipo | Un solo desarrollador; horas semanales y fecha objetivo aún sin definir | El plan de la sección 13 se reordena por fases y se recortan productos |
| Presupuesto | Planes gratuitos de hosting, base de datos y Redis | Arranques en frío y límites de uso; la demostración lo avisa |
| Tasa de cambio | DolarAPI disponible y sin autenticación | Se usa la última tasa guardada y el ajuste manual del administrador |
| Vuelos | Duffel en modo de prueba accesible desde Venezuela (sin verificar) | Vuelos con inventario propio, sin adaptador |
| Hoteles | LiteAPI en sandbox accesible desde Venezuela (sin verificar) | Hoteles con inventario propio, sin adaptador |
| Proveedores descartados | Amadeus Self-Service ya no opera | No aplica; no hay dependencia |
| Normativa | Reglas de facturación del SENIAT en transición hasta abril de 2027 | El comprobante sigue siendo no fiscal; se agrega un `InvoiceProvider` nuevo |
| Pagos | Todos los pagos son simulados y no se validan | Si se conectara una pasarela real, se implementa un `PaymentProvider` nuevo |
| Legal | Sin revisión legal ni fiscal por ser un proyecto de portafolio | Se requiere asesoría antes de cualquier uso comercial |
| Conectividad | Usuarios con conexiones inestables | La PWA cubre lectura sin conexión; reservar exige red |
| Navegadores | Versiones recientes de Chrome, Safari, Firefox y Edge | Se degrada sin PWA ni service worker |
| Tecnología | Node.js LTS, PostgreSQL, Redis y Docker disponibles | Se sustituye por servicios gestionados |
| Dependencia | Better Auth y su integración comunitaria para NestJS | Se monta el handler oficial de Better Auth directamente en NestJS, sin la librería comunitaria |

## 15. Glosario

| Término | Definición |
| --- | --- |
| OTA | Online Travel Agency: agencia de viajes que vende productos turísticos por internet. |
| SDD | Software Design Document: plano técnico del sistema antes de su desarrollo. |
| MVP | Producto mínimo viable: primera versión funcional con el alcance recortado. |
| BCV | Banco Central de Venezuela; publica la tasa oficial de cambio. |
| VES | Bolívar venezolano, moneda local. |
| Fecha valor | Día en que una tasa oficial rige legalmente. |
| Pago Móvil | Transferencia interbancaria venezolana entre teléfonos, persona a persona (P2P). |
| C2P | Cobro de comercio a persona dentro de Pago Móvil. |
| Zelle | Servicio de transferencias en USD entre cuentas bancarias de Estados Unidos. |
| Binance Pay | Pagos en criptoactivos, como USDT, dentro de Binance. |
| IGTF | Impuesto a las Grandes Transacciones Financieras, aplicable a ciertos pagos en divisas. |
| SENIAT | Servicio Nacional Integrado de Administración Aduanera y Tributaria. |
| RIF | Registro de Información Fiscal. |
| Imprenta digital | Proveedor autorizado por el SENIAT para validar y numerar documentos fiscales digitales. |
| Tenant | Agencia o cliente de la plataforma con sus propios datos y configuración. |
| Multi-tenant | Arquitectura en que una misma instalación sirve a varios tenants con sus datos aislados. |
| RLS | Row-Level Security: filtro de filas que aplica PostgreSQL por política. |
| RBAC | Control de acceso basado en roles. |
| Hold (retención) | Bloqueo temporal de cupo mientras el cliente completa el pago. |
| Snapshot | Copia congelada de un valor, como la tasa o la política de cancelación, al momento de la compra. |
| Puerto y adaptador | Patrón que aísla un servicio externo detrás de una interfaz propia. |
| Sandbox | Entorno de pruebas de un proveedor, sin dinero ni reservas reales. |
| GDS / NDC | Sistemas de distribución de vuelos: el tradicional (GDS) y el estándar directo de aerolíneas (NDC). |
| PWA | Progressive Web App: web instalable con capacidades sin conexión. |
| SSR / ISR | Renderizado en servidor / regeneración incremental de páginas estáticas. |
| LCP | Largest Contentful Paint: tiempo hasta mostrar el elemento principal de la página. |
| p95 | Valor por debajo del cual queda el 95 % de las mediciones. |
| Better Auth | Librería de autenticación y autorización para TypeScript, con plugins de organizaciones, administración y segundo factor (TOTP). |
| CSP | Content Security Policy: cabecera que limita qué recursos puede cargar una página. |
| OWASP | Organización que publica el OWASP Top 10, lista de riesgos de seguridad web. |
| Idempotencia | Propiedad por la que repetir una solicitud no repite su efecto. |
