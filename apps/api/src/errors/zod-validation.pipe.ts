import { Injectable, type PipeTransform } from "@nestjs/common";
import type { ValidationIssue, ZodError, ZodIssue, ZodType } from "@caribe/shared";
import { ApiProblemException } from "./api-problem.exception.js";

/**
 * Pipe de validacion con los esquemas Zod compartidos (spec api-errors,
 * "Validacion con esquemas compartidos"). El esquema debe ser estricto: la
 * clave desconocida la rechaza Zod y el pipe la convierte en 422.
 *
 * El pipe corre antes del handler. Un fallo de validacion nunca llega a la
 * logica de negocio y nunca devuelve el valor recibido.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ApiProblemException(
      "VALIDATION_ERROR",
      "La solicitud no es válida.",
      validationIssuesOf(result.error),
    );
  }
}

/**
 * Traduce los problemas de Zod a `{ path, message }`.
 *
 * Los mensajes de Zod por defecto estan en ingles y algunos repiten el valor
 * recibido; por eso solo se usa el mensaje propio de las validaciones
 * `custom` (los esquemas los escriben en espanol y sin el valor). El resto se
 * sustituye por un mensaje fijo en espanol.
 */
export function validationIssuesOf(error: ZodError): ValidationIssue[] {
  return error.issues.flatMap(validationIssuesOfIssue);
}

function validationIssuesOfIssue(issue: ZodIssue): ValidationIssue[] {
  const path = issue.path.map((segment) => String(segment)).join(".");

  switch (issue.code) {
    case "unrecognized_keys":
      // Un problema por clave desconocida: la UI marca cada campo.
      return issue.keys.map((key) => ({
        path: path ? `${path}.${key}` : key,
        message: "Campo no permitido",
      }));
    case "invalid_type":
      return [{ path, message: "El valor no tiene el tipo esperado" }];
    case "invalid_format":
      return [{ path, message: "El formato no es válido" }];
    case "invalid_value":
      return [{ path, message: "El valor no es válido" }];
    case "too_small":
      return [
        {
          path,
          message:
            issue.origin === "string" || issue.origin === "array"
              ? "El valor es demasiado corto"
              : "El valor es demasiado pequeño",
        },
      ];
    case "too_big":
      return [
        {
          path,
          message:
            issue.origin === "string" || issue.origin === "array"
              ? "El valor es demasiado largo"
              : "El valor es demasiado grande",
        },
      ];
    case "not_multiple_of":
      return [{ path, message: "El valor no es un múltiplo permitido" }];
    case "custom":
      // Mensaje del propio esquema: en espanol y sin el valor recibido.
      return [{ path, message: issue.message }];
    default:
      return [{ path, message: "Valor inválido" }];
  }
}
