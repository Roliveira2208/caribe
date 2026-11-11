import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  API_ERROR_STATUS,
  API_ERROR_TITLES,
  TWO_FACTOR_REQUIRED,
  problemType,
  z,
  type ApiErrorCode,
  type ProblemDetails,
} from "@caribe/shared";
import { ApiProblemException } from "../src/errors/api-problem.exception.js";
import {
  codeForStatus,
  problemOf,
  writeProblem,
  type ProblemRequest,
  type ProblemResponse,
} from "../src/errors/problem-details.filter.js";
import { ZodValidationPipe } from "../src/errors/zod-validation.pipe.js";

/**
 * Contrato de errores (T-F1-0c, spec api-errors): la tabla de codigos, el
 * mapeo de excepciones, el 500 sin fugas y el pipe Zod estricto. La suite
 * recorre la tabla completa; los e2e comprueban el Content-Type real.
 */

const request: ProblemRequest = { method: "GET", originalUrl: "/api/v1/recurso?dato=1" };

beforeEach(() => {
  // El 500 escribe en el log: se silencia para no ensuciar la salida.
  vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tabla de códigos", () => {
  it("cada código produce su estado, título y tipo de problema", () => {
    for (const code of Object.keys(API_ERROR_STATUS) as ApiErrorCode[]) {
      const problem = problemOf(new ApiProblemException(code, "detalle"), request);
      expect(problem, code).toMatchObject({
        code,
        status: API_ERROR_STATUS[code],
        title: API_ERROR_TITLES[code],
        type: problemType(code),
        detail: "detalle",
        instance: "/api/v1/recurso",
      });
      // El query string no forma parte de `instance`.
      expect(problem.instance).not.toContain("?");
    }
  });

  it("el estado HTTP sale de la tabla, no del llamador", () => {
    expect(problemOf(new ApiProblemException("VALIDATION_ERROR", "x"), request).status).toBe(422);
    expect(problemOf(new ApiProblemException("HOLD_EXPIRED", "x"), request).status).toBe(410);
    expect(problemOf(new ApiProblemException("RATE_UNAVAILABLE", "x"), request).status).toBe(503);
  });
});

describe("mapeo de excepciones de Nest", () => {
  it("traduce los estados sin código propio", () => {
    const cases: Array<[unknown, number, ApiErrorCode]> = [
      [new BadRequestException("cuerpo inválido"), 422, "VALIDATION_ERROR"],
      [new UnauthorizedException(), 401, "UNAUTHENTICATED"],
      [new ForbiddenException(), 403, "FORBIDDEN"],
      [new NotFoundException(), 404, "NOT_FOUND"],
      [new MethodNotAllowedException(), 405, "METHOD_NOT_ALLOWED"],
      [new ConflictException(), 409, "CONFLICT"],
      [new PayloadTooLargeException(), 413, "PAYLOAD_TOO_LARGE"],
      [new HttpException("teapot", 418), 500, "INTERNAL_ERROR"],
    ];
    for (const [exception, status, code] of cases) {
      expect(problemOf(exception, request), code).toMatchObject({ status, code });
    }
  });

  it("un código propio de la tabla se conserva (TWO_FACTOR_REQUIRED)", () => {
    const exception = new ForbiddenException({
      statusCode: 403,
      code: TWO_FACTOR_REQUIRED,
      message: "Activa el segundo factor",
    });
    expect(problemOf(exception, request)).toMatchObject({
      status: 403,
      code: TWO_FACTOR_REQUIRED,
      detail: "Activa el segundo factor",
    });
  });

  it("un código inventado no se propaga: manda el estado HTTP", () => {
    const exception = new ConflictException({ code: "CUPO_AGOTADO", message: "inventado" });
    expect(problemOf(exception, request)).toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("los errores de body-parser se traducen sin copiar su mensaje", () => {
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large",
    });
    const tooLargeProblem = problemOf(tooLarge, request);
    expect(tooLargeProblem).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(tooLargeProblem.detail).not.toContain("request entity too large");

    const badJson = Object.assign(new Error('Unexpected token } in JSON at position 3'), {
      status: 400,
      type: "entity.parse.failed",
    });
    expect(problemOf(badJson, request)).toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  });

  it("el mapeo por estado es explícito y no inventa códigos", () => {
    expect(codeForStatus(400)).toBe("VALIDATION_ERROR");
    expect(codeForStatus(401)).toBe("UNAUTHENTICATED");
    expect(codeForStatus(403)).toBe("FORBIDDEN");
    expect(codeForStatus(404)).toBe("NOT_FOUND");
    expect(codeForStatus(405)).toBe("METHOD_NOT_ALLOWED");
    expect(codeForStatus(413)).toBe("PAYLOAD_TOO_LARGE");
    expect(codeForStatus(500)).toBe("INTERNAL_ERROR");
    expect(codeForStatus(418)).toBeNull();
  });
});

