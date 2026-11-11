# Endurecer el inventario de rutas (cierre de F0)

Fecha: 2026-11-11. Estado: **análisis, sin implementar**. Se traslada como primera tarea de
`f1-hotels-e2e` (T-F1-0). Revisión hecha al cerrar `f0-foundations`, después de T-F0-19.

## Qué se revisó

- `apps/api/src/admin/admin-route.ts`: tabla cerrada de rutas de Better Auth, allowlist de
  `/organization/*`, `betterAuthAdminRouteOf` e `isAdminRoute`.
- `apps/api/src/auth.ts`: hooks `before`/`after` y clasificación del segundo factor.
- `apps/api/test/two-factor.e2e.ts`: inventario Nest y de Better Auth, y las aserciones de partición.
- `apps/api/src/admin/admin-two-factor.guard.ts`: guard de Nest que comparte la clasificación.
- Router de `better-call@1.4.5` y `better-auth@1.7.18` (normalización de paths y ejecución de hooks).

Se usaron dos sondas temporales, ya eliminadas: una enumeraba `auth.api` de la instancia real y otra
llamaba al handler con variantes de path. No se cambió código de producción.

## Qué garantiza hoy el inventario

1. **La enumeración es el universo del router.** `listBetterAuthRoutes()` recorre el mismo objeto
   `auth.api` del que `better-call` construye las rutas HTTP, y descarta igual los endpoints sin
   `path` (`router.mjs:21`). No puede existir una ruta servida que el inventario no vea; si una
   actualización cambia la forma de `auth.api`, el inventario se queda corto **y** el router también.
2. **La clasificación está anclada solo en tres prefijos.** `/admin` (toda ruta debe ser
   administrativa), `/organization` (administrativa o allowlist) y `/two-factor` (nunca
   administrativa). Fuera de ahí, `betterAuthAdminRouteOf` devuelve `undefined` y nadie comprueba nada.
3. **Las rutas ya clasificadas se prueban por HTTP** con un admin sin TOTP: si dejan de responder 403
   `TWO_FACTOR_REQUIRED`, el e2e falla. Eso cubre desalineos de runtime (basePath, forma del path,
   métodos) que la tabla estática no vería.
4. **En Nest la clasificación no es independiente.** El guard y el inventario comparten
   `isAdminRoute`/`AUTH_METADATA_KEYS`, y el test solo recorre las rutas que el guard ya considera
   administrativas. Un falso negativo de la clasificación no se detecta.

## Estado medido (better-auth 1.7.18)

| Familia | Rutas |
| --- | --- |
| `/admin/*` | 15 |
| `/organization/*` | 22 |
| `/two-factor/*` | 8 |
| Fuera de la partición | 30 |
| **Total** | **75** |

- Dos rutas declaran dos métodos (`/callback/:id` y `/get-session`), ambas fuera de la partición: hoy
  el inventario solo lee `method[0]`, pero no afecta a ninguna ruta clasificada.
- No hay declaraciones huérfanas (ni de plataforma ni de organización) ni entradas rancias en la
  allowlist de 15 paths.
- Las 30 rutas fuera de la partición son las de identidad y sesión de Better Auth
  (`/sign-in/*`, `/get-session`, `/list-sessions`, `/update-user`, `/delete-user`, `/callback/:id`,
  `/reset-password/:token`, etc.).

## Modos de fallo con rutas futuras

