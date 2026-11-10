# Auth and Access Specification

## Purpose
Identidad con Better Auth, roles por agencia y aislamiento entre tenants.

## Requirements

### Requirement: Autenticación con Better Auth
La API SHALL exponer las rutas de Better Auth bajo `/api/auth/*` y exigir sesión en el resto, salvo los
endpoints marcados públicos (catálogo, tasa actual).

#### Scenario: Ruta protegida sin sesión
- WHEN se llama a `GET /api/v1/bookings/:id` sin cookie de sesión
- THEN 401

#### Scenario: Catálogo público
- WHEN se llama a `GET /api/v1/products` sin sesión
- THEN 200

### Requirement: Roles
El sistema SHALL distinguir los roles: Cliente (usuario sin membresía), Agente (`agent`), Proveedor (`provider`), Admin de agencia
(`owner` o `admin`) y Super Admin (rol de plataforma).

#### Scenario: Proveedor edita su producto
- GIVEN un proveedor dueño del producto
- WHEN lo edita
- THEN 200

#### Scenario: Proveedor edita producto de otro proveedor
- WHEN edita un producto ajeno de la misma agencia
- THEN 403

#### Scenario: Cliente ve solo sus reservas
- WHEN un cliente consulta una reserva que no es suya
- THEN 404

### Requirement: Aislamiento entre tenants
Toda consulta SHALL filtrar por `tenant_id` mediante Row-Level Security.

#### Scenario: Admin de otra agencia
- GIVEN un admin de la agencia A
- WHEN pide un producto de la agencia B por id
- THEN 404

### Requirement: Segundo factor para roles administrativos
Admin de agencia y Super Admin SHALL activar TOTP antes de usar el panel.

#### Scenario: Admin sin TOTP
- WHEN un admin sin segundo factor inicia sesión
- THEN solo puede acceder a la pantalla de activación de TOTP

### Requirement: Límite de intentos y sesiones
Better Auth SHALL limitar intentos en registro e inicio de sesión, y las sesiones SHALL ser revocables desde el panel.

#### Scenario: Revocar sesión
- WHEN un admin revoca la sesión de un usuario
- THEN su siguiente solicitud devuelve 401

## Casos límite
- Correo ya registrado → 422 sin revelar si existe cuenta en el restablecimiento de contraseña.
- Usuario bloqueado (`banned`) → no puede iniciar sesión.
- Cookie de sesión de primera parte: las apps Next.js reenvían `/api/*` a la API.

## Acceptance
- Pruebas de autorización por rol y de aislamiento entre dos tenants en CI.
- Matriz rol × endpoint documentada en `design.md` de la change F0.

## Out of scope
Inicio de sesión social, SSO, claves de acceso (passkeys).
