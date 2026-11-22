# Proposal: orphan-notification-jobs

## Why
En desarrollo aparecen avisos `PENDING` cuya reserva ya fue borrada por la limpieza de los e2e. Al
procesarlos, `sendWithRetries()` intenta congelar la reserva con `findFirstOrThrow()`, lanza, agota los
tres reintentos y el barrido de pendientes vuelve a encolarlos cada minuto. El resultado es un bucle de
`ERROR [JobsScheduler] El trabajo notifications.send falló` que ensucia los logs y consume la cola, sin
que exista ya nada que enviar. Implementa SDD §7 (convenciones de error), §8 (`NotificationModule` y
`JobsModule`) y la decisión D13.

## What Changes
- Si la reserva de un aviso `PENDING` ya no existe, el envío SHALL terminar en `FAILED` de forma
  definitiva: sin llamar al proveedor, sin los tres reintentos de SMTP y sin volver a encolarlo.
- El `lastError` SHALL indicar que la reserva no existe; la fila del aviso permanece para diagnóstico.
- El barrido de pendientes SHALL seguir reencolando solo avisos `PENDING`, por lo que un aviso ya
  `FAILED` no se reencola.
- Sin cambios de esquema, sin endpoints nuevos y sin textos visibles al usuario: el mensaje es un
  registro interno de error, no un correo ni una pantalla.

## Capabilities
### New Capabilities
Ninguna.

### Modified Capabilities
- `notifications`: nuevo requisito «Aviso con reserva desaparecida» con tres escenarios.

## Impact
- API: `NotificationService.freeze()` / `sendWithRetries()` en `apps/api`.
- Tests: un caso e2e en `notifications.e2e.ts` que borra la reserva antes de enviar y comprueba el
  estado `FAILED`, la ausencia de llamada al proveedor y el `lastError`.
- Sin dependencias nuevas, sin migración de base de datos y sin cambios en web ni admin.

## Preguntas abiertas
- Ninguna. El alcance se limita al caso terminal «la reserva ya no existe»; un aviso `PENDING` con
  reserva viva conserva el comportamiento actual de reintento con espera creciente.
