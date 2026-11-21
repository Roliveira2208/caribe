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
const screens = [
  { name: "home", path: "/es" },
  { name: "search", path: "/es/buscar" },
  { name: "detail", path: "/es/hoteles/offer-1" },
  { name: "checkout", path: "/es/checkout/offer-1" },
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
    // El catalogo llega por API: esperar a una tarjeta o al error evita
    // documentar el estado de carga como si fuera la pantalla final.
    await page.locator("article, [role='alert']").first().waitFor();
  }
}

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

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
