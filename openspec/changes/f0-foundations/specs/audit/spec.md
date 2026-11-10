# Delta: audit — f0-foundations

## ADDED Requirements

### Requirement: Auditoría de acciones de plataforma
Las acciones sensibles ejecutadas fuera del alcance de una agencia SHALL registrarse en `audit_logs` con
`tenant_id` NULL. Las filas con `tenant_id` NULL SHALL ser legibles únicamente por el rol de plataforma de
la base de datos; Row-Level Security SHALL impedir que el rol de aplicación de una agencia las lea.

#### Scenario: Super Admin crea una agencia
- GIVEN un Super Admin autenticado sin organización activa
- WHEN crea una agencia
- THEN existe una fila de auditoría con `tenant_id` NULL, actor, acción y estados antes y después
- AND un admin de agencia no puede leer esa fila
