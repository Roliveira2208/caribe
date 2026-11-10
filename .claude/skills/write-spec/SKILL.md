---
name: write-spec
description: Redacta o revisa una spec con la plantilla mínima de 5 bloques y escenarios GIVEN/WHEN/THEN. Úsalo al crear o cambiar comportamiento.
---
Plantilla (ver `docs/templates/spec.md`): Purpose · Requirements con escenarios · Casos límite · Acceptance · Out of scope.

Reglas de redacción:
1. Describe el qué y el porqué, no el cómo. Nada de librerías ni endpoints internos salvo contratos públicos.
2. Escenarios verificables: GIVEN (estado), WHEN (acción), THEN (resultado observable, con códigos y estados).
3. Responde las preguntas incómodas: permisos, errores y reintentos, estados vacíos, límites, reglas de negocio.
4. No especifiques lo obvio: describe donde el agente improvisaría (casos raros, dinero, concurrencia).
5. Cada escenario debe poder convertirse en un test. Si no, reescríbelo.
6. Una spec que no cabe en una pantalla o dos se divide por dominio.
7. Cambios sobre una spec existente: usa delta (ADDED/MODIFIED/REMOVED Requirements) dentro de la change.
