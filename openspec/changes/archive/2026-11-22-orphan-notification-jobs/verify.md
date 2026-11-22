# Verificación: orphan-notification-jobs

- **Fecha:** 2026-11-21.
- **Alcance:** trabajos de envío de avisos en `apps/api`.
- **Evidencia:** tareas T-ONJ-0…T-ONJ-4 marcadas y commit `fbe8a05`.

| Escenario | Evidencia |
| --- | --- |
| Reserva borrada antes del envío | `apps/api/test/` › e2e que borra la reserva de un aviso `PENDING` antes de enviarlo; comprueba `FAILED`, `attempts` 1, `lastError` y cero llamadas al proveedor (T-ONJ-2). |
| Sin reencolado por el barrido | Comprobación de `recoverStalePending()` sobre un aviso `FAILED` (T-ONJ-3). |
| Reserva viva envía con normalidad | `apps/api/test/` › e2e con proveedor simulado; aviso `SENT` (T-ONJ-2). |

## Comandos

| Comando | Resultado |
| --- | --- |
| `node scripts/check-specs.mjs` | Verde. |
| `openspec validate orphan-notification-jobs --strict` | Verde. |
| `pnpm lint` | Verde. |
| `pnpm typecheck` | Verde. |
| `pnpm test` | Verde: 46 archivos y 623 pruebas. |
