# Hoja de ruta: fases del SDD → changes

Las specs de `openspec/specs/` son los contratos base. Los `design.md` y `tasks.md` se escriben **justo antes**
de cada fase, no todos ahora: así no se vuelven contexto obsoleto.

| Fase SDD (§13) | Change | Specs que toca | Estado |
| --- | --- | --- | --- |
| F0 Fundaciones | `f0-foundations` | auth-access, audit | Listo para empezar |
| F1 Hoteles de punta a punta | `f1-hotels-e2e` | catalog, booking, exchange-rates, payments, documents | Tareas redactadas |
| F2 Panel y tasas | `f2-admin-rates` | payments, exchange-rates, audit | Por redactar |
| F3 Tours y paquetes | `f3-tours-packages` | catalog, booking | Por redactar |
| F4 Vuelos y adaptadores | `f4-flights-adapters` | inventory-providers, catalog | Por redactar |
| F5 PWA, seguridad, rendimiento | `f5-hardening` | todas (requisitos no funcionales, SDD §2) | Por redactar |

Para redactar una change nueva: `/opsx:new <nombre>` (si instalaste OpenSpec) o pídelo con la plantilla
`docs/templates/`. F3 y F4 se recortan primero si falta tiempo.
