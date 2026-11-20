# Proposal: public-rate-and-price-filters

## Why
Los wireframes aprobados de búsqueda muestran la tasa BCV del día con su fecha valor y un filtro de
precio en USD, pero el contrato público actual no expone la tasa (solo equivalentes VES ya calculados)
ni acepta límites de precio. Sin esos dos contratos, T-F1-13a tendría que inventar la fecha valor o
filtrar a ciegas sobre una página incompleta. Implementa SDD §5 (catálogo) y §6 (tasas).

## What Changes
- Añadir una lectura pública y anónima de la tasa global vigente que devuelva `rate` y `valueDate`.
  No dispara consultas al proveedor ni revela overrides de agencia. Sin tasa global responde 200 con
  el indicador de "no disponible" para que la web muestre solo USD.
- Ampliar `GET /products` con `minPriceUsd` y `maxPriceUsd` opcionales. El filtro aplica al precio que
  ve el usuario: total de la estancia cuando se envían `checkIn`/`checkOut`, precio base en caso
  contrario. Ambos límites son inclusivos y se validan como decimales positivos.
- La web consumirá ambos contratos en el header y en la búsqueda; el selector de tipo mostrará los
  cuatro tipos del wireframe, con Tour, Paquete y Vuelo deshabilitados ("próximamente") porque F1
  solo publica hoteles.
- Sin cambios incompatibles: el endpoint es nuevo y los dos parámetros de búsqueda son opcionales.

## Capabilities

### New Capabilities
Ninguna: ambos comportamientos pertenecen a capacidades existentes.

### Modified Capabilities
- `exchange-rates`: nueva lectura pública de la tasa global vigente con su fecha valor.
- `catalog`: filtros opcionales de precio mínimo y máximo en USD sobre el precio visible.

## Impact
- API: controlador público nuevo en `rates`, esquemas Zod y reutilización de `globalRate()`;
  `catalogQuerySchema` y la consulta `searchRows` del catálogo.
- Web: consumo de `/api/rates/today` y de los nuevos parámetros de `/api/products`; mensajes es/en
  para la tasa, el filtro y los tipos deshabilitados; wireframes de búsqueda actualizados.
- Tests: escenarios nuevos en `exchange-rates` y `catalog`, más pruebas de la web sobre la
  presentación de USD/VES con fecha valor y la accesibilidad de los filtros.
- Sin dependencias nuevas y sin cambios de esquema de base de datos.

## Preguntas abiertas
- Ninguna. El usuario decidió el 19/11/2026: endpoint público de tasa, filtros de precio en la API y
  tipos futuros visibles pero deshabilitados.
