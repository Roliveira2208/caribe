import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { TEST_DATABASE_NAME, testDatabaseUrl } from "./test-db.js";

/**
 * Aislamiento de la base de pruebas (punto 2 de la mejora de infraestructura).
 * Los e2e no deben escrbir nunca en `caribe_dev`: el entorno de vitest
 * reescribe la URL a `caribe_test`, con las migraciones aplicadas allí.
 */
describe("base de datos de pruebas", () => {
  it("fuerza el nombre caribe_test aunque el entorno apunte a caribe_dev", () => {
    const url = testDatabaseUrl({
      DATABASE_URL: "postgresql://caribe_dev:secreto@localhost:5433/caribe_dev?schema=public",
    });
    expect(url).toBe("postgresql://caribe_dev:secreto@localhost:5433/caribe_test?schema=public");
  });

  it("conserva servidor, puerto, credenciales y esquema", () => {
    const url = new URL(
      testDatabaseUrl({ DATABASE_URL: "postgresql://otro:clave@db.local:6543/base?schema=public" }),
    );
    expect(url.host).toBe("db.local:6543");
    expect(url.username).toBe("otro");
    expect(url.password).toBe("clave");
    expect(url.pathname).toBe("/caribe_test");
    expect(url.searchParams.get("schema")).toBe("public");
  });

  it("acepta un entorno sin DATABASE_URL usando el servidor local por defecto", () => {
    expect(testDatabaseUrl({})).toContain(`/${TEST_DATABASE_NAME}`);
  });

  describe("contra PostgreSQL", () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client?.end();
    });

    it("la conexión de los tests es caribe_test, nunca caribe_dev", async () => {
      const { rows } = await client.query<{ name: string }>("SELECT current_database() AS name");
      expect(rows[0]?.name).toBe(TEST_DATABASE_NAME);
    });

    it("caribe_test tiene sus propias migraciones aplicadas", async () => {
      const { rows } = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM \"_prisma_migrations\"",
      );
      expect(rows[0]?.count).toBeGreaterThan(0);
    });
  });
});
