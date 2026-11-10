# Definition of Done

Una funcionalidad está terminada cuando **todas** las casillas aplicables están marcadas. Se copia al `verify.md` de cada funcionalidad.

## Spec y trazabilidad
- [ ] Cada escenario de `spec.md` tiene un test o una verificación manual documentada.
- [ ] Los casos límite de la spec están cubiertos.
- [ ] No hay `[NEEDS CLARIFICATION]` abiertos.
- [ ] Spec, plan y código no se contradicen; la spec se actualizó si el comportamiento cambió.
- [ ] Nada implementado cae en "Fuera de alcance".

## Calidad de código
- [ ] `pnpm lint` y `pnpm typecheck` sin errores.
- [ ] Tests unitarios y de integración en verde.
- [ ] Cobertura ≥ 70 % si la funcionalidad toca reservas, tasas o pagos.
- [ ] Sin `any` injustificados, sin `console.log` ni código muerto.
- [ ] Commits con Conventional Commits, uno por tarea.

## Dinero, datos y tenant (si aplica)
- [ ] Sin `float` para dinero; montos recalculados en el servidor.
- [ ] Tablas nuevas con `tenant_id`, RLS y prueba de aislamiento entre tenants.
- [ ] Migración nueva (no se editó una aplicada) y reversible o documentada.
- [ ] Operaciones de cupo dentro de transacción con bloqueo; prueba de concurrencia si toca disponibilidad.

## Seguridad
- [ ] Endpoints nuevos con guard y permiso por recurso y acción; prueba de autorización por rol.
- [ ] Propiedad del recurso verificada (cliente, proveedor, agencia).
- [ ] Entradas validadas con Zod; errores en Problem Details sin filtrar datos internos.
- [ ] Sin secretos en código, logs ni commits.
- [ ] Acciones administrativas sensibles registradas en `audit_logs`.
- [ ] Revisión de `security-reviewer` sin hallazgos altos.

## UI y experiencia (si aplica)
- [ ] Textos por i18n en `es` y `en`.
- [ ] Teclado y etiquetas accesibles; axe sin violaciones graves en reserva y pago.
- [ ] Móvil primero; estados vacío, cargando y error cubiertos.
- [ ] Precio en USD con equivalente en VES coherente con la tasa.

## Rendimiento (si aplica)
- [ ] Sin consultas N+1; índices necesarios creados.
- [ ] Lighthouse CI ≥ 90; LCP < 2,5 s en móvil.
- [ ] k6: p95 API dentro de metas (§2 del SDD).

## Verificación independiente
- [ ] `/verify` ejecutado en conversación nueva y `verify.md` guardado con semáforo.
- [ ] Todos los puntos rojos resueltos; los amarillos justificados por escrito.
- [ ] `openspec/ROADMAP.md` actualizado con el estado.
