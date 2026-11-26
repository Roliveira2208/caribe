# Tareas: f2-admin-rates

Una tarea a la vez, tests primero y un commit por tarea. Las pausas son puertas de verificación, no
tareas de código. Los wireframes se aprueban antes de implementar su pantalla.

- [x] T-F2-0 Especificar la change: deltas, specs base nuevas, `scope.md` y ROADMAP. Prueba: `node scripts/check-specs.mjs` y `pnpm exec openspec validate --all` en verde.
- [x] T-F2-1 Generar y someter a aprobación `docs/wireframes/panel-tasas.svg`. Prueba: gate de aprobación del wireframe antes de T-F2-8.
- [x] T-F2-2 M1: configurar `trustedProxies`, resolver la IP real y corregir el rate limit de login. Prueba: `security › "IP tras proxy de confianza"`, `"Cabecera de proxy no confiable"` y `"Rate limit por IP real"`.
- [x] T-F2-3 M2: Helmet, CSP sin inline y CORS con `TRUSTED_ORIGINS`. Prueba: `security › "Cabeceras de seguridad en la API"`, `"CSP sin scripts inline"`, `"CORS con orígenes permitidos"` y `"CORS con origen desconocido"`.
- [x] T-F2-4 Rate limiting de rutas de negocio con 429 Problem Details. Prueba: `security › "Límite en creación de reservas"`, `"Límite en alta y revisión de pagos"` y `"Límite en descargas"`.
- [x] T-F2-5 Reembolso idempotente: `refundId`, registro atómico/outbox y reconciliación. Prueba: `security › "Reembolso idempotente"`, `"Rollback sin reembolso externo"` y `"Reconciliación de reembolsos"`.
- [x] T-F2-6 Paquete compartido de fuentes y `ConfigProvider` con tokens Caribe. Prueba: `admin-ui › "Tokens Caribe"`, `"Tipografía compartida"` y `"Cabecera del panel"`.
- [x] T-F2-7 Textos es/en y accesibilidad del shell del panel. Prueba: `admin-ui › "Textos es y en"` y `"Accesibilidad básica"`.
- [x] T-F2-8 Tasas: tasa vigente, validaciones y permisos. Prueba: `exchange-rates › "Ver tasa vigente"`, `"Override con motivo desde el panel"`, `"Sin segundo factor"`, `"Sin permiso de tasa"`, `"Campos calculados del cliente"` y `"Membresía revocada"`.
- [x] T-F2-9 Tasas: modal antes/después, ámbitos y auditoría. Prueba: `exchange-rates › "Confirmación de override vigente"`, `"Override de otra agencia"` y `"Auditoría del override"`.
- [x] T-F2-10 **PAUSA 1**: verificación independiente del override de tasa en sesión limpia. Prueba: todos los escenarios obligatorios de `exchange-rates` y `security` con evidencia; informe en `verify.md`.
- [x] T-F2-11 Pagos: listado, filtros, cursor y estados. Prueba: `payments › "Listado filtrable"`, `"Sin permiso de lectura de pagos"` y `"Pago de otra agencia"`.
- [x] T-F2-12 Pagos: aprobación, rechazo y concurrencia desde el panel. Prueba: `payments › "Aprobar con TOTP"`, `"Rechazo con motivo en el panel"`, `"Revisor distinto del pagador en la UI"`, `"Par congelado solo lectura"` y `"Revisión concurrente en la UI"`.
- [x] T-F2-13 **PAUSA 2**: verificación independiente y revisión de seguridad en sesión limpia antes de catálogo y usuarios. Prueba: escenarios obligatorios de `payments` y `security` con evidencia; informe en `verify.md`.
- [x] T-F2-14 Generar y someter a aprobación `docs/wireframes/panel-auditoria.svg`. Prueba: gate de aprobación antes de T-F2-15.
- [x] T-F2-15 Visor de auditoría con filtros, cursor y pestaña `auth-events`. Prueba: `audit › "Filtros y cursor"`, `"Pestaña de eventos de autenticación"`, `"Alcance del admin de agencia"`, `"Modo plataforma del Super Admin"`, `"Sin permiso de auditoría"` y `"Sin secretos ni mensajes internos"`.
- [x] T-F2-16 Auditoría de las acciones del panel. Prueba: `audit › "Auditoría del override de tasa"`, `"Auditoría de la revisión de pagos"` y `"Auditoría del cambio de rol"`.
- [x] T-F2-17 Generar y someter a aprobación `docs/wireframes/panel-catalogo.svg`. Prueba: gate de aprobación antes de T-F2-18.
- [x] T-F2-18 Catálogo: alta, edición, propiedad y estados. Prueba: `catalog › "Alta de producto en el panel"`, `"Edición de producto de la agencia"`, `"Proveedor edita solo sus productos"` y `"Publicar y archivar producto"`.
- [x] T-F2-19 Catálogo: disponibilidad, precios y traducciones. Prueba: `catalog › "Disponibilidad por noche"`, `"Lectura de disponibilidad del panel"`, `"Precio como texto decimal"` y `"Traducciones es y en"`.
- [x] T-F2-19a Corregir la propagación por `hotel_key`: un Proveedor no modifica productos de otro proveedor. Prueba: `catalog › "Proveedor edita solo sus productos"`.
- [x] T-F2-19b Alta de noches nuevas en el panel con el wireframe aprobado. Prueba: `catalog › "Disponibilidad por noche"`.
- [x] T-F2-19c Completar la trazabilidad y las aserciones pendientes del catálogo. Prueba: `catalog › "Publicar y archivar producto"` y `catalog › "Precio como texto decimal"`.
- [x] T-F2-19d **PAUSA 3**: verificación independiente del catálogo en sesión limpia. Prueba: los 8 escenarios obligatorios de `catalog` con evidencia; informe en `verify.md`.
- [x] T-F2-20 Generar y someter a aprobación `docs/wireframes/panel-usuarios-roles.svg`. Prueba: gate de aprobación antes de T-F2-21.
- [x] T-F2-21 Usuarios y roles sobre Better Auth. Prueba: `auth-access › "Invitar miembro con segundo factor"`, `"Cambiar rol de un miembro"`, `"Revocar sesión desde el panel"`, `"Organización objetivo ajena"`, `"Super Admin en modo plataforma"` y `"Operación sin agencia activa"`.
- [x] T-F2-22 Generar y someter a aprobación `docs/wireframes/panel-reportes.svg`. Prueba: gate de aprobación antes de T-F2-23.
- [ ] T-F2-23 Reporte de ventas `GET /admin/reports/sales`. Prueba: `reports › "Reporte por rango de fechas"`, `"Totales calculados en el servidor"`, `"Desglose por método y estado"`, `"Alcance por rol"` y `"Exportación CSV del reporte"`.
- [ ] T-F2-24 Matriz F1 en la UI: proveedor, `member` sin `booking:read` y Super Admin. Prueba: `admin-ui › "Matriz de permisos F1 en la UI"` y `"Sin datos negados por la API"`.
- [ ] T-F2-25 Escenarios deseables que quepan. Prueba: `exchange-rates › "Tasa global del Super Admin"`, `"Fecha valor futura"` y `"Historial de overrides"`; `payments › "Exportación CSV de pagos"`, `"Columnas configurables"`, `"Estado vacío"` y `"Estado de error"`; `audit › "Exportación CSV de auditoría"`; `admin-ui › "Selector de agencia en la cabecera"`, `"Bandera del modo de aprobación"` e `"Idioma persistido"`.
- [ ] T-F2-26 Verificación final en sesión limpia: cobertura, lint, typecheck, tests, `check-specs` e inventario de rutas sin sesión. Prueba: todos los escenarios obligatorios de `scope.md` mapeados en `verify.md` y DoD completo.
