# Tareas: orphan-notification-jobs

Una tarea a la vez, tests primero y un commit por tarea. Antes de cada commit: `pnpm lint`,
`pnpm typecheck` y `pnpm test` en verde. Los commits de spec van aparte (`docs(spec): ...`).

## 1. Spec

- [x] T-ONJ-1 Redactar el delta de `notifications` con el requisito «Aviso con reserva desaparecida» y
  sus tres escenarios, más proposal y design. Prueba: escenarios «Reserva borrada antes del envío»,
  «Sin reencolado por el barrido» y «Reserva viva envía con normalidad» del delta de esta change.

## 2. API

- [x] T-ONJ-2 Añadir primero el test e2e que borra la reserva de un aviso `PENDING` antes de enviarlo y
  comprueba `FAILED`, un solo intento, `lastError` y cero llamadas al proveedor; después cambiar
  `freeze()` a resultado discriminado y `sendWithRetries()` para cerrarlo de forma terminal.
  Prueba: «Reserva borrada antes del envío» y «Reserva viva envía con normalidad».

- [x] T-ONJ-3 Comprobar que un aviso ya `FAILED` no vuelve a encolarse con `recoverStalePending()`;
  el barrido no cambia, solo se verifica el efecto. Prueba: «Sin reencolado por el barrido».

## 3. Verificación

- [x] T-ONJ-4 `node scripts/check-specs.mjs`, `openspec validate orphan-notification-jobs --strict`,
  `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde (46 archivos, 623 pruebas). `openspec validate
  --all` sigue fallando solo por los errores preexistentes de `f1-hotels-e2e`. Prueba: salida en verde
  de los cinco comandos y `git push` de los commits.

## Workflow follow-up
- Solicitar revisión del dueño y sincronizar/archivar la change cuando todos los escenarios tengan test.
