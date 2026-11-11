/**
 * Punto unico de Zod del monorepo. La API no declara `zod` como dependencia
 * propia: consume el mismo `z` (y sus tipos) que los esquemas compartidos, de
 * modo que la version de validacion es una sola en todo el workspace.
 */
export { z } from "zod";
export type { ZodError, ZodIssue, ZodType } from "zod";
