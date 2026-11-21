import { chromium } from "@playwright/test";

/**
 * Verifica las rutas públicas fijas en ambos idiomas (change f1-navigation-refresh).
 * Uso: pnpm --filter @caribe/web verify:navigation
 * Requiere el servidor web arrancado en CARIBE_WEB_URL (por defecto :3000).
 */
const baseUrl = process.env.CARIBE_WEB_URL ?? "http://localhost:3000";
const locales = ["es", "en"];
const routes = [
  "/",
  "/search",
  "/hotels/navigation-check",
  "/checkout/navigation-check",
  "/login",
  "/two-factor",
  "/account/trips",
];
const notFoundTitles = ["Página no encontrada", "Page not found"];

const browser = await chromium.launch();
const failures = [];

try {
  for (const locale of locales) {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const route of routes) {
      const path = `/${locale}${route}`;
      const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      const lang = await page.locator("html").getAttribute("lang");
      const text = await page.locator("body").innerText();
      const problems = [];
      if (status !== 200) problems.push(`HTTP ${status}`);
      if (lang !== locale) problems.push(`lang=${lang ?? "ausente"}`);
      if (notFoundTitles.some((title) => text.includes(title))) problems.push("muestra 404");
      if (problems.length > 0) {
        failures.push(`${path}: ${problems.join(", ")}`);
        console.error(`FAIL ${path}: ${problems.join(", ")}`);
      } else {
        console.log(`OK   ${path}`);
      }
    }
    await context.close();
  }

  // La cabecera pública solo muestra acciones del cliente; el enlace 2FA vive en la cuenta.
  const session = {
    user: { id: "nav-check", email: "cliente@example.com" },
    session: { id: "nav-check-session" },
  };
  for (const locale of locales) {
    const context = await browser.newContext();
    await context.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      }),
    );
    const page = await context.newPage();

    await page.goto(`${baseUrl}/${locale}`, { waitUntil: "domcontentloaded" });
    await page.locator(`.site-header a[href="/${locale}/account/trips"]`).waitFor();
    const headerText = await page.locator(".site-header").innerText();
    if (headerText.includes("Seguridad") || headerText.includes("Security")) {
      failures.push(`/${locale}: la cabecera pública muestra Seguridad`);
      console.error(`FAIL /${locale}: la cabecera pública muestra Seguridad`);
    } else {
      console.log(`OK   /${locale}: cabecera sin Seguridad`);
    }

    await page.goto(`${baseUrl}/${locale}/account/trips`, { waitUntil: "domcontentloaded" });
    const securityLabel = locale === "es" ? "Seguridad" : "Security";
    const securityLink = page.locator(`a[href="/${locale}/two-factor"]`);
    await securityLink.waitFor();
    if ((await securityLink.innerText()).trim() !== securityLabel) {
      failures.push(`/${locale}/account/trips: falta el enlace ${securityLabel}`);
      console.error(`FAIL /${locale}/account/trips: falta el enlace ${securityLabel}`);
    } else {
      console.log(`OK   /${locale}/account/trips: enlace ${securityLabel}`);
    }
    await context.close();
  }

  // Badge compacto: solo BCV y el monto; la fecha valor sigue en el detalle.
  for (const locale of locales) {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/${locale}`, { waitUntil: "domcontentloaded" });
    const badge = page.locator('.site-header [role="status"]').first();
    await badge.waitFor();
    // La tasa llega por fetch: el texto provisional termina en elipsis.
    await page
      .waitForFunction(
        () => {
          const node = document.querySelector('.site-header [role="status"]');
          return Boolean(node) && !/…|\.\.\.$/.test(node.textContent ?? "");
        },
        null,
        { timeout: 8000 },
      )
      .catch(() => {});
    const text = (await badge.innerText()).trim();
    const label = locale === "es" ? "Tasa BCV" : "BCV rate";
    const hasDateOrUnit = /(?:Bs\/\$|VES\/USD|\bdel\b|\bon\b|\b\d{1,2}\s+[a-z]{3}\b)/i.test(text);
    const idle = /(?:no disponible|unavailable|…)$/.test(text);
    const amount = text.startsWith(label) ? text.slice(label.length).trim() : "";
    const compact = idle || /^\d+[.,]\d{2}$/.test(amount);
    if (hasDateOrUnit || !compact) {
      failures.push(`/${locale}: badge no compacto (${text})`);
      console.error(`FAIL /${locale}: badge no compacto (${text})`);
    } else {
      console.log(`OK   /${locale}: badge compacto (${text})`);
    }
    await page.close();
  }

  // Escena del buscador: fondo local, 100vh y mismo formulario que /search.
  const stagePage = await browser.newPage();
  await stagePage.goto(`${baseUrl}/es`, { waitUntil: "load" });
  const stage = stagePage.locator("#search");
  await stage.waitFor();
  const asset = await stagePage.request.get(`${baseUrl}/images/kinetic-giro.svg`);
  if (asset.status() !== 200) {
    failures.push(`/images/kinetic-giro.svg: HTTP ${asset.status()}`);
  }
  const stageStyles = await stage.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    viewport: window.innerHeight,
    backgroundImage: getComputedStyle(node).backgroundImage,
  }));
  if (stageStyles.height < stageStyles.viewport - 1) {
    failures.push(`/es: buscador mide ${stageStyles.height}px y el viewport ${stageStyles.viewport}px`);
  }
  if (!stageStyles.backgroundImage.includes("kinetic-giro.svg")) {
    failures.push(`/es: fondo inesperado ${stageStyles.backgroundImage}`);
  }
  const blur = await stagePage
    .locator("#search .search-glass")
    .evaluate((node) => getComputedStyle(node).backdropFilter);
  if (!blur.includes("blur")) failures.push(`/es: superficie sin glass (${blur})`);
  const homeForm = stagePage.locator("#search form");
  const homeAction = await homeForm.getAttribute("action");
  const homeFields = await homeForm.locator("input, select, button").count();
  await stagePage.goto(`${baseUrl}/es/search`, { waitUntil: "load" });
  const searchForm = stagePage.locator("form[action='/es/search']").first();
  await searchForm.waitFor();
  const searchFields = await searchForm.locator("input, select, button").count();
  if (homeAction !== "/es/search" || homeFields !== searchFields || homeFields === 0) {
    failures.push(`/es: formularios divergentes (${homeAction}, ${homeFields} vs ${searchFields})`);
  } else {
    console.log("OK   /es: buscador a 100vh con giro local y un solo formulario");
  }
  await stagePage.close();

  // Flecha del hero: ancla, foco por teclado y movimiento reducido.
  const home = await browser.newPage();
  await home.goto(`${baseUrl}/es`, { waitUntil: "domcontentloaded" });
  const arrow = home.locator('a[href="#search"]');
  await arrow.waitFor();
  const smooth = await home.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  );
  if (smooth !== "smooth") failures.push(`/es: scroll-behavior=${smooth}`);
  await arrow.click();
  await home.waitForFunction(() => location.hash === "#search" && window.scrollY > 100);
  console.log("OK   /es: flecha al buscador");

  await home.goto(`${baseUrl}/es`, { waitUntil: "domcontentloaded" });
  let focusedArrow = false;
  for (let step = 0; step < 30; step += 1) {
    await home.keyboard.press("Tab");
    focusedArrow = await home.evaluate(
      () => document.activeElement?.getAttribute("href") === "#search",
    );
    if (focusedArrow) break;
  }
  const outline = focusedArrow
    ? await home.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return { width: style.outlineWidth, style: style.outlineStyle };
      })
    : null;
  if (!outline || outline.style === "none" || Number.parseFloat(outline.width) < 2) {
    failures.push("/es: la flecha no tiene foco visible");
  } else {
    console.log("OK   /es: foco visible en la flecha");
  }

  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${baseUrl}/es`, { waitUntil: "domcontentloaded" });
  const reducedBehavior = await reducedPage.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  );
  if (reducedBehavior !== "auto") failures.push(`/es: movimiento reducido=${reducedBehavior}`);
  const animated = await home.locator(".hero-enter").first().evaluate((node) => getComputedStyle(node).animationName);
  const rising = await home.locator(".scroll-rise").first().evaluate((node) => getComputedStyle(node).animationName);
  if (animated !== "caribe-rise" || rising !== "caribe-rise") {
    failures.push(`/es: animaciones ausentes (${animated}, ${rising})`);
  } else {
    console.log("OK   /es: entrada y revelación animadas");
  }
  const reducedRise = await reducedPage.locator(".scroll-rise").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { name: style.animationName, opacity: style.opacity, transform: style.transform };
  });
  if (reducedRise.name !== "none" || reducedRise.opacity !== "1" || reducedRise.transform !== "none") {
    failures.push(`/es: movimiento reducido no desactiva las animaciones (${JSON.stringify(reducedRise)})`);
  } else {
    console.log("OK   /es: animaciones desactivadas con movimiento reducido");
  }
  await reducedPage.locator('a[href="#search"]').click();
  await reducedPage.waitForFunction(() => location.hash === "#search" && window.scrollY > 100);
  console.log("OK   /es: salto inmediato con movimiento reducido");
  await reduced.close();

  // El gesto no queda fuera de pantalla en viewports bajos y se retira al salir.
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 600 },
  ]) {
    const short = await browser.newPage({ viewport });
    await short.goto(`${baseUrl}/es`, { waitUntil: "load" });
    const cue = short.locator('a[href="#search"]');
    await cue.waitFor({ state: "visible" });
    const box = await cue.boundingBox();
    if (!box || box.y < 0 || box.y + box.height > viewport.height) {
      failures.push(`/es ${viewport.width}x${viewport.height}: flecha fuera del viewport`);
    } else {
      console.log(`OK   /es ${viewport.width}x${viewport.height}: flecha dentro del viewport`);
    }
    await short.close();
  }

  await home.goto(`${baseUrl}/es`, { waitUntil: "load" });
  const cue = home.locator('a[href="#search"]');
  await cue.waitFor({ state: "visible" });
  await home.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, document.body.scrollHeight);
  });
  await cue.waitFor({ state: "hidden" });
  console.log("OK   /es: flecha se retira al salir del hero");

  // Segunda flecha a destacados y tarjetas con datos de la API.
  await home.goto(`${baseUrl}/es`, { waitUntil: "load" });
  await home.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.querySelector("#search")?.scrollIntoView();
  });
  // La sección crece al cargar los productos: esperar evita que el ancla se
  // quede cortada por la altura previa del documento.
  await home.locator('[data-featured-status="ready"]').waitFor();
  const featuredCue = home.locator('a[href="#destacados"]');
  await featuredCue.waitFor({ state: "visible" });
  await featuredCue.click();
  await home.waitForFunction(() => location.hash === "#destacados");
  const featuredTop = await home.locator("#destacados").evaluate((node) => node.getBoundingClientRect().top);
  if (Math.abs(featuredTop) > 120) {
    failures.push(`/es: la flecha a destacados no llegó a la sección (top=${featuredTop})`);
  } else {
    console.log("OK   /es: flecha a destacados");
  }
  await home.locator('[data-featured-status="ready"]').waitFor();
  const cards = home.locator("#destacados article");
  const cardCount = await cards.count();
  const firstTitle = cardCount > 0 ? (await cards.first().locator("h3").innerText()).trim() : "";
  if (cardCount === 0 || firstTitle.length === 0) {
    failures.push("/es: no hay destacados con datos reales");
  } else {
    console.log(`OK   /es: ${cardCount} destacados reales (${firstTitle})`);
  }
  const soonCount = await home.locator("#destacados").getByText("Próximamente", { exact: true }).count();
  if (soonCount !== 3) failures.push(`/es: ${soonCount} etiquetas Próximamente (esperadas 3)`);
  else console.log("OK   /es: Tours, Paquetes y Vuelos marcados como próximamente");
} finally {
  await browser.close();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\n${failures.length} ruta(s) fallaron.`);
  process.exit(1);
}
console.log(
  `\nOK: ${locales.length * routes.length} rutas y la navegación de cuenta verificadas en es y en.`,
);
