@AGENTS.md

## Específico de Claude Code
- Usa el modo plan (`/plan`) antes de cualquier tarea con más de un archivo; guarda el plan en `docs/plans/`.
- Verifica en una conversación limpia con `/verify <change>` (usa el subagente `spec-reviewer`).
- Para revisión de seguridad usa `/security-review` y el subagente `security-reviewer`.
- Cuando el contexto pase del ~70 %, compacta o abre una conversación nueva y retoma desde `tasks.md`.
