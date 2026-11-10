# Cómo desarrollamos con IA: Spec Driven Development

Nota de siglas: **SDD** en `docs/sdd/SDD.md` es el *Software Design Document* (el diseño global). Aquí
SDD es *Spec Driven Development*: escribir la especificación de comportamiento antes de pedir código.
El documento de diseño fija el stack y la arquitectura; las specs de `openspec/specs/` fijan el comportamiento.

## Mapa de archivos

| Archivo | Para qué sirve | Quién lo lee |
| --- | --- | --- |
| `AGENTS.md` / `CLAUDE.md` | Memoria del proyecto y reglas fijas. Se carga siempre: mantenlo corto. | Agente, cada sesión |
| `docs/constitution.md`, `docs/context.md`, `docs/definition-of-done.md` | Principios, contexto de dominio y checklist de terminado | Agente y tú |
| `docs/sdd/SDD.md` | Diseño global y decisiones D1–D15 | Agente y tú, cuando hay duda |
| `openspec/specs/<dominio>/spec.md` | Contrato de comportamiento vigente (fuente de verdad) | Agente antes de implementar |
| `openspec/changes/<change>/` | Propuesta, diseño, tareas y specs delta de un cambio | Agente y tú |
| `openspec/ROADMAP.md` | Fases del SDD → changes | Tú |
| `docs/plans/` | Planes del modo plan e informes de verificación | Tú, para verificar |
| `.claude/commands/` | `/next-task`, `/verify` | Tú |
| `.claude/agents/` | `spec-reviewer`, `security-reviewer` | `/verify` |
| `.claude/skills/` | `conventional-commits`, `write-spec` | Agente, bajo demanda |
| `scripts/check-specs.mjs` | Valida estructura de specs y tareas (corre en CI) | CI y tú |

## Las cuatro fases

1. **Especificar (qué y por qué).** Pide una spec con la skill `write-spec` o copia `docs/templates/spec.md`.
   Cinco bloques: objetivo, comportamiento esperado (GIVEN/WHEN/THEN), casos límite, criterios de aceptación y
   fuera de alcance. Responde las preguntas incómodas: permisos, errores, vacíos, límites, reglas de negocio.
2. **Planificar (cómo).** Abre el modo plan (`/plan`), pide `design.md` y `tasks.md` de la change. Léelo entero,
   fíjate en lo que el agente asumió sin que lo pidieras, pregunta el porqué y guárdalo en `docs/plans/`.
   Las tareas deben ser de 1–2 horas y nombrar el escenario que las prueba.
3. **Implementar.** `/next-task <change>`: una tarea, tests primero, un commit. Intervén con Escape si se desvía.
4. **Verificar.** En una **conversación nueva**: `/verify <change>` y `/security-review`. Tres niveles, de menos a más
   fiable: revisión del código contra la spec → tests derivados de cada escenario → prueba e2e en entorno real.
   Un escenario sin test cuenta como incumplido. La IA puede decir que cumplió el plan sin haberlo hecho.

## Cuándo NO escribir spec
Errata, subir una versión, renombrar, un getter de tres líneas, un spike o script desechable. Aplicar SDD a todo
lo convierte en *waterfall* con otro nombre. Regla práctica: si el cambio tiene ambigüedad, dinero, permisos,
concurrencia o reglas de negocio, merece spec; si no, pídelo directamente.

## Rutina de sesión (higiene de contexto)
- Una carpeta, un agente, una change a la vez. Empieza leyendo `tasks.md`, no el repo entero.
- Al pasar de ~70 % de contexto: pide un resumen, compacta o abre sesión nueva y retoma desde `tasks.md`.
  El estado vive en archivos (`tasks.md`, specs, git), no en la conversación.
- Commit inicial y uno por tarea. Si la IA rompe algo, vuelves atrás.
- Permisos: lectura, instalación, lint y tests están permitidos en `.claude/settings.json`; borrado y `git push`
  piden confirmación; `rm -rf`, `push --force` y leer `.env` están denegados.
- Nunca des por buena una tarea sin lint + typecheck + tests en verde: es la verificación del mundo real.

## Primera sesión (copiar y pegar)
1. `git init` y commit con este kit.
2. Abre el agente en la carpeta y escribe: *"Lee AGENTS.md, docs/sdd/SDD.md y openspec/changes/f0-foundations/.
   Activa el modo plan y dime qué asumes y qué dudas tienes antes de tocar nada."*
3. Resuelve las preguntas abiertas de `proposal.md`, luego `/next-task f0-foundations`.
4. Termina la fase con `/verify f0-foundations` en sesión limpia y archiva la change.

## Antes de cada fase nueva (F2 a F5)
Redacta primero la change (`proposal.md`, specs delta), planifica, y solo entonces tareas. Las specs base ya existen;
`design.md` y `tasks.md` se escriben justo antes para que no se queden obsoletos. Si una spec cambia, el delta va
primero y el código después.

## OpenSpec (opcional)
La carpeta `openspec/` sigue su estructura (specs por dominio, changes con proposal/design/tasks y deltas
ADDED/MODIFIED/REMOVED). Si lo instalas (`npm install -g @fission-ai/openspec@latest`, luego `openspec init` en la
raíz), obtienes comandos `/opsx:*` (`propose`, `apply`, `archive`, entre otros) y el archivado que fusiona los deltas
en `openspec/specs/`. Tras `openspec init` revisa el diff por si toca `AGENTS.md` o `openspec/config.yaml`. Sin
instalarlo, este kit funciona igual con `/next-task` y `/verify`, y archivas a mano moviendo la change a
`openspec/changes/archive/<fecha>-<nombre>/` y aplicando sus deltas a las specs base.

## Siguientes palancas
- **Skills propias** cuando repitas una instrucción (por ejemplo, "crear un módulo NestJS del proyecto").
- **MCP** para dar al agente documentación al día o un navegador de pruebas; evalúalo cuando lo necesites, no antes.
- **Subagentes** para revisar frontend y backend en paralelo, cada uno con contexto limpio.

## Errores a evitar
Empezar con todo a la vez; fiarse de lo que el agente dice que hizo; specs largas que nadie revisa; rellenar huecos
con suposiciones; dar permisos de borrado sin supervisión; saltarse commits y tests; tratar la spec como sustituto del
criterio técnico (no sustituye entender el dominio ni validar con usuarios).
