import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { generateBookingCode } from "../src/bookings/booking-code.js";
import { apiConfig } from "../src/config.js";
import { DocumentIssuanceService } from "../src/documents/document-issuance.service.js";
import { DocumentRenderingService } from "../src/documents/document-rendering.service.js";
import {
  authOrigin,
  createAgency,
  createUser,
  setActiveOrg,
  signIn,
  userWithTotp,
} from "./auth-helpers.js";

/**
 * Descarga autenticada (T-F1-11e, spec documents "Almacenamiento y descarga"
 * y "Ciclo de vida del documento").
 *
 * El archivo nunca se sirve desde una URL pública: solo la ruta /documents/:id
 * autenticada comprueba propiedad (dueño) o pertenencia a la agencia activa, y
 * valida la ruta guardada antes de tocar el disco.
 */
describe("descarga de documentos", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let issuance: DocumentIssuanceService;
  let rendering: DocumentRenderingService;
  let db: Client;

  let tenantA: string;
  let tenantB: string;
  let clientId: string;
  let clientCookie: string;
  let otherClientCookie: string;
  let adminACookie: string;

  let readyDoc: string;
  let readyCode: string;
  let pendingDoc: string;
  let failedDoc: string;
  let foreignDoc: string;
  let tamperedDoc: string;
  let sentinelPath: string;

  let productId: string;
  let hotelKey: string;
  let rateId: string;

  const suffix = randomUUID().slice(0, 8);
  const title = { es: "Hotel Sol", en: "Sun Hotel" };
  const description = { es: "Descripción", en: "Description" };
  const night1 = "2026-12-10";
  const night2 = "2026-12-12";

  const get = async (path: string, cookie?: string): Promise<Response> =>
    fetch(`${baseUrl}/api/v1${path}`, {
      headers: cookie ? { cookie, origin: authOrigin } : { origin: authOrigin },
    });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
    issuance = app.get(DocumentIssuanceService);
    rendering = app.get(DocumentRenderingService);
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const adminA = await userWithTotp(baseUrl, `docs-dl-admin-a-${suffix}@example.com`);
    tenantA = (await createAgency(adminA.userId, `Agencia A ${suffix}`, `dl-a-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminA.cookie, tenantA);
    adminACookie = adminA.cookie;

    const adminB = await userWithTotp(baseUrl, `docs-dl-admin-b-${suffix}@example.com`);
    tenantB = (await createAgency(adminB.userId, `Agencia B ${suffix}`, `dl-b-${suffix}`)).id;
    await setActiveOrg(baseUrl, adminB.cookie, tenantB);

    const clientEmail = `docs-dl-client-${suffix}@example.com`;
    clientId = await createUser(clientEmail);
    clientCookie = await signIn(baseUrl, clientEmail);
    const otherEmail = `docs-dl-other-${suffix}@example.com`;
    await createUser(otherEmail);
    otherClientCookie = await signIn(baseUrl, otherEmail);

    for (const tenantId of [tenantA, tenantB]) {
      await db.query(
        `INSERT INTO "tenant_settings"
           (tenant_id, legal_name, rif, address, phone, email, updated_at)
         VALUES ($1, 'Caribe Viajes C.A.', 'J-123456789', 'Av. Principal 1',
                 '+58 212 1234567', 'contacto@example.com', now())`,
        [tenantId],
      );
    }

    const providerId = randomUUID();
    const destinationId = randomUUID();
    await db.query(
      `INSERT INTO "providers" (id, tenant_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [providerId, tenantA, `Proveedor ${suffix}`],
    );
    await db.query(
      `INSERT INTO "destinations" (id, tenant_id, name, country, code, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 'VE', $4, now(), now())`,
      [destinationId, tenantA, JSON.stringify({ es: "Mérida", en: "Merida" }), `dl-${suffix}`],
    );
    productId = randomUUID();
    hotelKey = randomUUID();
    await db.query(
      `INSERT INTO "products"
         (id, tenant_id, provider_id, type, hotel_key, room_type, title, description,
          destination_id, status, base_price_usd, cancellation_policy_id, source, attributes,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'HOTEL', $4, 'doble', $5::jsonb, $6::jsonb, $7,
               'PUBLISHED', '100.00', NULL, 'OWN', '{}'::jsonb, now(), now())`,
      [
        productId,
        tenantA,
        providerId,
        hotelKey,
        JSON.stringify(title),
        JSON.stringify(description),
        destinationId,
      ],
    );

    rateId = randomUUID();
    await db.query(
      `INSERT INTO "exchange_rates"
         (id, tenant_id, source, rate, value_date, fetched_at, is_override)
       VALUES ($1, $2, 'cotizave', '36.0000', CURRENT_DATE, now(), false)`,
      [rateId, tenantA],
    );

    /** Reserva confirmada con una línea, tal como la necesita el render. */
    const makeBooking = async (
      tenantId: string,
      userId: string,
      withItem = true,
    ): Promise<{ id: string; code: string }> => {
      const id = randomUUID();
      const code = generateBookingCode();
      await db.query(
        `INSERT INTO "bookings"
           (id, tenant_id, code, user_id, status, total_usd, travelers, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'CONFIRMED', '100.00', $5::jsonb,
                 now() + interval '30 minutes', now())`,
        [
          id,
          tenantId,
          code,
          userId,
          JSON.stringify([
            {
              fullName: "Ana Pérez",
              documentType: "V",
              documentNumber: "12345678",
              phone: "+584141234567",
              email: "ana@example.com",
            },
          ]),
        ],
      );
      if (withItem) {
        await db.query(
          `INSERT INTO "booking_items"
             (id, booking_id, tenant_id, product_id, hotel_key, room_type, check_in, check_out,
              quantity, nightly_prices, subtotal_usd, product_title, policy_snapshot)
           VALUES ($1, $2, $3, $4, $5, 'doble', $6::date, $7::date, 1, $8::jsonb,
                   '100.00', $9::jsonb, $10::jsonb)`,
          [
            randomUUID(),
            id,
            tenantId,
            productId,
            hotelKey,
            night1,
            night2,
            JSON.stringify([{ night: night1, price_usd: "100.00" }]),
            JSON.stringify(title),
            JSON.stringify({
              policyId: null,
              name: "Flexible hasta 48 horas",
              rules: [{ hours_before: 48, percentage: 100 }],
            }),
          ],
        );
      }
      return { id, code };
    };

    const readyBooking = await makeBooking(tenantA, clientId);
    readyCode = readyBooking.code;
    const ready = await issuance.reserveForTenant(tenantA, {
      tenantId: tenantA,
      bookingId: readyBooking.id,
      type: "VOUCHER",
    });
    readyDoc = ready.id;
    const rendered = await rendering.render(readyDoc, tenantA);
    if (!rendered.fileUrl) throw new Error("El voucher de prueba no se renderizó");

    pendingDoc = (
      await issuance.reserveForTenant(tenantA, {
        tenantId: tenantA,
        bookingId: (await makeBooking(tenantA, clientId)).id,
        type: "VOUCHER",
      })
    ).id;

    failedDoc = (
      await issuance.reserveForTenant(tenantA, {
        tenantId: tenantA,
        bookingId: (await makeBooking(tenantA, clientId)).id,
        type: "VOUCHER",
      })
    ).id;
    await db.query(`UPDATE "documents" SET status = 'FAILED', error = 'prueba' WHERE id = $1`, [
      failedDoc,
    ]);

    const tampered = await issuance.reserveForTenant(tenantA, {
      tenantId: tenantA,
      bookingId: (await makeBooking(tenantA, clientId)).id,
      type: "VOUCHER",
    });
    tamperedDoc = tampered.id;
    // La BD prohíbe `..` y rutas absolutas; un segmento `.` sí cabe en la
    // columna pero el validador lo rechaza. Detrás hay un archivo real para
    // comprobar que la respuesta 400 no sirve su contenido.
    sentinelPath = join(apiConfig.documentsDir, "vouchers", "archivo.pdf");
    await writeFile(sentinelPath, "CONTENIDO QUE NO DEBE SERVIRSE");
    await db.query(`UPDATE "documents" SET status = 'READY', file_url = $1 WHERE id = $2`, [
      "vouchers/./archivo.pdf",
      tamperedDoc,
    ]);

    // La comprobación de propiedad ocurre antes que la de estado: para el 404
    // basta con que la fila ajena exista, sin línea ni PDF.
    const foreignBooking = await makeBooking(tenantB, adminB.userId, false);
    foreignDoc = (
      await issuance.reserveForTenant(tenantB, {
        tenantId: tenantB,
        bookingId: foreignBooking.id,
        type: "VOUCHER",
      })
    ).id;
  });

  afterAll(async () => {
    await unlink(sentinelPath).catch(() => undefined);
    const files = await db?.query<{ file_url: string | null }>(
      `SELECT file_url FROM documents WHERE file_url IS NOT NULL`,
    );
    for (const row of files?.rows ?? []) {
      if (row.file_url) {
        await unlink(join(apiConfig.documentsDir, row.file_url)).catch(() => undefined);
      }
    }
    await db?.query(`DELETE FROM "organization" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
    await db?.end();
    await app?.close();
  });

  it("el dueño descarga un PDF con Content-Disposition attachment", async () => {
    const response = await get(`/documents/${readyDoc}/download`, clientCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("un admin de la agencia descarga el documento", async () => {
    const response = await get(`/documents/${readyDoc}/download`, adminACookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
  });

  it("un visitante anónimo recibe 401", async () => {
    const response = await get(`/documents/${readyDoc}/download`);
    expect(response.status).toBe(401);
  });

  it("otro cliente no puede descargar el voucher ajeno (404)", async () => {
    const response = await get(`/documents/${readyDoc}/download`, otherClientCookie);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un admin de la agencia A no descarga un documento de la agencia B (404)", async () => {
    const response = await get(`/documents/${foreignDoc}/download`, adminACookie);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un documento PENDING responde 409 DOCUMENT_PENDING", async () => {
    const response = await get(`/documents/${pendingDoc}/download`, clientCookie);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "DOCUMENT_PENDING" });
  });

  it("un documento FAILED responde 503 DOCUMENT_UNAVAILABLE", async () => {
    const response = await get(`/documents/${failedDoc}/download`, clientCookie);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DOCUMENT_UNAVAILABLE" });
  });

  it("una ruta manipulada responde 400 INVALID_PATH sin leer el archivo", async () => {
    const response = await get(`/documents/${tamperedDoc}/download`, clientCookie);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("CONTENIDO QUE NO DEBE SERVIRSE");
    expect(JSON.parse(body)).toMatchObject({ code: "INVALID_PATH" });
  });

  it("file_url es relativo, con UUID y sin código ni número de documento", async () => {
    const row = await db.query<{ file_url: string; number: number }>(
      `SELECT file_url, number FROM documents WHERE id = $1`,
      [readyDoc],
    );
    const fileUrl = row.rows[0]?.file_url ?? "";
    expect(fileUrl).toMatch(/^vouchers\/[0-9a-f-]{36}\.pdf$/);
    expect(fileUrl).toContain(readyDoc);
    expect(fileUrl).not.toContain(readyCode);
    expect(fileUrl.split("/")).not.toContain(String(row.rows[0]?.number));
    expect(fileUrl.startsWith("http")).toBe(false);

    const publicResponse = await fetch(`${baseUrl}/${fileUrl}`);
    expect(publicResponse.status).toBe(404);
  });
});
