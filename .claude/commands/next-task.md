---
description: Implementa la siguiente tarea pendiente de una change
argument-hint: <nombre-de-la-change>
---
Implementa UNA sola tarea de `openspec/changes/$ARGUMENTS/tasks.md`.

1. Lee `AGENTS.md`, la spec delta y `design.md` de la change; localiza la primera tarea sin `[x]`.
2. Si la tarea es ambigua o contradice el SDD, detente y pregunta.
3. Escribe primero los tests de los escenarios que nombra la tarea, luego el código mínimo para pasarlos.
4. Ejecuta lint, typecheck y los tests relacionados. Si fallan, arréglalo; no cambies el test para que pase.
5. Marca la tarea `[x]` y haz un commit (skill `conventional-commits`). No empieces la siguiente tarea.