| Escenario | ¿Lo detecta el inventario? | Por qué |
| --- | --- | --- |
| Ruta nueva `/admin/*` (upgrade del plugin admin) | **Sí** | `unclassifiedAdmin` exige que toda ruta `/admin` esté en la tabla |
| Ruta nueva `/organization/*` | **Sí** | `unclassifiedOrganization` exige tabla o allowlist; además `targetOrganization` es obligatorio |
| Ruta admin-grade fuera de los tres prefijos (plugin nuevo: `sso`, `api-key`, `oauth2`, `bearer`…) | **No, silencio** | El conjunto de rutas fuera de la partición no se afirma nunca; ni test ni hook |
| Renombrado de `/admin/x` a otro prefijo | **No** | La ruta nueva cae en el caso anterior; la vieja queda huérfana y los huérfanos de plataforma no se comprueban |
| Ruta con parámetros (`/admin/users/:id/ban`) | **Sí, pero no expresable** | La tabla es un `Map` exacto y `ctx.path` trae el valor real, no la plantilla: arreglarlo exige cambiar la estructura, no añadir una fila |
| Ruta admin-grade añadida a la allowlist | **No** | La allowlist es de confianza; nada valida que sus entradas sean lecturas o self-service |
| Ruta no administrativa declarada administrativa | **No** (salvo el negativo de `/organization/list`) | `misclassified` solo compara la capa con el prefijo; no es bypass, pero rompe el onboarding |
| La ruta gana un método HTTP | **Parcial** | Solo se inventaría `method[0]`. El hook no mira el método, así que no hay bypass: protege cualquier verbo sobre el path declarado |
| Endpoint admin autenticado sin sesión (API key, bearer) | **No en la práctica** | El hook hace `return` si no hay sesión; aunque se clasifique, no hay sesión que clasificar |
| Variantes de path (barra final, `//`, mayúsculas, `%61`) | **No es bypass** | Probado por HTTP: todas responden 404 antes del hook |
| `ctx.path` empieza a incluir el basePath | **Sí** | El test HTTP de las rutas clasificadas dejaría de recibir 403 |
| **Nest:** ruta admin clasificada como no administrativa (clave de metadata renombrada, permiso nuevo no exclusivo) | **No, silencio** | Guard e inventario comparten `isAdminRoute`; solo se prueban las que el guard ya considera admin. La no-vacuidad actual es solo «hay alguna de cada clase» |

## Evidencia de las sondas

- `POST /api/auth/admin/set-role/`, `/api/auth/admin//set-role`, `/api/auth/Admin/set-role` y
  `/api/auth/%61dmin/set-role` → **404**. La barra final y el doble slash se rechazan antes de los
  hooks; el match es crudo (sensible a mayúsculas y a la codificación).
- `POST /api/auth/admin/set-role` **sin cookie** → **400** `VALIDATION_ERROR`, no 403: el hook
  `before` sale temprano cuando no hay sesión. Un endpoint administrativo que autentique por token no
  queda cubierto por la clasificación actual.

## Veredicto

El inventario detecta bien lo que ya está dentro de las tres familias, pero es un mundo cerrado solo
para dos de ellas. Un plugin nuevo, un renombrado fuera de `/admin` o un endpoint sin sesión no
producen **ninguna señal**. Como la misma tabla alimenta la auditoría, una ruta así tampoco deja fila:
el silencio es doble (TOTP y `audit_logs`).

El caso más peligroso no es que better-auth añada una ruta, sino **habilitar un plugin nuevo** (SSO,
API keys, OAuth provider): son rutas que ya existen en el paquete, con capacidad administrativa real,
que quedan fuera de la partición y del hook sin que falle nada.

## Mejoras propuestas (T-F1-0)

1. **Registro cerrado de lo no administrativo.** Afirmar que toda ruta fuera de `/admin`,
   `/organization` y `/two-factor` está en una lista explícita (snapshot de las 30 actuales). Un
   prefijo nuevo rompe el build y obliga a decidir.
2. **Huérfanas en todas las declaraciones**, plataforma incluidas, y en la allowlist.
3. **Métodos completos.** Inventariar todos los métodos y comparar conjuntos, no `method[0]`.
4. **Paths con parámetros.** Fallo explícito si un path contiene `:` hasta que la clasificación
   soporte patrones (hoy el `Map` exacto no puede expresarlos ni coincidir con `ctx.path`).
5. **Rutas clasificadas sin sesión.** Política explícita (fail-closed o decisión documentada) antes de
   habilitar cualquier autenticación por token.
6. **Allowlist con justificación por entrada** (lectura o self-service) y, si se puede, una aserción
   de que no son admin-grade.
7. **Espejo en Nest.** Registro abierto equivalente, o probar todas las rutas esperando 403 o una
   justificación de no administrativa.

## Prerrequisito para autenticación por token

No habilitar ningún plugin de Better Auth ni autenticación por token (API key, bearer, SSO, OAuth)
sin una change propia que actualice, como mínimo:

- la clasificación de rutas (`BETTER_AUTH_ADMIN_ROUTES`, allowlist y `targetOrganization`);
- el inventario y sus aserciones de partición;
- la política para rutas clasificadas sin sesión;
- el espejo del inventario en Nest.

Queda escrito también en `AGENTS.md` («Qué NO hacer») y como prerrequisito en
`openspec/changes/f1-hotels-e2e/tasks.md` (T-F1-0).

## Fuera de alcance de este documento

No se implementó ninguna de las mejoras. El estado de F0 queda como está (pipeline en verde) y el
endurecimiento se planifica en T-F1-0.
