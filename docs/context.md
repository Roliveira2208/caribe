# Contexto mínimo del proyecto

Cuatro bloques que un agente no puede adivinar leyendo el código. Se actualiza cuando cambia el dominio.

## Nombre del proyecto
- El proyecto se llama **Caribe**. "OTA" se usa solo como concepto de dominio (agencia de viajes en línea), nunca como nombre del proyecto.
- Consecuencias del nombre: paquetes del monorepo con prefijo `@caribe/*`, proyecto de Docker Compose `caribe`, base de datos local `caribe_dev` y rol restringido de PostgreSQL `caribe_app`.

## Dominio
- Venezuela: la moneda de referencia legal es el bolívar (VES), pero los precios de viaje se fijan en USD. El BCV publica una tasa oficial por día hábil con una fecha valor; en fines de semana y feriados rige la última fecha valor publicada.
- Pago Móvil (VES), Zelle (USD), Binance Pay (USDT) y tarjeta se **simulan**. No hay cobros reales.
- El cliente sin membresía en una agencia es un usuario normal; el personal (agente, proveedor, admin) pertenece a una organización (la agencia).

## Reglas de negocio no obvias
- Precios y totales en USD; VES derivado y congelado en el pago.
- La reserva retiene cupo 30 minutos por defecto (configurable por tenant o producto). Con proveedores externos rige el vencimiento que devuelva su API.
- Reembolso: tasa congelada del día del pago; el porcentaje sale de la política de cancelación de la agencia (flexible, moderada, estricta, configurables por producto).
- Modo de pago del tenant: `AUTO` (aprueba al instante, útil para demos) o `MANUAL` (queda `IN_REVIEW` hasta que un admin decide).
- El comprobante no es fiscal: lleva "Documento no fiscal". Contexto normativo del SENIAT (consultado el 9 de noviembre de 2026): la Providencia SNAT/2026/00084 derogó el régimen de homologación de sistemas de facturación y la SNAT/2026/00093 levantó la obligatoriedad de máquinas fiscales; el régimen sigue en transición. No es asesoría fiscal.

## Convenciones
- Español para producto y documentación; inglés para nombres de código.
- Estados de reserva: `PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `EXPIRED`. Estados de pago: `PENDING`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `REFUNDED`.
- Códigos de error de aplicación estables en mayúsculas con guion bajo.

## Servicios externos (solo sandbox)
- **DolarAPI** (`GET https://ve.dolarapi.com/v1/dolares/oficial`, sin autenticación; campo `promedio`): fuente primaria de tasa. Su disponibilidad se verifica antes de implementar. Respaldo: última tasa válida guardada y ajuste manual del admin.
- **Duffel** (vuelos): token `duffel_test_...`. La aerolínea de prueba Duffel Airways es la más fiable, pero sin horarios ni precios realistas.
- **LiteAPI** (hoteles): clave sandbox del dashboard, 5 solicitudes/segundo. Flujo búsqueda → prebook → reserva, más cancelación.
- **Amadeus Self-Service**: descartado, dejó de operar el 17 de julio de 2026.
- Pendiente de verificar: que el registro en Duffel y LiteAPI funcione desde Venezuela.

## Qué NO es este proyecto
Un producto comercial con cobros, facturación fiscal ni cumplimiento legal. Es un portafolio que demuestra criterio de diseño, seguridad y rendimiento.