describe("error inesperado", () => {
  it("responde 500 con correlación y sin traza, SQL ni nombres de tabla", () => {
    const problem = problemOf(
      new Error('relation "payments" does not exist: SELECT * FROM payments'),
      request,
    );
    expect(problem.status).toBe(500);
    expect(problem.code).toBe("INTERNAL_ERROR");
    expect(problem.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const body = JSON.stringify(problem);
    expect(body).not.toContain("payments");
    expect(body).not.toContain("SELECT");
    expect(body).not.toContain("stack");
  });

  it("cada 500 lleva un identificador distinto", () => {
    const first = problemOf(new Error("a"), request);
    const second = problemOf(new Error("b"), request);
    expect(first.correlationId).not.toBe(second.correlationId);
  });

  it("la respuesta 500 escribe la correlación en la cabecera", () => {
    const captured = fakeResponse();
    const problem = problemOf(new Error("fallo"), request);
    writeProblem(captured.response, problem);

    expect(captured.status).toBe(500);
    expect(captured.contentType).toBe("application/problem+json");
    expect(captured.headers["X-Correlation-Id"]).toBe(problem.correlationId);
    expect(captured.body).toBe(problem);
  });

  it("un 4xx no genera correlación ni escribe en el log", () => {
    const captured = fakeResponse();
    writeProblem(captured.response, problemOf(new BadRequestException(), request));
    expect(captured.status).toBe(422);
    expect(captured.headers["X-Correlation-Id"]).toBeUndefined();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });
});

describe("pipe de validación Zod", () => {
  const schema = z.strictObject({ name: z.string().min(1) });
  const pipe = new ZodValidationPipe(schema);

  it("acepta el cuerpo válido y devuelve el valor tipado", () => {
    expect(pipe.transform({ name: "Hotel" })).toEqual({ name: "Hotel" });
  });

  it("rechaza una clave desconocida con 422 y la ruta del campo", () => {
    expect(() => pipe.transform({ name: "Hotel", cardNumber: "4111111111111111" })).toThrow(
      ApiProblemException,
    );
    try {
      pipe.transform({ name: "Hotel", cardNumber: "4111111111111111" });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblemException);
      const problem = error as ApiProblemException;
      expect(problem.code).toBe("VALIDATION_ERROR");
      expect(problem.getStatus()).toBe(422);
      expect(problem.issues).toEqual([{ path: "cardNumber", message: "Campo no permitido" }]);
      // Nunca se devuelve el valor recibido.
      expect(JSON.stringify(problem.issues)).not.toContain("4111");
    }
  });

  it("rechaza los campos que calcula el servidor y no los usa", () => {
    for (const field of ["amount_usd", "amount_ves", "total_usd", "rate", "tenant_id", "user_id"]) {
      try {
        pipe.transform({ name: "Hotel", [field]: "999" });
        throw new Error(`debió rechazar ${field}`);
      } catch (error) {
        const problem = error as ApiProblemException;
        expect(problem.issues?.map((issue) => issue.path)).toEqual([field]);
      }
    }
  });

  it("anida la ruta del campo y traduce los mensajes al español", () => {
    const nested = new ZodValidationPipe(
      z.strictObject({ payment: z.strictObject({ reference: z.string().min(1) }) }),
    );
    try {
      nested.transform({ payment: { reference: "", cvv: "123" } });
    } catch (error) {
      const problem = error as ApiProblemException;
      expect(problem.issues).toEqual(
        expect.arrayContaining([
          { path: "payment.reference", message: "El valor es demasiado corto" },
          { path: "payment.cvv", message: "Campo no permitido" },
        ]),
      );
    }
  });

  it("un cuerpo que no es objeto se rechaza", () => {
    expect(() => pipe.transform("no-es-objeto")).toThrow(ApiProblemException);
    expect(() => pipe.transform(null)).toThrow(ApiProblemException);
  });
});

function fakeResponse(): {
  response: ProblemResponse;
  status?: number;
  contentType?: string;
  headers: Record<string, string>;
  body?: ProblemDetails;
} {
  const captured: {
    response: ProblemResponse;
    status?: number;
    contentType?: string;
    headers: Record<string, string>;
    body?: ProblemDetails;
  } = {
    headers: {},
    response: {
      status(code: number) {
        captured.status = code;
        return captured.response;
      },
      type(value: string) {
        captured.contentType = value;
        return captured.response;
      },
      setHeader(name: string, value: string) {
        captured.headers[name] = value;
      },
      json(body: unknown) {
        captured.body = body as ProblemDetails;
      },
    },
  };
  return captured;
}
