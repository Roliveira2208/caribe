---
name: conventional-commits
description: Escribe mensajes de commit en formato Conventional Commits para este repo. Úsalo al hacer cualquier commit.
---
Formato: `tipo(ámbito): resumen en imperativo, máx. 72 caracteres`.

Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.
Ámbitos: `api`, `web`, `admin`, `shared`, `db`, `auth`, `booking`, `payments`, `rates`, `docs`, `spec`.

Reglas:
- Un commit por tarea de `tasks.md`; cita el id en el cuerpo: `Task: T-F1-7`.
- Cambios de spec van en su propio commit (`docs(spec): ...`) antes del código que los implementa.
- Cambio incompatible: `!` tras el tipo y párrafo `BREAKING CHANGE:`.
- Sin emojis en el título. No incluyas secretos ni datos personales.
