# Verificación: catalog-public-cancellation-policy

- **Fecha:** 2026-11-21.
- **Alcance:** contrato público de detalle de producto en `apps/api`.
- **Evidencia:** tareas T-CANC-0…T-CANC-3 marcadas y commit `6bb49b9`.

| Escenario | Evidencia |
| --- | --- |
| Detalle con política | `apps/api/test/` › caso e2e «Detalle con política» (T-CANC-2). |
| Detalle sin política | `apps/api/test/` › caso e2e «Detalle sin política» (T-CANC-2). |
| Producto no público | `apps/api/test/` › caso e2e «Producto no público» (T-CANC-2). |
| Política de otro producto | Contrato filtrado por `productId` en el servicio de detalle (T-CANC-2). |
| Reglas corruptas no se exponen | `apps/api/test/` › caso e2e «Reglas corruptas no se exponen» (T-CANC-2). |
| Sin acceso directo a la tabla | `database.test.ts` › «Sin acceso directo a la tabla» (T-CANC-1). |
| Lectura pública de la política | `database.test.ts` › «Lectura pública de la política» (T-CANC-1). |

## Comandos

| Comando | Resultado |
| --- | --- |
| `node scripts/check-specs.mjs` | Verde. |
| `pnpm lint` | Verde. |
| `pnpm typecheck` | Verde. |
| `pnpm test` | Verde. |

Sin cambios en `apps/admin` y sin `any` nuevo.
