import { AuthApiError } from "@caribe/shared";

/**
 * Un 403 o 404 del recurso actual invalida todo lo que la pantalla ya hubiera
 * pintado de él (spec `admin-ui`, «Sin datos negados por la API»). La UI no
 * conserva filas, importes ni resúmenes de una agencia anterior ni de una
 * respuesta denegada antes: el servidor es la única fuente de verdad.
 */
export type DeniedStatus = "forbidden" | "not-found";

export function deniedStatusOf(cause: unknown): DeniedStatus | null {
  if (!(cause instanceof AuthApiError)) return null;
  if (cause.status === 403) return "forbidden";
  if (cause.status === 404) return "not-found";
  return null;
}
