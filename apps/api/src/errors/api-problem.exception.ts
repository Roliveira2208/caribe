import { HttpException } from "@nestjs/common";
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  type ValidationIssue,
} from "@caribe/shared";

/**
 * Excepcion de dominio con un codigo de la tabla de `api-errors`. El estado
 * HTTP sale siempre de la tabla, nunca del llamador. El filtro global la
 * convierte en Problem Details.
 */
export class ApiProblemException extends HttpException {
  readonly code: ApiErrorCode;
  readonly detail: string;
  readonly issues?: ValidationIssue[];

  constructor(code: ApiErrorCode, detail: string, issues?: ValidationIssue[]) {
    super(detail, API_ERROR_STATUS[code]);
    this.name = "ApiProblemException";
    this.code = code;
    this.detail = detail;
    this.issues = issues;
  }
}
