import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * Capturas de revision de F1. Se ejecuta a mano con el servidor web arrancado:
 *   pnpm --filter @caribe/web capture:screenshots home
 * No se importa desde src/ y no forma parte del build de produccion.
 */
const baseUrl = process.env.CARIBE_WEB_URL ?? "http://localhost:3000";
const outputRoot = join(process.cwd(), "..", "..", "docs", "plans", "screenshots", "f1-visual-identity");

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`No se pudo consultar ${path}: HTTP ${response.status}`);
  return response.json();
}

function nextDay(night) {
  const date = new Date(`${night}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function firstOpenNight(productId) {
  const availability = await fetchJson(
    `/api/v1/products/${encodeURIComponent(productId)}/availability`,
  );
  const night = availability.nights?.find((item) => Number(item.remaining) > 0)?.night;
  return typeof night === "string" ? night : null;
}

/**
 * Resuelve un producto publicado real con cupo, priorizando el que tiene fotos.
 * Los IDs y las fechas del seed cambian entre corridas: fijarlos haría capturas
 * engañosas o pantallas sin CTA.
 */
async function resolveProduct() {
  const catalog = await fetchJson("/api/v1/products?limit=50");
  const candidates = [];
  for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
    if (typeof item.id !== "string") continue;
    const night = await firstOpenNight(item.id);
    if (night) {
      candidates.push({
        id: item.id,
        night,
        images: Array.isArray(item.attributes?.images) ? item.attributes.images.length : 0,
      });
    }
  }
  if (candidates.length === 0) throw new Error("No hay productos públicos con cupo para capturar");
  candidates.sort((a, b) => b.images - a.images);
  return candidates[0];
}

const overrideId = process.env.CARIBE_CAPTURE_PRODUCT_ID;
const resolved = overrideId
  ? { id: overrideId, night: await firstOpenNight(overrideId), images: 0 }
  : await resolveProduct();
if (!resolved.night) throw new Error(`El producto ${resolved.id} no tiene noches con cupo`);

const checkIn = resolved.night;
const checkOut = nextDay(checkIn);
const productId = resolved.id;

// Las imágenes del seed apuntan a un host de ejemplo. Se intercepta el
// optimizador local para documentar la galería sin depender de ese host.
const mockImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#0e2a3d"/><rect width="420" height="900" fill="#f4a300"/><rect x="780" width="420" height="900" fill="#1fa6a0"/><circle cx="600" cy="450" r="210" fill="#fbf7ef"/></svg>`;

const screens = [
  { name: "home", path: "/es" },
  { name: "search", path: "/es/buscar" },
  { name: "detail", path: `/es/hoteles/${productId}` },
  {
    name: "checkout",
    path: `/es/checkout/${productId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=1`,
  },
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const requested = process.argv.slice(2);
const selected = requested.length > 0 ? screens.filter((s) => requested.includes(s.name)) : screens;
if (selected.length === 0) throw new Error(`Ninguna pantalla coincide con: ${requested.join(", ")}`);

mkdirSync(outputRoot, { recursive: true });
const browser = await chromium.launch();

async function load(page, path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  // La sesion de Better Auth se resuelve tras la hidratacion. Esperar al
  // contenido del header evita capturar un estado transitorio del boton.
  await page.locator("#site-tools a[href]").first().waitFor({ state: "attached" });
  await page.locator(".site-header").waitFor();
}

async function waitForReadyContent(page, screen) {
  if (screen.name === "search") {
    // El catálogo llega por API: esperar a una tarjeta o al error evita
    // documentar el estado de carga como si fuera la pantalla final.
    await page.locator("article, [role='alert']").first().waitFor();
  }
  if (screen.name === "detail") {
    // El marcador lo emite la vista, no el Suspense: `form` también aparece en
    // el header y provocaría una captura prematura.
    await page
      .locator('[data-detail-status="ready"], [data-detail-status="error"], [data-detail-status="not-found"]')
      .first()
      .waitFor();
  }
  if (screen.name === "checkout") {
    await page
      .locator('[data-checkout-status="ready"], [data-checkout-status="error"], [data-checkout-status="success"]')
      .first()
      .waitFor();
  }
}

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.route("**/_next/image**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: mockImage }),
  );

  for (const screen of selected) {
    await load(page, screen.path);
    await waitForReadyContent(page, screen);
    await page.screenshot({
      path: join(outputRoot, `${screen.name}-${viewport.name}.png`),
    });

    if (screen.name === "home") {
      await page.locator(".search-reveal").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelector(".search-reveal")?.getAttribute("data-reveal") === "visible",
      );
      await page.waitForTimeout(800);
      await page.screenshot({
        path: join(outputRoot, `${screen.name}-search-${viewport.name}.png`),
      });
    }
  }
  await context.close();
}

if (selected.some((screen) => screen.name === "home")) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await load(page, "/es");
  const styles = await page.locator(".search-reveal").evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      opacity: computed.opacity,
      clipPath: computed.clipPath,
      transform: computed.transform,
    };
  });
  const noClip = styles.clipPath === "none" || styles.clipPath === "inset(0px)";
  const noTransform =
    styles.transform === "none" || styles.transform === "matrix(1, 0, 0, 1, 0, 0)";
  if (styles.opacity !== "1" || !noClip || !noTransform) {
    throw new Error(`Movimiento reducido incorrecto: ${JSON.stringify(styles)}`);
  }
  await page.screenshot({ path: join(outputRoot, "home-reduced-motion-desktop.png") });
  await context.close();
}

await browser.close();
console.log(`Capturas guardadas en ${outputRoot}`);
