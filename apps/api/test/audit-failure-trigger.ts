import { randomUUID } from "node:crypto";
import type { Client } from "pg";

/** Inyección de fallo de auditoría instalada para una agencia concreta. */
export interface AuditFailureTrigger {
  /** Agencia cuyas filas de `audit_logs` hacen fallar el INSERT. */
  tenantId: string;
  /** Quita solo los objetos de esta instancia. */
  drop(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Instala un trigger que aborta la inserción en `audit_logs` cuando la fila
 * pertenece a `tenantId`, para probar el rollback de las transacciones
 * auditables (spec audit, casos límite).
 *
 * Los nombres del trigger y de la función son únicos por instancia. En
 * PostgreSQL el nombre identifica al objeto en todo el esquema, no por
 * conexión: con un nombre fijo, dos suites (o dos corridas del mismo archivo)
 * que se solapen se pisan al crear el trigger, la última gana el `WHEN` y la
 * otra deja de inyectar el fallo. Eso producía un falso verde intermitente en
 * «si falla la auditoría no se confirma…» y «un fallo en una agencia no
 * detiene a las demás». Con nombres únicos ambas inyecciones coexisten.
 */
export async function createAuditFailureTrigger(
  owner: Client,
  tenantId: string,
): Promise<AuditFailureTrigger> {
  if (!UUID.test(tenantId)) {
    throw new Error("createAuditFailureTrigger requiere un tenantId UUID");
  }
  const tag = randomUUID().replace(/-/g, "");
  const functionName = `audit_logs_fail_test_fn_${tag}`;
  const triggerName = `audit_logs_fail_test_${tag}`;

  await owner.query(
    `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
     BEGIN
       IF NEW."tenant_id" = '${tenantId}' THEN
         RAISE EXCEPTION 'fallo de auditoria simulado';
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
  );
  await owner.query(
    `CREATE TRIGGER "${triggerName}"
       BEFORE INSERT ON "audit_logs"
       FOR EACH ROW
       EXECUTE FUNCTION "${functionName}"()`,
  );

  return {
    tenantId,
    async drop(): Promise<void> {
      await owner.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON "audit_logs"`);
      await owner.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    },
  };
}
