# Change: catalog-public-cancellation-policy

## Por qué
La pantalla de detalle de F1 debe mostrar la política de cancelación, pero el contrato público
`GET /products/:id` no expone ese dato. Las reglas viven en `cancellation_policies` y solo se
congelan en `booking_items.policy_snapshot` al reservar, así que la web no puede mostrar la política
real sin una lectura pública explícita. Esta change cierra ese hueco sin inventar texto ni reglas.

## Qué cambia
- `GET /products/:id` pasa a incluir `cancellationPolicy` con `name` y `rules` cuando el producto
  publicado tiene una política asociada, o `null` cuando no la tiene.
- Las reglas se exponen en forma validada y camelCase (`hoursBefore`, `percentage`), ordenadas de
  mayor a menor horas. No se expone `id`, `tenantId`, JSONB crudo ni políticas de borradores.
- La lectura pasa por una función SQL de solo lectura con `SECURITY DEFINER`; las políticas siguen
  sin ser visibles mediante una consulta directa en el contexto público.

## Impacto en specs
Delta de `catalog` con un requisito nuevo y cinco escenarios. Sin cambios en `booking`, `payments`
ni `documents`: el snapshot congelado de la reserva conserva su comportamiento actual.

## Preguntas abiertas
- Ninguna. El dueño aprobó el 2026-11-21 añadir un campo público de solo lectura en lugar de un texto
  genérico u omitir el bloque.

## Fuera de alcance
- Cambiar las reglas de cancelación, el cálculo de reembolsos ni el snapshot de la reserva.
- Exponer la política en `GET /products` (búsqueda) ni en el panel administrativo.
- Textos visibles, i18n de la web ni la pantalla de detalle: eso pertenece a `f1-visual-identity`.
