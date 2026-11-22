# Diseño: catalog-public-cancellation-policy

## Contexto
`CatalogService.detail()` ya consulta un producto `PUBLISHED` y sin borrado en el contexto RLS
`public`. La tabla `cancellation_policies` solo tiene políticas `tenant` y `platform` (la prueba
`catalog.e2e.ts` verifica que el contexto `public` no las ve), así que un `LEFT JOIN` directo desde la
misma transacción no devolvería la política. La solución debe ampliar la lectura pública sin relajar
el RLS de la tabla.

## Decisiones

1. **Función de lectura, no política RLS nueva.** Se añade
   `public_cancellation_policy(p_product_id text)` como `SECURITY DEFINER`, `STABLE`, con
   `search_path = public, pg_temp`. La función hace `JOIN` de `products` con
   `cancellation_policies`, filtra `status = 'PUBLISHED'` y `deleted_at IS NULL`, y devuelve solo
   `name` y `rules`. Se revoca `EXECUTE` a `PUBLIC` y se concede solo a `caribe_app`, igual que
   `public_availability`.
   - Alternativa descartada: añadir una política `cancellation_policies_public`. Daría acceso
     directo a la tabla y rompería la garantía existente de que el contexto público no ve políticas.

2. **Solo en el detalle.** `GET /products/:id` añade `cancellationPolicy`; `GET /products` no cambia
   para no multiplicar consultas en la búsqueda ni ampliar la superficie pública sin necesidad. El
   tipo nuevo `CatalogProductDetail` extiende `CatalogProduct`; `CatalogOffer` queda intacto.

3. **Validación defensiva de reglas.** `rules` se valida con `cancellationRulesSchema` de
   `@caribe/shared` (1–10 reglas, horas enteras descendentes y porcentajes 0–100). El JSONB se
   proyecta como `{ hoursBefore, percentage }[]`; si no pasa la validación se devuelve `rules: []`,
   nunca el JSONB crudo. La base ya garantiza la forma con un trigger, pero la API no confía en eso.

4. **Sin identificadores internos.** La respuesta no incluye `policyId`, `tenantId`, `createdAt` ni
   `updatedAt`. El `name` se conserva porque es una etiqueta legible; la web decide cómo mostrarlo.

5. **Sin migración de Prisma.** El esquema relacional ya tiene la llave foránea y el trigger. Solo
   se versiona una migración SQL con la función y sus permisos; `schema.prisma` no cambia.

## Casos límite
- Producto sin política: `null`, nunca un objeto con reglas vacías.
- Reglas inválidas: lista vacía; nunca se inventa una regla por defecto.
- Búsqueda: sin cambios; el campo nuevo pertenece solo al detalle.

## Acceptance
- Todos los escenarios del requisito tienen prueba e2e o de base de datos.
- El contexto público sigue sin ver la tabla directamente.
- Lint, typecheck y tests del monorepo en verde.

## Impacto y verificación
- API: `catalog.schemas.ts` y `catalog.service.ts` en `apps/api`.
- Migración: `apps/api/prisma/migrations/<timestamp>_public_cancellation_policy/migration.sql`.
- Pruebas: `apps/api/test/database.test.ts` (función, `SECURITY DEFINER`, revoke/grant) y
  `apps/api/test/catalog.e2e.ts` (detalle con y sin política, 404 de no publicado, reglas
  inválidas y RLS directo intacto).
- Sin dependencias nuevas, sin cambios en `apps/admin` y sin textos visibles nuevos.
- Rollback: revertir el código y la migración; el detalle vuelve a su contrato anterior.
