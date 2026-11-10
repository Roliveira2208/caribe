# Audit Specification

## Purpose
Rastro inmutable de acciones sensibles.

## Requirements

### Requirement: Registro de acciones sensibles
SHALL registrarse actor, acción, entidad, antes, después, IP y fecha para: aprobar o rechazar pagos,
fijar tasas, cancelar o reembolsar reservas, cambiar roles y revocar sesiones.

#### Scenario: Admin aprueba un pago
- WHEN un admin aprueba un pago
- THEN existe una fila de auditoría con el estado anterior y el nuevo

### Requirement: Inmutabilidad
Las filas de `audit_logs` SHALL NOT poder modificarse ni borrarse desde la aplicación.

#### Scenario: Intento de borrado
- WHEN el rol de la aplicación intenta `UPDATE` o `DELETE` sobre `audit_logs`
- THEN la base de datos lo rechaza

### Requirement: Consulta
Solo Admin de agencia y Super Admin SHALL poder consultar la auditoría de su alcance.

#### Scenario: Agente consulta auditoría
- WHEN un agente llama a `GET /admin/audit-logs`
- THEN 403

## Casos límite
- Si falla la escritura de auditoría, la acción sensible no se confirma (misma transacción).

## Acceptance
- Interceptor de NestJS probado con un endpoint de ejemplo; permisos de BD verificados en una migración.

## Out of scope
Exportación a sistemas externos y retención configurable.
