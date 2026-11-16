import { randomUUID } from "node:crypto";
import { ApiProblemException } from "../errors/api-problem.exception.js";
import type { TenantService } from "../tenant/tenant.service.js";

/**
 * Idempotencia de escrituras (T-F1-9, design §2.3).
 *
 * Reservas y pagos comparten el mismo mecanismo: el cliente manda una
 * `Idempotency-Key` de 8 a 128 caracteres, el servidor reclama la clave en una
 * transaccion propia (commit antes de procesar), guarda `{ id, ... }` de la
 * respuesta y la libera si la operacion falla. Mismo usuario + endpoint + clave
 * + mismo cuerpo devuelve la respuesta guardada sin repetir la escritura ni la
 * auditoria; otro cuerpo responde 409 `IDEMPOTENCY_KEY_REUSED`.
 *
 * La tabla `idempotency_keys` no tiene `tenant_id`: la clave es del usuario y
 * la agencia se resuelve despues de consumirla (RLS solo por `app.user_id`).
 */

/** Encabezado obligatorio de idempotencia. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** Vigencia de una clave de idempotencia (24 h, design §2.3). */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1_000;

/** Resultado de reclamar una clave. */
export type ClaimOutcome<T> =
  | { kind: "claimed" }
  | { kind: "replay"; response: T }
  | { kind: "reused" }
  | { kind: "in-progress" };

export interface ClaimIdempotencyInput<T> {
  tenantService: TenantService;
  userId: string;
  endpoint: string;
  key: string;
  requestHash: string;
  /** Reconstruye la respuesta guardada; `null` si la fila aun no la tiene. */
  parseResponse: (body: unknown) => T | null;
}

/** Valida y normaliza el encabezado `Idempotency-Key`. */
export function requireIdempotencyKey(raw: string | undefined): string {
  const key = raw?.trim() ?? "";
  if (key.length === 0) {
    throw new ApiProblemException(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Falta el encabezado Idempotency-Key.",
    );
  }
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiProblemException("VALIDATION_ERROR", "La clave de idempotencia no es válida.", [
      {
        path: "Idempotency-Key",
        message: `La clave debe tener entre ${IDEMPOTENCY_KEY_MIN_LENGTH} y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres`,
      },
    ]);
  }
  return key;
}

/** P2002: choque con un indice unico. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Clave compuesta de la fila de idempotencia, para `update`/`findUnique`. */
export function idempotencyKeyWhere(userId: string, endpoint: string, key: string) {
  return { userId_endpoint_key: { userId, endpoint, key } };
}

/**
 * Reclama la clave en una transaccion propia (commit antes de procesar). Una
 * clave vencida se descarta y se reutiliza; una clave viva con otro cuerpo es
 * 409 `IDEMPOTENCY_KEY_REUSED`; con el mismo cuerpo y sin respuesta es 409
 * `IDEMPOTENCY_KEY_IN_PROGRESS`; con respuesta guardada es un reintento.
 *
 * El `create` que choca con el unico no se captura dentro de su transaccion:
 * PostgreSQL la deja abortada. Se captura fuera y se consulta la fila en otra
 * transaccion.
 */
export async function claimIdempotencyKey<T>(
  input: ClaimIdempotencyInput<T>,
): Promise<ClaimOutcome<T>> {
  return claim(input, 0);
}

async function claim<T>(
  input: ClaimIdempotencyInput<T>,
  attempt: number,
): Promise<ClaimOutcome<T>> {
  const now = new Date();
  try {
    await input.tenantService.withOwner(input.userId, async (tx) => {
      await tx.idempotencyKey.deleteMany({
        where: {
          userId: input.userId,
          endpoint: input.endpoint,
          key: input.key,
          expiresAt: { lte: now },
        },
      });
      await tx.idempotencyKey.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          endpoint: input.endpoint,
          key: input.key,
          requestHash: input.requestHash,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_TTL_MS),
        },
      });
    });
    return { kind: "claimed" };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const existing = await input.tenantService.withOwner(input.userId, (tx) =>
    tx.idempotencyKey.findUnique({
      where: idempotencyKeyWhere(input.userId, input.endpoint, input.key),
    }),
  );

  // La fila que provoco el conflicto desaparecio (purga concurrente): un
  // reintento acotado vuelve a reclamar.
  if (!existing) {
    if (attempt < 1) return claim(input, attempt + 1);
    return { kind: "in-progress" };
  }

  // Una clave vencida se puede reutilizar como solicitud nueva.
  if (existing.expiresAt.getTime() <= now.getTime()) {
    if (attempt < 1) {
      await input.tenantService.withOwner(input.userId, (tx) =>
        tx.idempotencyKey.deleteMany({
          where: {
            userId: input.userId,
            endpoint: input.endpoint,
            key: input.key,
            expiresAt: { lte: new Date() },
          },
        }),
      );
      return claim(input, attempt + 1);
    }
    return { kind: "in-progress" };
  }

  if (existing.requestHash !== input.requestHash) return { kind: "reused" };

  const stored = input.parseResponse(existing.responseBody);
  if (!stored) return { kind: "in-progress" };
  return { kind: "replay", response: stored };
}

/** Libera una clave reclamada cuya operacion no llego a confirmarse. */
export async function releaseIdempotencyKey(
  tenantService: TenantService,
  userId: string,
  endpoint: string,
  key: string,
): Promise<void> {
  await tenantService.withOwner(userId, (tx) =>
    tx.idempotencyKey.deleteMany({ where: { userId, endpoint, key } }),
  );
}
