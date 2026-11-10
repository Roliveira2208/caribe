# Constitución del proyecto

Principios que ninguna spec, plan ni tarea puede violar. Si una spec los contradice, se corrige la spec. Cada principio indica de qué sección del SDD sale.

## I. Calidad y alcance

1. **La spec manda.** No se escribe código sin una spec aprobada para esa funcionalidad. Los cambios de comportamiento se hacen primero en la spec. (SDD §3, método)
2. **Fuera de alcance es fuera de alcance.** Cobros reales, conciliación bancaria, facturación fiscal homologada, app nativa y emisión real de boletos están excluidos. (SDD §1)
3. **Ambigüedad = pregunta.** Si falta una regla de negocio, se marca `[NEEDS CLARIFICATION]` y se pregunta; el agente no rellena el hueco por su cuenta.
4. **Pequeño y verificable.** Cada tarea cabe en un commit y tiene un criterio de aceptación comprobable.

## II. Dinero y tasa de cambio

5. Los montos se guardan como `DECIMAL` (14,2) y las tasas como `DECIMAL` (18,4). Prohibido `float`/`number` para dinero en el servidor. (SDD §5)
6. El catálogo, la disponibilidad y los totales viven en **USD**. El VES es siempre derivado. (SDD §6)
7. La tasa BCV se congela **en el pago**: `payments` guarda `amount_usd`, `amount_ves` y `exchange_rate_id`; ese trío no se modifica. (SDD §6)
8. Los reembolsos usan la tasa congelada del día del pago; el porcentaje lo fija la política de cancelación de la agencia. (SDD §6, comentario del dueño)
9. El servidor calcula y recalcula todo monto; nunca confía en importes que envíe el cliente. (SDD §10)

## III. Datos y multi-tenant

10. Toda tabla de negocio lleva `tenant_id` y Row-Level Security. `tenant_id` referencia `organization.id` de Better Auth. (SDD §3 D3, §5)
11. Reservar cupo ocurre en una transacción con `SELECT ... FOR UPDATE`; `reserved` nunca supera `capacity`. (SDD §8)
12. Los textos de catálogo son JSONB con claves `es` y `en`. Borrado lógico en productos y usuarios; `audit_logs` es inmutable. (SDD §5)
13. Las migraciones aplicadas no se editan: se crea una nueva.

## IV. Seguridad

14. La identidad la gestiona **Better Auth**. No se escribe JWT propio, hashing propio ni manejo propio de sesiones. (SDD §10, D15)
15. Todo endpoint exige sesión salvo los marcados explícitamente públicos; los permisos se verifican por recurso y acción, y la propiedad del recurso se verifica en el servicio.
16. El segundo factor (TOTP) es obligatorio para Admin de agencia y Super Admin.
17. Secretos solo en variables de entorno. Las llamadas a proveedores externos usan lista de destinos permitidos, tiempo máximo de 5 s, un reintento y circuit breaker.
18. No se almacenan números completos de tarjeta ni CVV.
19. Toda acción administrativa sobre pagos, tarifas y reservas se registra en `audit_logs` con actor, antes y después.

## V. Arquitectura

20. Monolito modular NestJS: los módulos se comunican por servicios exportados. Los servicios externos entran **solo** por interfaces (puertos) con adaptadores. (SDD §4, §7)
21. Los proveedores externos (Duffel, LiteAPI) funcionan **solo en sandbox**. Si fallan, el catálogo sigue mostrando inventario propio.
22. `apps/admin` (Ant Design) y `apps/web` (shadcn/ui) no comparten componentes de UI; comparten tipos y validaciones desde `packages/shared`.
23. Todo texto visible usa i18n (`es`, `en`).

## VI. Verificación

24. Una funcionalidad no está terminada hasta cumplir `docs/definition-of-done.md`.
25. Cada escenario GIVEN/WHEN/THEN de una spec se convierte en un test automatizado cuando es posible.
26. La verificación final la hace una conversación nueva y limpia contra la spec, no el agente que implementó. La IA puede equivocarse: lint, tipos y tests son el árbitro.
27. Metas medibles del SDD §2: LCP < 2,5 s, p95 API < 300 ms (búsqueda con caché) y < 600 ms (crear reserva), Lighthouse ≥ 90, WCAG 2.1 AA en reserva y pago, cobertura ≥ 70 % en reservas, tasas y pagos, cero hallazgos altos en ZAP.

## VII. Documentación y comprobantes

28. Todo PDF de comprobante lleva la leyenda visible "Documento no fiscal". La emisión fiscal futura entra por `InvoiceProvider`.
29. Cuando el código y la spec difieren, se corrige uno de los dos en el mismo cambio; nunca se deja la divergencia.

## Enmiendas

Cambiar un principio exige editar este archivo en su propio commit (`📝 docs(constitution): ...`) con el motivo. Los agentes no modifican la constitución sin que el dueño lo pida.
