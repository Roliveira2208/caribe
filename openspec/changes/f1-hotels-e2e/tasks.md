# Tareas: f1-hotels-e2e
Requiere `f0-foundations` archivada. Una tarea a la vez, un commit por tarea.

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
