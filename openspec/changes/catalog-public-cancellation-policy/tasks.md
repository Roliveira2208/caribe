# Tareas: catalog-public-cancellation-policy

Una tarea a la vez, tests primero y un commit por tarea. Antes de cada commit: `pnpm lint`,
`pnpm typecheck` y `pnpm test` en verde. Los commits de spec van aparte (`docs(spec): ...`).

## 1. Spec

- [x] T-CANC-0 Redactar proposal, design y el delta de `catalog` con el requisito «Política de
  cancelación pública». Prueba: los seis escenarios del delta de esta change y
  `node scripts/check-specs.mjs` en verde.

## 2. API

- [ ] T-CANC-1 Añadir la función SQL `public_cancellation_policy` con `SECURITY DEFINER`,
  `search_path` fijo, revoke a `PUBLIC` y grant a `caribe_app`; comprobarlo en
  `database.test.ts` sin relajar el RLS directo de `cancellation_policies`.
  Prueba: «Lectura pública de la política» y «Sin acceso directo a la tabla».

- [ ] T-CANC-2 Extender el contrato y el servicio de detalle con `cancellationPolicy` validado en
  camelCase; añadir los casos e2e de detalle con política, sin política, producto no público y
  reglas corruptas. Prueba: «Detalle con política», «Detalle sin política», «Producto no público» y
  «Reglas corruptas no se exponen».

## 3. Verificación

- [ ] T-CANC-3 `node scripts/check-specs.mjs`, `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde;
  sin cambios en `apps/admin` y sin `any` nuevo. Prueba: salida en verde de los cuatro comandos.
