# Alcance de f2-admin-rates

Clasificación de los 75 escenarios nuevos de esta change, alineada con los deltas y las tres specs
base nuevas. El conteo se comprueba con `node scripts/check-specs.mjs` y con un recuento de
`#### Scenario:` por spec. Los 103 escenarios de las specs base `exchange-rates` (31), `payments` (38)
y `audit` (34) son regresión y no se cuentan aquí.

## Criterio

- **Obligatorio**: toca dinero, tasa, autorización, segundo factor, aislamiento entre tenants,
  concurrencia, integridad de estados, auditoría o seguridad de red. Sin esto no hay F2 ni demo pública.
- **Deseable**: pulsa el contrato o la experiencia sin poner en riesgo dinero, autorización ni
  aislamiento; se implementa si cabe y se anota en `verify.md` si se recorta.
- **Aplazable**: fuera de F2 por decisión del dueño; no aparece en los deltas.

## Totales

El delta de `api-errors` se añadió durante T-F2-2 para dar un `code` estable a las respuestas 429 que
ya exigía la spec `security`; por eso el total pasó de 75 a 76 escenarios y de 61 a 62 obligatorios.
La PAUSA 3 corrigió el inventario de `catalog`, que tenía 7 escenarios en lugar de los 8 del delta
(faltaba «Lectura de disponibilidad del panel»): el total vigente es 77 escenarios y 63 obligatorios.

| Spec | Escenarios | Obligatorio | Deseable | Aplazable |
| --- | ---: | ---: | ---: | ---: |
| api-errors | 1 | 1 | 0 | 0 |
| exchange-rates | 12 | 9 | 3 | 0 |
| payments | 12 | 8 | 4 | 0 |
| audit | 10 | 6 | 4 | 0 |
| catalog | 8 | 8 | 0 | 0 |
| auth-access | 6 | 6 | 0 | 0 |
| admin-ui | 10 | 7 | 3 | 0 |
| reports | 5 | 5 | 0 | 0 |
| security | 13 | 13 | 0 | 0 |
| **Total** | **77** | **63** | **14** | **0** |

**Regla de cierre:** solo los **63 obligatorios** bloquean F2. Ningún obligatorio se recorta para
meter un deseable. Las dos pausas (T-F2-10 y T-F2-13) son obligatorias antes de catálogo y usuarios.

## api-errors (1)

- **Obligatorio (1)**: Límite excedido.

## exchange-rates (12)

- **Obligatorio (9)**: Ver tasa vigente · Override con motivo desde el panel · Sin segundo factor ·
  Sin permiso de tasa · Confirmación de override vigente · Override de otra agencia · Auditoría del
  override · Campos calculados del cliente · Membresía revocada.
- **Deseable (3)**: Tasa global del Super Admin · Fecha valor futura · Historial de overrides.

## payments (12)

- **Obligatorio (8)**: Listado filtrable · Aprobar con TOTP · Rechazo con motivo en el panel ·
  Revisor distinto del pagador en la UI · Par congelado solo lectura · Revisión concurrente en la UI ·
  Sin permiso de lectura de pagos · Pago de otra agencia.
- **Deseable (4)**: Exportación CSV de pagos · Columnas configurables · Estado vacío · Estado de error.

## audit (10)

- **Obligatorio (6)**: Filtros y cursor · Pestaña de eventos de autenticación · Alcance del admin de
  agencia · Modo plataforma del Super Admin · Sin permiso de auditoría · Sin secretos ni mensajes
  internos.
- **Deseable (4)**: Auditoría del override de tasa · Auditoría de la revisión de pagos · Auditoría del
  cambio de rol · Exportación CSV de auditoría.

## catalog (8)

- **Obligatorio (8)**: Alta de producto en el panel · Edición de producto de la agencia · Proveedor
  edita solo sus productos · Publicar y archivar producto · Disponibilidad por noche · Lectura de
  disponibilidad del panel · Precio como texto decimal · Traducciones es y en.

## auth-access (6)

- **Obligatorio (6)**: Invitar miembro con segundo factor · Cambiar rol de un miembro · Revocar sesión
  desde el panel · Organización objetivo ajena · Super Admin en modo plataforma · Operación sin agencia
  activa.

## admin-ui (10)

- **Obligatorio (7)**: Tokens Caribe · Tipografía compartida · Cabecera del panel · Textos es y en ·
  Accesibilidad básica · Matriz de permisos F1 en la UI · Sin datos negados por la API.
- **Deseable (3)**: Selector de agencia en la cabecera · Bandera del modo de aprobación · Idioma
  persistido.

## reports (5)

- **Obligatorio (5)**: Reporte por rango de fechas · Totales calculados en el servidor · Desglose por
  método y estado · Alcance por rol · Exportación CSV del reporte.

## security (13)

- **Obligatorio (13)**: IP tras proxy de confianza · Cabecera de proxy no confiable · Rate limit por
  IP real · Cabeceras de seguridad en la API · CSP sin scripts inline · CORS con orígenes permitidos ·
  CORS con origen desconocido · Límite en creación de reservas · Límite en alta y revisión de pagos ·
  Límite en descargas · Reembolso idempotente · Rollback sin reembolso externo · Reconciliación de
  reembolsos.

## Aplazados (no cuentan en los deltas)

1. Pasarela de pago real y captura en la pasarela en la aprobación manual.
2. Tours, paquetes, vuelos y adaptadores externos.
3. PWA offline, OpenAPI/Swagger y k6 automatizado en CI.
4. Dominios y planes SaaS completos (D3 solo prepara el modelo).
5. Facturación fiscal: los comprobantes siguen siendo «Documento no fiscal».
