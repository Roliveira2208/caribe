# Tareas: f1-hotels-e2e
Requiere `f0-foundations` archivada. Una tarea a la vez, un commit por tarea.

- [ ] T-F1-0 Endurecer el inventario de rutas (primera tarea, antes de tocar catálogo; análisis en
  `docs/plans/inventory-hardening-f0.md`).
  - Registro cerrado de rutas no administrativas: toda ruta fuera de `/admin`, `/organization` y
    `/two-factor` declarada en una lista explícita; un prefijo nuevo rompe el test.
  - Huérfanas en todas las declaraciones (plataforma incluidas) y en la allowlist.
  - Inventario de todos los métodos HTTP, no solo el primero.
  - Fallo explícito si un path contiene `:` hasta que la clasificación soporte patrones.
  - Justificación por entrada de la allowlist (lectura o self-service).
  - Prerrequisito de cualquier autenticación por token (API key, bearer, SSO, OAuth): política para
    rutas clasificadas sin sesión y espejo del inventario en Nest. Sin esto no se habilita ningún
    plugin de Better Auth.
  - Prueba: auth-access › "Ruta administrativa sin exigencia de segundo factor" (inventario Nest +
    Better Auth) y los casos nuevos del registro cerrado.
- [ ] T-F1-1 Migraciones de catálogo (`destinations`, `products` tipo hotel, `availability`, `cancellation_policies`) con RLS.
- [ ] T-F1-2 Esquema Zod de `attributes` para hotel en `packages/shared`.  Prueba: catalog › "Atributos inválidos".
- [ ] T-F1-3 `CatalogModule`: listado con filtros y cursor, detalle y disponibilidad.  Prueba: catalog › búsqueda y estados.
- [ ] T-F1-4 CRUD de hoteles para proveedor y admin (API).  Prueba: auth-access › Proveedor.
- [ ] T-F1-5 `ExchangeRateModule`: provider, caché, respaldo y override con auditoría.  Prueba: exchange-rates (todos).
- [ ] T-F1-6 Precio VES informativo en catálogo con la tasa vigente.  Prueba: catalog › "Sin tasa disponible".
- [ ] T-F1-7 `BookingModule`: crear reserva con retención e `Idempotency-Key`.  Prueba: booking › cupo, concurrencia, idempotencia.
- [ ] T-F1-7b Eliminar los stubs `TODO(F1)` de products/bookings creados en F0.  Prueba: auth-access › "Ruta protegida sin sesión", "Catálogo público" con los endpoints reales.
- [ ] T-F1-8 Trabajo de expiración de reservas.  Prueba: booking › "Vence sin pago", "Pago tardío".
- [ ] T-F1-9 `PaymentModule`: pago simulado, estados y modos AUTO/MANUAL, monto calculado en servidor.  Prueba: payments (creación y modo).
- [ ] T-F1-10 Cancelación y reembolso con `policy_snapshot` y tasa congelada.  Prueba: booking › Cancelación; payments › Reembolso.
- [ ] T-F1-11 `DocumentModule`: voucher y comprobante PDF, numeración correlativa, reintentos.  Prueba: documents (todos).
- [ ] T-F1-12 `NotificationModule` con correo de confirmación (SMTP local).
- [ ] T-F1-13 Web: buscador, resultados, detalle, checkout, pago y confirmación en es/en, accesibles por teclado.
- [ ] T-F1-14 Web: "Mis reservas" con cancelación y descarga de documentos.
- [ ] T-F1-15 Prueba e2e del flujo completo (Playwright) y prueba k6 de búsqueda y reserva.
- [ ] T-F1-16 Verificación: `/verify f1-hotels-e2e` en conversación limpia; `/security-review`; archivar.

## Notas heredadas de f0-foundations (siguen abiertas)

- **M1**: configurar `trustedProxies` al decidir el hosting; hoy la IP tras un proxy resuelve a null y
  el rate limit de login degenera en bucket global.
- **M2**: Helmet, CSP y CORS antes de cualquier demo pública (faseados en F5 por el SDD §13).
