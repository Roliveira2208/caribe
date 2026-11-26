# Change: f2-admin-rates

## Por qué

Fase F2 del SDD §13: «Panel Ant Design, aprobación de pagos, tasa BCV con respaldo y ajuste manual,
auditoría y reportes». F1 quedó cerrada con la API de override, revisión de pagos y auditoría ya
implementada, pero el panel sigue siendo mínimo y la identidad visual del admin no está alineada con
la web pública. El cierre de F1 además condicionó la demo pública a M1 (`trustedProxies`), M2
(Helmet/CSP/CORS), F-FINAL-002 (rate limiting en rutas de negocio) y F-FINAL-003 (reembolso no
idempotente con un proveedor real). El dueño decidió cerrar todas esas deudas en F2.

## Qué cambia

- Panel admin con Ant Design (D5 intacto) y tokens Caribe: `#0E2A3D`, `#F4A300`, `#1FA6A0`,
  `#FBF7EF`, con Clash Display y General Sans consumidas desde un paquete compartido.
- Pantalla de tasas con tasa vigente, origen, fecha valor y override con confirmación explícita
  (modal antes → después, motivo obligatorio) y auditoría con actor, antes/después e IP.
- Panel de pagos completo: filtros y cursor, aprobación/rechazo con segundo factor, revisor distinto
  del pagador, montos y tasa congelados en solo lectura, concurrencia 409, exportación y estados
  vacío/error.
- Visor de auditoría con filtros por acción, entidad, actor y rango, paginación por cursor y pestaña
  de eventos de autenticación, con el alcance por rol que ya define la spec `audit`.
- Gestión de catálogo, usuarios/roles (sobre las rutas existentes de Better Auth), reporte de ventas y
  listado de agencias de plataforma para poblar el filtro del reporte.
- Seguridad de red: IP real tras proxies de confianza, cabeceras Helmet/CSP, CORS restringido,
  límites en rutas de negocio y reembolsos con `refundId`/outbox y reconciliación.

## Impacto en specs

- Deltas `ADDED Requirements` en `exchange-rates`, `payments`, `audit`, `catalog` y `auth-access`;
  el nuevo requisito de `auth-access` cubre el listado de agencias para el filtro de reportes.
- Specs base nuevas creadas en esta change porque no existían: `admin-ui`, `reports` y `security`.
- Clasificación escenario por escenario y conteos en `scope.md`: **75 escenarios nuevos, 61
  obligatorios y 14 deseables**. Los 103 escenarios base de `exchange-rates` (31), `payments` (38) y
  `audit` (34) quedan como regresión.
- Se actualiza `openspec/ROADMAP.md` con los dominios nuevos y el estado de la change.

## Decisiones del dueño (2026-11-23)

1. Entran como obligatorios los cinco bloques pedidos: override de tasa, aprobación/rechazo de
   pagos, catálogo, usuarios/roles y auditoría, **más reportes**.
2. Al pisar un override vigente se muestra un modal con antes → después y motivo; cancelar no escribe.
3. La tipografía se comparte desde un paquete del workspace; no se copia en cada app.
4. M1, M2, F-FINAL-002 y F-FINAL-003 se cierran en F2, antes de la demo pública.
5. La disponibilidad necesita escritura desde el panel: se añade una ruta de escritura nueva con su
   clasificación en el inventario, porque hoy solo existe la lectura pública.
6. `en` es obligatorio en `title` y `description` del panel: la API refuerza Zod y responde 422 si
   falta, sin depender del fallback de lectura a `es`.
7. El filtro de agencia del reporte se puebla con `GET /admin/organizations`, lectura de plataforma
   con su scenario en `auth-access`. `/api/auth/organization/list` solo devuelve membresías y el Super
   Admin no es miembro de todas las agencias, así que el selector quedaría vacío sin esta ruta.

## Preguntas abiertas

Estas se deciden antes de la tarea correspondiente; no se rellenan con suposiciones:

- Umbrales numéricos de rate limiting por ruta y ventana de tiempo.
- Direcciones IP o red de proxies de confianza según el hosting final (M1) y valor de
  `TRUSTED_ORIGINS` para CORS (M2).
- ~~Métricas exactas del reporte de ventas~~ **resuelta antes de T-F2-23**: totales USD y VES, CSV con
  desglose método/estado y totales, y todos los estados suman (incluidos rechazados y en revisión).
  El límite/idioma del CSV también quedó resuelto: sin límite en el MVP, `lang=es` por defecto.
- Nombre y ubicación del paquete compartido de fuentes (`packages/fonts` es la propuesta) y si
  `next/font/local` necesita configuración adicional de build para resolverlo desde el workspace.
- Si los límites de rate limiting aplican también a rutas públicas (`GET /products`,
  `GET /exchange-rates/current`) o solo a las autenticadas; el inventario de rutas sin sesión debe
  actualizarse con la respuesta.

## Fuera de alcance

- Conectar una pasarela de pago real: los pagos siguen simulados (D9). F-FINAL-003 se robustece con
  `refundId`/outbox sobre el proveedor simulado, sin introducir un proveedor externo.
- Tours, paquetes, vuelos, adaptadores Duffel/LiteAPI, PWA offline, OpenAPI/Swagger y k6 automatizado.
- Cambiar las decisiones D1–D15 del SDD, activar plugins de autenticación nuevos o añadir autenticación
  por token (API key, bearer, SSO, OAuth).
- Facturas fiscales: los comprobantes siguen llevando «Documento no fiscal» (D10).
