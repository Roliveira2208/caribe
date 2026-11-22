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

  // Barra flotante centrada, semitransparente y con enlaces de productos (T-NAV-14).
  for (const locale of locales) {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
    const bar = page.locator(".site-bar");
    await bar.waitFor();
    const shape = await bar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewport: window.innerWidth,
        radius: Number.parseFloat(style.borderRadius),
        background: style.backgroundColor,
        blur: style.backdropFilter || style.webkitBackdropFilter || "",
        transition: style.transitionDuration,
      };
    });
    const problems = [];
    if (shape.top < 8) problems.push(`pegada arriba (${shape.top}px)`);
    if (shape.left < 4 || shape.viewport - shape.right < 4) problems.push("ocupa todo el ancho");
    if (shape.width >= shape.viewport) problems.push("no es mas estrecha que el viewport");
    if (shape.radius < 8) problems.push("sin esquinas redondeadas");
    if (shape.background === "rgb(14, 42, 61)") problems.push("fondo opaco");
    if (!shape.blur.includes("blur")) problems.push("sin desenfoque");
    if (shape.transition === "0s") problems.push("sin transicion suave");

    const expectedTypes = ["hotel", "tour", "package", "flight"];
    const productLinks = page.locator(".site-products a");
    if ((await productLinks.count()) !== expectedTypes.length) {
      problems.push("faltan enlaces de productos");
    } else {
      for (const [index, type] of expectedTypes.entries()) {
        const href = await productLinks.nth(index).getAttribute("href");
        if (href !== `/${locale}/search?type=${type}`) {
          problems.push(`${type}: ${href ?? "sin href"}`);
        }
      }
    }
    if ((await page.locator('.site-header button[role="combobox"]').count()) !== 1) {
      problems.push("falta el selector de idioma");
    }
    if ((await page.locator('.site-header [role="status"]').count()) === 0) {
      problems.push("falta el badge BCV");
    }

    if (problems.length > 0) {
      failures.push(`/${locale}: barra flotante (${problems.join(", ")})`);
      console.error(`FAIL /${locale}: barra flotante (${problems.join(", ")})`);
    } else {
      console.log(`OK   /${locale}: barra flotante centrada con cuatro productos y acciones`);
    }
    await page.close();
  }

  // Selector de idioma: desplegable con banderas VE/US y activo anunciado.
  for (const locale of locales) {
    const nextLocale = locale === "es" ? "en" : "es";
    const languageLabel = locale === "es" ? "Idioma" : "Language";
    const nextLabel = locale === "es" ? "English" : "Español";
    const page = await browser.newPage();
    // El desplegable necesita la hidratación de React para responder al clic.
    await page.goto(`${baseUrl}/${locale}/search`, { waitUntil: "networkidle" });
    const header = page.locator(".site-header");
    const problems = [];

    if ((await header.locator("select").count()) !== 0) problems.push("queda un select nativo");
    const combo = header.getByRole("combobox", { name: languageLabel });
    await combo.waitFor();
    await combo.click();
    await page.waitForFunction(
      () => document.querySelector('button[role="combobox"]')?.getAttribute("aria-expanded") === "true",
      null,
      { timeout: 5000 },
    );
    const list = page.getByRole("listbox", { name: languageLabel });
    const options = list.getByRole("option");
    if ((await options.count()) !== 2) problems.push("no hay dos idiomas");
    const flags = await options.locator('img[src*="/images/flags/"]').count();
    if (flags !== 2) problems.push(`banderas=${flags}`);
    const selected = list.getByRole("option", { selected: true });
    if ((await selected.getAttribute("aria-current")) !== "true") {
      problems.push("activo sin aria-current");
    }

    if (problems.length > 0) {
      failures.push(`/${locale}: selector (${problems.join(", ")})`);
      console.error(`FAIL /${locale}: selector (${problems.join(", ")})`);
    } else {
      console.log(`OK   /${locale}: desplegable con dos banderas y activo resaltado`);
    }

    await list.getByRole("option", { name: nextLabel }).click();
    await page.waitForURL(`${baseUrl}/${nextLocale}/search`);
    await page.waitForLoadState("networkidle");
    const nextLanguageLabel = nextLocale === "es" ? "Idioma" : "Language";
    await page.getByRole("combobox", { name: nextLanguageLabel }).click();
    const switched = page
      .getByRole("listbox", { name: nextLanguageLabel })
      .getByRole("option", { selected: true });
    if ((await switched.innerText()).trim() !== nextLabel) {
      failures.push(`/${nextLocale}/search: el idioma activo no cambió`);
      console.error(`FAIL /${nextLocale}/search: el idioma activo no cambió`);
    } else {
      console.log(`OK   /${locale}: ${nextLabel} abre /${nextLocale}/search y queda activo`);
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
  await homeForm
    .locator("#search-destination option")
    .nth(1)
    .waitFor({ state: "attached", timeout: 8000 })
    .catch(() => {});
  const homeDestinationOptions = await homeForm.locator("#search-destination option").count();
  await stagePage.goto(`${baseUrl}/es/search`, { waitUntil: "load" });
  const searchForm = stagePage.locator("form[action='/es/search']").first();
  await searchForm.waitFor();
  const searchFields = await searchForm.locator("input, select, button").count();
  if (homeAction !== "/es/search" || homeFields !== searchFields || homeFields === 0) {
    failures.push(`/es: formularios divergentes (${homeAction}, ${homeFields} vs ${searchFields})`);
  } else {
    console.log("OK   /es: buscador a 100vh con giro local y un solo formulario");
  }
  if (homeDestinationOptions < 2) {
    failures.push(`/es: la portada no ofrece los mismos destinos (${homeDestinationOptions})`);
  } else {
    console.log(`OK   /es: ${homeDestinationOptions} destinos compartidos con /search`);
  }

  // Un solo buscador: los enlaces de producto preseleccionan su tipo y las
  // categorías sin catálogo siguen marcadas como próximamente (T-NAV-10).
  for (const type of ["hotel", "tour", "package", "flight"]) {
    await stagePage.goto(`${baseUrl}/es/search?type=${type}`, { waitUntil: "domcontentloaded" });
    const typeSelect = stagePage.locator("#search-type");
    await typeSelect.waitFor();
    const selected = await typeSelect.inputValue();
    const disabled = await typeSelect.locator("option[disabled]").count();
    const soonOptions = await typeSelect.locator("option:not([disabled])").allInnerTexts();
    if (selected !== type || disabled !== 0 || !soonOptions.some((text) => /próximamente/i.test(text))) {
      failures.push(`/es/search?type=${type}: Preselección ${selected}, deshabilitadas ${disabled}`);
    }
  }
  await stagePage.getByText("Todavía no hay resultados").waitFor({ timeout: 8000 });
  console.log("OK   /es: tipos preseleccionados y categorías próximamente honestas");
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
  const rhythm = await home.evaluate(() => {
    const read = (selector, property) =>
      getComputedStyle(document.querySelector(selector))[property];
    return {
      hero: read(".hero-enter", "animationTimingFunction"),
      // Con animation-timeline: view() el navegador fuerza linear; la suavidad
      // la da el progreso del scroll, no la curva de tiempo.
      revealTimeline: read(".scroll-rise", "animationTimeline"),
      cue: read(".scroll-cue", "transitionTimingFunction"),
      bar: read(".site-bar", "transitionTimingFunction"),
      cueDuration: read(".scroll-cue", "transitionDuration"),
      barDuration: read(".site-bar", "transitionDuration"),
    };
  });
  const smoothRhythm =
    [rhythm.hero, rhythm.cue, rhythm.bar].every((value) => value.includes("cubic-bezier")) &&
    rhythm.revealTimeline.includes("view") &&
    rhythm.cueDuration !== "0s" &&
    rhythm.barDuration !== "0s";
  if (!smoothRhythm) failures.push(`/es: ritmo de transiciones inconsistente (${JSON.stringify(rhythm)})`);
  else console.log("OK   /es: transiciones suaves con curva compartida");

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

  // Cuatro secciones a pantalla completa y tercera flecha al cierre (T-NAV-15).
  const sections = home.locator("section");
  const sectionCount = await sections.count();
  if (sectionCount !== 4) {
    failures.push(`/es: ${sectionCount} secciones en la portada (esperadas 4)`);
  } else {
    for (let index = 0; index < sectionCount; index += 1) {
      const size = await sections.nth(index).evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        viewport: window.innerHeight,
      }));
      if (size.height < size.viewport - 1) {
        failures.push(`/es: sección ${index + 1} mide ${size.height}px y el viewport ${size.viewport}px`);
      }
    }
    console.log("OK   /es: cuatro secciones a pantalla completa");
  }

  const closingCue = home.locator('a[href="#cierre"]');
  await closingCue.waitFor({ state: "visible" });
  await closingCue.click();
  await home.waitForFunction(() => location.hash === "#cierre");
  const closingTop = await home.locator("#cierre").evaluate((node) => node.getBoundingClientRect().top);
  if (Math.abs(closingTop) > 120) {
    failures.push(`/es: la flecha al cierre no llegó (top=${closingTop})`);
  } else {
    console.log("OK   /es: flecha al cierre");
  }
  if ((await home.locator('#cierre a[href="/es/search"]').count()) !== 1) {
    failures.push("/es: falta el CTA del cierre hacia el buscador");
  } else {
    console.log("OK   /es: CTA del cierre hacia el buscador");
  }

  // Acceso real y "Mis viajes" con datos y estados traducidos (T-NAV-9).
  const bookingRow = {
    id: "nav-booking-1",
    code: "CRB-CARIBE01",
    status: "PENDING_PAYMENT",
    expiresAt: "2026-11-25T15:00:00.000Z",
    totalUsd: "245.80",
    createdAt: "2026-11-21T15:00:00.000Z",
  };
  const labelsByLocale = {
    es: {
      submit: "Entrar",
      status: "Pendiente de pago",
      empty: "Todavía no tienes reservas.",
      error: "No pudimos cargar tus reservas. Inténtalo de nuevo.",
      documents: "Los documentos se publican al confirmar el pago.",
    },
    en: {
      submit: "Sign in",
      status: "Pending payment",
      empty: "You don't have any bookings yet.",
      error: "We couldn't load your bookings. Please try again.",
      documents: "Documents are issued once payment is confirmed.",
    },
  };

  for (const locale of locales) {
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${baseUrl}/${locale}`, { waitUntil: "domcontentloaded" });
    const loginLink = publicPage.locator(`.site-header a[href="/${locale}/login"]`);
    await loginLink.waitFor();
    await loginLink.click();
    await publicPage.waitForURL(`${baseUrl}/${locale}/login`);
    await publicPage.locator("#login-email").waitFor();
    console.log(`OK   /${locale}: «Iniciar sesión» lleva al formulario real`);
    await publicContext.close();
  }

  for (const locale of locales) {
    const labels = labelsByLocale[locale];
    const tripsPath = `/${locale}/account/trips`;
    let signInCalls = 0;
    let bookingsCalls = 0;
    const context = await browser.newContext();
    await context.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      }),
    );
    await context.route("**/api/auth/sign-in/email", (route) => {
      signInCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: session.user }),
      });
    });
    await context.route("**/api/v1/bookings", (route) => {
      bookingsCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [bookingRow], nextCursor: null }),
      });
    });
    const page = await context.newPage();
    await page.goto(
      `${baseUrl}/${locale}/login?redirectTo=${encodeURIComponent(tripsPath)}`,
      { waitUntil: "domcontentloaded" },
    );
    // La cabecera de sesión se pinta tras la hidratación: esperarla evita que
    // el clic llegue antes del handler y provoque un submit nativo.
    await page.locator(`.site-header a[href="${tripsPath}"]`).waitFor();
    await page.locator("#login-email").fill("cliente@example.com");
    await page.locator("#login-password").fill("demo-password");
    await page.getByRole("button", { name: labels.submit }).click();
    await page.waitForURL(`${baseUrl}${tripsPath}`);
    await page.getByText(bookingRow.code).waitFor();

    if (signInCalls !== 1 || bookingsCalls < 1) {
      failures.push(`/${locale}: login o listado no llamaron a la API (${signInCalls}, ${bookingsCalls})`);
    } else {
      console.log(`OK   /${locale}: login real y reservas desde GET /api/v1/bookings`);
    }
    if (
      (await page.getByText(labels.status).count()) < 1 ||
      (await page.locator('time[datetime="' + bookingRow.expiresAt + '"]').count()) !== 1 ||
      (await page.getByText("245.80 USD").count()) < 1 ||
      (await page.getByText(labels.documents).count()) !== 1
    ) {
      failures.push(`/${locale}: falta código, estado, caducidad, total o nota de documentos`);
    } else {
      console.log(`OK   /${locale}: reserva con estado, caducidad, total y nota honesta`);
    }
    if ((await page.locator('a[href*="download"]').count()) !== 0) {
      failures.push(`/${locale}: aparece un enlace de descarga sin identificador real`);
    } else {
      console.log(`OK   /${locale}: sin enlaces de documentos inventados`);
    }
    await context.close();

    for (const [caseName, status, expected] of [
      ["vacío", 200, labels.empty],
      ["error", 500, labels.error],
    ]) {
      const stateContext = await browser.newContext();
      await stateContext.route("**/api/auth/get-session", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(session),
        }),
      );
      await stateContext.route("**/api/v1/bookings", (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: status === 200 ? JSON.stringify({ items: [], nextCursor: null }) : "{}",
        }),
      );
      const statePage = await stateContext.newPage();
      await statePage.goto(`${baseUrl}${tripsPath}`, { waitUntil: "domcontentloaded" });
      await statePage.getByText(expected).waitFor({ timeout: 8000 });
      if (
        caseName === "error" &&
        (await statePage.locator('section [role="alert"]').count()) !== 1
      ) {
        failures.push(`/${locale}: el error de reservas no es accesible`);
      } else {
        console.log(`OK   /${locale}: estado ${caseName} de reservas traducido y accesible`);
      }
      await stateContext.close();
    }
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\n${failures.length} ruta(s) fallaron.`);
  process.exit(1);
}
console.log(
  `\nOK: ${locales.length * routes.length} rutas, acceso real, estados de reservas y navegación de cuenta verificados en es y en.`,
);
