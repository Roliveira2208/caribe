import { expect, test, type Page } from "@playwright/test";

/**
 * T-F1-15: recorrido completo de F1 en Playwright (Chromium).
 *
 * El catálogo, la disponibilidad y la tasa se leen de la API real sembrada;
 * las escrituras (reserva, pago y documentos) se simulan con los contratos
 * estrictos de la API para no ensuciar la base ni depender de aprobación
 * manual. La API real, incluida la concurrencia por el último cupo, está
 * cubierta por `apps/api/test/bookings.e2e.ts` con PostgreSQL y Redis reales.
 */

const apiUrl = process.env.CARIBE_API_URL ?? "http://localhost:3102";

interface Stay {
  productId: string;
  checkIn: string;
  checkOut: string;
  title: string;
  totalUsd: string;
}

async function resolveStay(): Promise<Stay> {
  const catalog = (await (await fetch(`${apiUrl}/api/v1/products?limit=50`)).json()) as {
    items?: Array<{ id: string; title?: { es?: string } }>;
  };
  for (const product of catalog.items ?? []) {
    const availability = (await (
      await fetch(`${apiUrl}/api/v1/products/${encodeURIComponent(product.id)}/availability`)
    ).json()) as { nights?: Array<{ night: string; remaining: string | number; priceUsd: string }> };
    const night = availability.nights?.find((item) => Number(item.remaining) > 0);
    if (!night) continue;
    const checkOutDate = new Date(`${night.night}T00:00:00.000Z`);
    checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
    return {
      productId: product.id,
      checkIn: night.night,
      checkOut: checkOutDate.toISOString().slice(0, 10),
      title: product.title?.es ?? "Hotel de prueba",
      totalUsd: night.priceUsd,
    };
  }
  throw new Error("No hay productos públicos con cupo para el recorrido e2e");
}

function mockImage(route: import("@playwright/test").Route) {
  return route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#0e2a3d"/></svg>',
  });
}

async function mockWrites(page: Page, stay: Stay) {
  const booking = {
    id: "44444444-4444-4444-8444-444444444444",
    code: "CRB-E2E0001",
    status: "PENDING_PAYMENT",
    expiresAt: `${stay.checkOut}T15:00:00.000Z`,
    totalUsd: stay.totalUsd,
  };
  await page.route("**/_next/image**", mockImage);
  await page.route("**/api/v1/bookings", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "null") as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "checkIn",
      "checkOut",
      "productId",
      "quantity",
      "travelers",
    ]);
    expect(body.productId).toBe(stay.productId);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(booking) });
  });
  await page.route("**/api/v1/bookings/*/payments", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "null") as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["bank", "method", "phone", "reference"]);
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/cardNumber|cvv|amountUsd|rate/);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "55555555-5555-4555-8555-555555555555",
        status: "IN_REVIEW",
        amountUsd: stay.totalUsd,
        amountVes: "90000.00",
        rate: "900.0000",
      }),
    });
  });
  await page.route("**/api/v1/bookings/*/documents", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
}

test("buscar, reservar, pagar y ver documentos sin enlaces falsos", async ({ page }) => {
  const stay = await resolveStay();
  await mockWrites(page, stay);

  await page.goto(
    `/es/search?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&guests=1&q=${encodeURIComponent(stay.title)}`,
  );
  const heading = page.locator(`#offer-${stay.productId}`);
  await expect(heading).toBeVisible();
  await heading
    .locator("xpath=ancestor::li[1]")
    .getByRole("link", { name: "Ver detalle" })
    .click();
  await expect(page).toHaveURL(/\/hotels\//);
  await expect(page.getByRole("link", { name: "Reservar" })).toBeVisible();
  await page.getByRole("link", { name: "Reservar" }).click();

  await expect(page).toHaveURL(/\/checkout\//);
  await page.getByLabel("Nombre completo").fill("Ana Pérez");
  await page.getByLabel("Número de documento").fill("V12345678");
  await page.locator('form button[type="submit"]').first().click();
  await expect(page.locator('[data-checkout-status="payment"]')).toBeVisible();

  await page.locator("#payment-bank").fill("Banco de Venezuela");
  await page.locator("#payment-phone").fill("04125551122");
  await page.locator("#payment-reference").fill("E2E12345");
  await page.locator('form button[type="submit"]').last().click();

  await expect(page.locator('[data-checkout-status="success"]')).toBeVisible();
  await expect(page.getByText("CRB-E2E0001").first()).toBeVisible();
  await expect(page.getByText("Documento no fiscal")).toBeVisible();
  await expect(page.locator('a[href*="/api/v1/documents/"]')).toHaveCount(0);
  await expect(page.getByText("Todavía no hay documentos disponibles.")).toBeVisible();
});

test("el detalle de Mis viajes congela la política y la descarga", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  await page.route("**/_next/image**", mockImage);
  await page.route("**/api/auth/get-session", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "e2e-client", email: "cliente@example.com" },
        session: { id: "e2e-session" },
      }),
    }),
  );
  await page.route("**/api/v1/bookings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id,
            code: "CRB-E2E0001",
            status: "CONFIRMED",
            expiresAt: "2026-11-25T15:00:00.000Z",
            totalUsd: "245.80",
            createdAt: "2026-11-21T15:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
  });
  await page.route(`**/api/v1/bookings/${id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id,
        code: "CRB-E2E0001",
        status: "PENDING_PAYMENT",
        expiresAt: "2026-11-25T15:00:00.000Z",
        totalUsd: "245.80",
        paymentStatus: "APPROVED",
        refundEstimate: {
          amountUsd: "245.80",
          amountVes: "221220.00",
          rate: "900.0000",
          valueDate: "2026-11-21",
          percentage: 100,
        },
        items: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            hotelKey: "cayo-mar",
            roomType: "doble",
            title: { es: "Hotel Cayo Mar", en: "Cayo Mar Hotel" },
            checkIn: "2026-11-15",
            checkOut: "2026-11-17",
            quantity: 1,
            nightlyPrices: [{ night: "2026-11-15", priceUsd: "245.80" }],
            subtotalUsd: "245.80",
            policySnapshot: {
              policyId: null,
              name: "Flexible",
              rules: [{ hours_before: 24, percentage: 100 }],
            },
          },
        ],
      }),
    });
  });
  await page.route(`**/api/v1/bookings/${id}/documents`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            type: "VOUCHER",
            status: "READY",
            number: 1,
            issuedAt: "2026-11-21T15:00:00.000Z",
            downloadPath: `/api/v1/documents/66666666-6666-4666-8666-666666666666/download`,
          },
        ],
      }),
    }),
  );

  await page.goto("/es/account/trips");
  await expect(page.getByText("CRB-E2E0001").first()).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle" }).click();
  await expect(page.getByText("Documento no fiscal").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar PDF" })).toHaveCount(1);
  await expect(page.getByText("Aplica 100 %")).toBeVisible();
});
