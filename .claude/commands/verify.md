---
description: Verifica una change contra su spec (usar en conversación limpia)
argument-hint: <nombre-de-la-change>
---
Verifica la change `$ARGUMENTS` sin modificar código.

1. Lee `openspec/changes/$ARGUMENTS/` (proposal, design, tasks, specs delta) y las specs base de `openspec/specs/` que toca.
2. Delega la comparación al subagente `spec-reviewer` y la revisión de riesgos al subagente `security-reviewer`.
3. Ejecuta `pnpm lint`, `pnpm typecheck` y `pnpm test` y reporta el resultado real, no lo supuesto.
4. Entrega un informe por criticidad (🔴 incumple la spec, 🟡 cubierto a medias, 🟢 cumple) con, por cada escenario
   GIVEN/WHEN/THEN, el archivo y el test que lo cubre. Un escenario sin test es 🔴.
5. No marques nada como terminado y no corrijas: solo informa. Guarda el informe en `docs/plans/verify-$ARGUMENTS.md`.
