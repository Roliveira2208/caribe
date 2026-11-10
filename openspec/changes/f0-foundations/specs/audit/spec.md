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

#### Scenario: Agencia no lee auditoría de plataforma
- GIVEN filas de auditoría con `tenant_id` NULL
- WHEN el rol de aplicación de una agencia consulta `audit_logs`
- THEN obtiene cero resultados

### Requirement: Alcance de lectura de la auditoría
El alcance de lectura de `audit_logs` SHALL ser: el Admin de agencia solo las filas de su agencia; el
Super Admin las filas de plataforma (`tenant_id` NULL) y las de todas las agencias. Ningún otro rol SHALL
leer la tabla.

#### Scenario: Super Admin consulta la auditoría
- GIVEN filas de auditoría con `tenant_id` NULL y filas de dos agencias
- WHEN un Super Admin consulta la auditoría
- THEN recibe las filas de plataforma y las de ambas agencias

#### Scenario: Admin de agencia solo lee su agencia
- GIVEN filas de auditoría de las agencias A y B, además de filas de plataforma
- WHEN el Admin de la agencia A consulta la auditoría
- THEN solo recibe las filas de la agencia A
