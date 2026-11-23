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
  "/reservas/CR-2026-0001",
];
const notFoundTitles = ["Página no encontrada", "Page not found"];

const browser = await chromium.launch();
const failures = [];

/** El destino del ancla no debe dejar ver la sección anterior bajo la cabecera. */
async function checkAnchorLanding(page, id, label) {
  const landing = await page.evaluate((target) => {
    const section = document.getElementById(target);
    const strip = document.elementFromPoint(innerWidth / 2, 8)?.closest("section");
    const heading = section.querySelector("h2");
    return {
      top: Math.round(section.getBoundingClientRect().top),
      strip: strip ? strip.id || "hero" : "ninguna",
      headingTop: heading ? Math.round(heading.getBoundingClientRect().top) : -1,
    };
  }, id);
  if (Math.abs(landing.top) > 8 || landing.strip !== id || landing.headingTop < 88) {
    failures.push(`${label}: ancla #${id} mal alineada (${JSON.stringify(landing)})`);
    return;
  }
  console.log(`OK   ${label}: ancla #${id} alineada, sin sección anterior bajo la cabecera`);
}

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

  // El QR del voucher abre una página real que no filtra datos de la reserva.
  for (const locale of locales) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${locale}/reservas/CR-2026-0001`, {
      waitUntil: "domcontentloaded",
    });
    const text = await page.locator("main").innerText();
    const signIn = await page.locator('main a[href*="/login?redirectTo="]').count();
    const problems = [];
    if (!text.includes("CR-2026-0001")) problems.push("no muestra el código");
    if (signIn !== 1) problems.push("sin enlace a iniciar sesión");
    if (/(?:Ana|Pérez|\$|USD|Bs\.?S?|IN_REVIEW|CONFIRMED)/.test(text)) {
      problems.push("muestra datos de la reserva");
    }
    if (problems.length > 0) {
      failures.push(`/${locale}/reservas/CR-2026-0001: ${problems.join(", ")}`);
      console.error(`FAIL /${locale}/reservas/CR-2026-0001: ${problems.join(", ")}`);
    } else {
      console.log(`OK   /${locale}/reservas/CR-2026-0001: código visible, sin datos de la reserva`);
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
        border: style.borderTopWidth,
        shadow: style.boxShadow,
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
    if (shape.border !== "1px" || !shape.shadow.includes("inset")) {
      problems.push("glass sin borde o realce interior");
    }

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
    if (
      (await page.locator('.site-header [role="group"] button[aria-current="true"]').count()) !== 1
    ) {
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

    // Menú móvil: hamburgesa accesible, opciones apiladas y barra sin pegarse al borde.
    const mobile = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await mobile.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
    const mobileBar = mobile.locator(".site-bar");
    await mobileBar.waitFor();
    const mobileBox = await mobileBar.boundingBox();
    const menu = mobile.locator(".site-menu");
    await menu.waitFor();
    const hamburger = await menu.locator("svg.site-menu-icon line").count();
    const menuLabel = await menu.getAttribute("aria-label");
    if (!mobileBox || mobileBox.x < 4 || 360 - (mobileBox.x + mobileBox.width) < 4) {
      failures.push(`/${locale}: barra móvil pegada al borde`);
    } else if (hamburger !== 2 || !menuLabel) {
      failures.push(`/${locale}: falta icono de hamburgesa accesible (${hamburger}, ${menuLabel})`);
    } else if ((await menu.getAttribute("aria-expanded")) !== "false") {
      failures.push(`/${locale}: menú no empieza cerrado`);
    } else {
      await menu.click();
      await mobile.locator('#site-tools[data-open="true"]').waitFor();
      const tools = await mobile.locator("#site-tools").evaluate((node) => ({
        direction: getComputedStyle(node).flexDirection,
        visible: getComputedStyle(node).visibility,
      }));
      const childTops = await mobile.locator("#site-tools > *").evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
      );
      const stacked = childTops.every((top, index) => index === 0 || top > childTops[index - 1]);
      const itemBoxes = await mobile
        .locator('#site-tools a, #site-tools [role="status"], #site-tools [role="group"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return { top: Math.round(rect.top), width: Math.round(rect.width) };
          }),
        );
      const onePerRow =
        itemBoxes.length >= 7 &&
        new Set(itemBoxes.map((box) => box.top)).size === itemBoxes.length &&
        itemBoxes.every((box) => box.width > 200);
      if (
        (await menu.getAttribute("aria-expanded")) !== "true" ||
        tools.direction !== "column" ||
        tools.visible !== "visible" ||
        !stacked ||
        !onePerRow
      ) {
        failures.push(`/${locale}: menú móvil no apila cada ítem (${JSON.stringify(itemBoxes)})`);
      } else {
        console.log(`OK   /${locale}: cabecera móvil con hamburgesa y ${itemBoxes.length} ítems apilados`);
      }
    }
    await mobile.close();
  }

  // Selector de idioma: píldora ES|ENG sin banderas, activo anunciado.
  for (const locale of locales) {
    const nextLocale = locale === "es" ? "en" : "es";
    const languageLabel = locale === "es" ? "Idioma" : "Language";
    const activeLabel = locale === "es" ? "ES" : "ENG";
    const nextLabel = locale === "es" ? "ENG" : "ES";
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/${locale}/search`, { waitUntil: "networkidle" });
    const header = page.locator(".site-header");
    const problems = [];

    if ((await header.locator("select").count()) !== 0) problems.push("queda un select nativo");
    if ((await header.locator('img[src*="/images/flags/"]').count()) !== 0) {
      problems.push("queda una bandera");
    }
    const pill = header.getByRole("group", { name: languageLabel });
    await pill.waitFor();
    const buttons = pill.getByRole("button");
    if ((await buttons.count()) !== 2) problems.push("no hay dos idiomas");
    const texts = (await buttons.allInnerTexts()).map((text) => text.trim());
    if (!texts.includes("ES") || !texts.includes("ENG")) {
      problems.push(`etiquetas=${JSON.stringify(texts)}`);
    }
    const active = pill.locator('[aria-current="true"]');
    if ((await active.count()) !== 1 || (await active.innerText()).trim() !== activeLabel) {
      problems.push("activo incorrecto");
    }

    if (problems.length > 0) {
      failures.push(`/${locale}: selector (${problems.join(", ")})`);
      console.error(`FAIL /${locale}: selector (${problems.join(", ")})`);
    } else {
      console.log(`OK   /${locale}: píldora ES|ENG sin banderas y ${activeLabel} activo`);
    }

    await pill.getByRole("button", { name: nextLabel }).click();
    await page.waitForURL(`${baseUrl}/${nextLocale}/search`);
    await page.waitForLoadState("networkidle");
    const nextLanguageLabel = nextLocale === "es" ? "Idioma" : "Language";
    const switched = page.locator(".site-header").getByRole("group", { name: nextLanguageLabel });
    const switchedActive = switched.locator('[aria-current="true"]');
    if ((await switchedActive.innerText()).trim() !== nextLabel) {
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

  // Contenido ajustado al viewport: el hero no se tapa con la cabecera ni con
  // la flecha, y ninguna sección se sale de la altura disponible (T-NAV-21).
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 640 },
  ]) {
    const layoutPage = await browser.newPage({ viewport });
    await layoutPage.goto(`${baseUrl}/es`, { waitUntil: "networkidle" });
    const layout = await layoutPage.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect
          ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) }
          : null;
      };
      return {
        bar: box(".site-bar"),
        title: box(".hero-section h1"),
        subtitle: box(".hero-section h1 + p"),
        cta: box('.hero-section a[href="/es/search"]'),
        cue: box('.scroll-cue[href="#search"]'),
        hero: box(".hero-section"),
        viewport: window.innerHeight,
        anchorHeadingTop: (() => {
          const search = document.querySelector("#search");
          const top = search.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top, behavior: "instant" });
          return Math.round(search.querySelector("h2").getBoundingClientRect().top);
        })(),
      };
    });
    const problems = [];
    if (!layout.bar || !layout.title || !layout.subtitle || !layout.cta || !layout.cue || !layout.hero) {
      problems.push(" faltan medidas del hero");
    } else {
      if (layout.title.top < layout.bar.bottom || layout.subtitle.top < layout.bar.bottom) {
        problems.push(" texto bajo la cabecera");
      }
      if (layout.cta.bottom > layout.cue.top) problems.push(" CTA solapada por la flecha");
      if (layout.hero.height > layout.viewport + 1) {
        problems.push(` hero de ${layout.hero.height}px supera ${layout.viewport}px`);
      }
      if (layout.anchorHeadingTop <= layout.bar.bottom) {
        problems.push(" encabezado del ancla bajo la cabecera");
      }
    }
    if (problems.length > 0) {
      failures.push(`/es ${viewport.width}x${viewport.height}:${problems.join(",")}`);
    } else {
      console.log(
        `OK   /es ${viewport.width}x${viewport.height}: hero sin solapamiento y ancho útil respetado`,
      );
    }
    await layoutPage.close();
  }

  // Flecha en móvil: dentro del viewport y por encima de la zona segura.
  const arrowMobile = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await arrowMobile.goto(`${baseUrl}/es`, { waitUntil: "domcontentloaded" });
  const mobileArrow = arrowMobile.locator('a[href="#search"]');
  await mobileArrow.waitFor();
  const arrowRect = await mobileArrow.boundingBox();
  if (
    !arrowRect ||
    arrowRect.x < 0 ||
    arrowRect.y < 0 ||
    arrowRect.x + arrowRect.width > 360 ||
    arrowRect.y + arrowRect.height > 640 ||
    arrowRect.height < 44
  ) {
    failures.push(`/es: flecha móvil fuera del viewport (${JSON.stringify(arrowRect)})`);
  } else {
    console.log("OK   /es 360x640: flecha de sección dentro del viewport");
  }
  await arrowMobile.close();

  // Flecha del hero: ancla, foco por teclado y movimiento reducido.
  const home = await browser.newPage();
  await home.goto(`${baseUrl}/es`, { waitUntil: "domcontentloaded" });
  const arrow = home.locator('a[href="#search"]');
  await arrow.waitFor();
  // Todas las flechas arrancan visibles hasta que el IntersectionObserver las
  // resuelve: esperar a una sola evita pulsar la flecha de otra sección.
  await home.waitForFunction(() => document.querySelectorAll('.scroll-cue[data-visible="true"]').length === 1);
  const activeArrow = home.locator('.scroll-cue[data-visible="true"]');
  const smooth = await home.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior,
  );
  if (smooth !== "smooth") failures.push(`/es: scroll-behavior=${smooth}`);
  const arrowBox = await activeArrow.boundingBox();
  const activeHandle = await activeArrow.elementHandle();
  if (!arrowBox || !activeHandle) {
    failures.push("/es: flecha sin geometría");
  } else {
    const restingY = await activeHandle.evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--cue-press-y").trim(),
    );
    await home.evaluate(() => {
      window.__scrollSamples = [];
      const until = performance.now() + 1000;
      const sample = () => {
        window.__scrollSamples.push(Math.round(window.scrollY));
        if (performance.now() < until) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await home.mouse.move(arrowBox.x + arrowBox.width / 2, arrowBox.y + arrowBox.height / 2);
    await home.mouse.down();
    await home.mouse.up();
    const pressed = await activeHandle.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        state: node.getAttribute("data-pressed"),
        descent: style.getPropertyValue("--cue-press-y").trim(),
        scale: style.getPropertyValue("--cue-scale").trim(),
        ripple: getComputedStyle(node, "::after").content,
        transition: style.transitionProperty,
      };
    });
    if (
      restingY !== "0px" ||
      pressed.state !== "true" ||
      pressed.descent !== "8px" ||
      pressed.scale !== "" ||
      pressed.ripple !== "none" ||
      !pressed.transition.includes("transform")
    ) {
      failures.push(`/es: flecha sin descenso suave al pulsar (${JSON.stringify(pressed)})`);
    } else {
      console.log("OK   /es: flecha con descenso suave al pulsar, sin golpe");
    }

    await home.waitForTimeout(1000);
    const scrollSamples = await home.evaluate(() => window.__scrollSamples);
    const positions = [...new Set(scrollSamples)];
    if (positions.length < 4 || positions[0] !== 0) {
      failures.push(`/es: bajada entre secciones sin interpolación (${positions.slice(0, 8)})`);
    } else {
      const monotonic = positions.every((value, index) => index === 0 || value > positions[index - 1]);
      if (!monotonic) {
        failures.push(`/es: bajada entre secciones no monótona (${positions.slice(0, 8)})`);
      } else {
        console.log(`OK   /es: bajada interpolada en ${positions.length} posiciones hasta ${positions.at(-1)}px`);
      }
    }
  }
  await home.waitForFunction(() => location.hash === "#search" && window.scrollY > 100);
  console.log("OK   /es: flecha al buscador");
  await checkAnchorLanding(home, "search", "/es");

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
  const reducedArrow = reducedPage.locator('a[href="#search"]');
  await reducedArrow.waitFor();
  await reducedPage.waitForFunction(
    () => document.querySelectorAll('.scroll-cue[data-visible="true"]').length === 1,
  );
  const reducedActive = reducedPage.locator('.scroll-cue[data-visible="true"]');
  const reducedBox = await reducedActive.boundingBox();
  const reducedHandle = await reducedActive.elementHandle();
  if (reducedBox && reducedHandle) {
    await reducedPage.mouse.move(
      reducedBox.x + reducedBox.width / 2,
      reducedBox.y + reducedBox.height / 2,
    );
    await reducedPage.mouse.down();
    await reducedPage.mouse.up();
    const reducedPress = await reducedHandle.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        state: node.getAttribute("data-pressed"),
        descent: style.getPropertyValue("--cue-press-y").trim(),
        icon: getComputedStyle(node.querySelector("svg")).animationName,
      };
    });
    if (
      reducedPress.state !== "true" ||
      reducedPress.descent !== "0px" ||
      reducedPress.icon !== "none"
    ) {
      failures.push(`/es: pulsación con movimiento reducido no degradada (${JSON.stringify(reducedPress)})`);
    }
  }
  await reducedPage.waitForFunction(() => location.hash === "#search" && window.scrollY > 100);
  console.log("OK   /es: salto inmediato con movimiento reducido");

  await reducedPage.evaluate(() => {
    const closing = document.getElementById("cierre");
    window.scrollTo({ top: closing.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
  });
  const reducedTop = reducedPage.locator('a[href="#inicio"]');
  await reducedTop.waitFor({ state: "visible" });
  await reducedTop.click();
  await reducedPage.waitForFunction(() => location.hash === "#inicio" && window.scrollY < 5);
  const reducedIcon = await reducedTop.locator("svg").evaluate((node) => getComputedStyle(node).animationName);
  if (reducedIcon !== "none") {
    failures.push(`/es: balanceo de subida activo con movimiento reducido (${reducedIcon})`);
  } else {
    console.log("OK   /es: salto inmediato al inicio sin balanceo con movimiento reducido");
  }
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
  // El ancla ya no salta: hay que esperar a que termine la bajada animada.
  await home.waitForTimeout(900);
  await checkAnchorLanding(home, "destacados", "/es");
  console.log("OK   /es: flecha a destacados");
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
  await home.waitForTimeout(900);
  await checkAnchorLanding(home, "cierre", "/es");
  console.log("OK   /es: flecha al cierre");

  // Un solo gesto visible por sección: al cierre la bajada se retira y no se
  // solapa con la subida (spec home-return-to-top-cue, "Un gesto por sección").
  const expectOnlyTopCue = async (where) => {
    try {
      await home.waitForFunction(() => {
        const shown = [...document.querySelectorAll(".scroll-cue")].filter(
          (node) => getComputedStyle(node).visibility === "visible",
        );
        return shown.length === 1 && shown[0].getAttribute("href") === "#inicio";
      });
    } catch {
      // La comprobación siguiente informa de los gestos que quedaron visibles.
    }
    const shown = await home.locator(".scroll-cue").evaluateAll((nodes) =>
      nodes
        .filter((node) => getComputedStyle(node).visibility === "visible")
        .map((node) => node.getAttribute("href")),
    );
    if (shown.length !== 1 || shown[0] !== "#inicio") {
      failures.push(`${where}: gestos visibles ${JSON.stringify(shown)} (esperado solo #inicio)`);
    } else {
      console.log(`OK   ${where}: solo la flecha de subida, sin solape`);
    }
  };
  await expectOnlyTopCue("/es: al llegar al cierre");
  await home.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await expectOnlyTopCue("/es: al final de la página");

  const anchorMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await anchorMobile.goto(`${baseUrl}/es`, { waitUntil: "networkidle" });
  for (const id of ["search", "destacados", "cierre"]) {
    await anchorMobile.evaluate((target) => {
      const node = document.getElementById(target);
      window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
    }, id);
    await checkAnchorLanding(anchorMobile, id, "/es 390x844");
  }
  await anchorMobile.close();
  if ((await home.locator('#cierre a[href="/es/search"]').count()) !== 1) {
    failures.push("/es: falta el CTA del cierre hacia el buscador");
  } else {
    console.log("OK   /es: CTA del cierre hacia el buscador");
  }

  const cueCount = await home.locator(".scroll-cue").count();
  if (cueCount !== 4) {
    failures.push(`/es: ${cueCount} gestos de desplazamiento (esperados 4)`);
  } else {
    console.log("OK   /es: un gesto por sección, con subida en el cierre");
  }
  const topCue = home.locator('a[href="#inicio"]');
  await topCue.waitFor({ state: "visible" });
  const topLabel = await topCue.getAttribute("aria-label");
  const topPath = await topCue.locator("path").getAttribute("d");
  if (topLabel !== "Volver al inicio" || topPath !== "m6 15 6-6 6 6") {
    failures.push(`/es: flecha de subida sin etiqueta o trazo correcto (${topLabel}, ${topPath})`);
  } else {
    console.log("OK   /es: flecha de subida etiquetada y orientada hacia arriba");
  }
  await topCue.click();
  await home.waitForFunction(() => location.hash === "#inicio" && window.scrollY < 5);
  console.log("OK   /es: flecha del cierre devuelve al inicio");

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

  // Confirmación del checkout: sin descargas en IN_REVIEW y solo una ruta REAL
  // cuando la API entrega un documento READY (T-F1-13e).
  const confirmationLabels = {
    es: {
      preview: "Vista previa del voucher",
      legend: "Documento no fiscal",
      refresh: "Actualizar documentos",
      review: "Pago en revisión",
      approved: "Pago aprobado",
      download: "Descargar PDF",
      note: "Los documentos se publican al confirmar el pago.",
    },
    en: {
      preview: "Voucher preview",
      legend: "Non-tax document",
      refresh: "Refresh documents",
      review: "Payment under review",
      approved: "Payment approved",
      download: "Download PDF",
      note: "Documents are issued once payment is confirmed.",
    },
  };
  const readyDocumentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const detailMock = {
    id: "navigation-check",
    hotelKey: "22222222-2222-4222-8222-222222222222",
    roomType: "standard",
    type: "hotel",
    title: { es: "Alojamiento de prueba", en: "Test stay" },
    description: { es: "Estancia de prueba.", en: "Test stay." },
    destination: {
      id: "dest-nav",
      name: { es: "Mérida", en: "Mérida" },
      country: "VE",
      code: "MRD",
    },
    attributes: { stars: 3, maxGuests: 2, amenities: [], images: [] },
    basePriceUsd: "100.00",
    basePriceVes: null,
    cancellationPolicy: null,
  };
  const availabilityMock = {
    productId: "navigation-check",
    from: "2026-12-01",
    to: "2026-12-03",
    nights: [
      { night: "2026-12-01", remaining: 2, priceUsd: "100.00", priceVes: null },
      { night: "2026-12-02", remaining: 2, priceUsd: "100.00", priceVes: null },
    ],
  };
  const bookingMock = {
    id: "33333333-3333-4333-8333-333333333333",
    code: "CRB-CONFIRM01",
    status: "PENDING_PAYMENT",
    expiresAt: "2026-12-03T15:00:00.000Z",
    totalUsd: "200.00",
  };

  for (const locale of locales) {
    const labels = confirmationLabels[locale];
    for (const [caseName, paymentStatus, documents] of [
      ["revisión", "IN_REVIEW", []],
      [
        "aprobado",
        "APPROVED",
        [
          {
            id: readyDocumentId,
            type: "VOUCHER",
            number: 7,
            status: "READY",
            issuedAt: "2026-11-21T15:00:00.000Z",
            downloadPath: `/api/v1/documents/${readyDocumentId}/download`,
          },
        ],
      ],
    ]) {
      const context = await browser.newContext();
      let documentCalls = 0;
      await context.route("**/api/v1/products/navigation-check", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailMock) }),
      );
      await context.route("**/api/v1/products/navigation-check/availability*", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(availabilityMock),
        }),
      );
      await context.route("**/api/v1/bookings", (route) =>
        route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(bookingMock) }),
      );
      await context.route("**/api/v1/bookings/*/payments", (route) =>
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "55555555-5555-4555-8555-555555555555",
            status: paymentStatus,
            amountUsd: "200.00",
            amountVes: "9000.00",
            rate: "45.0000",
          }),
        }),
      );
      await context.route("**/api/v1/bookings/*/documents", (route) => {
        documentCalls += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: documents }),
        });
      });

      const page = await context.newPage();
      await page.goto(
        `${baseUrl}/${locale}/checkout/navigation-check?checkIn=2026-12-01&checkOut=2026-12-03&guests=1`,
        { waitUntil: "domcontentloaded" },
      );
      await page.locator('[data-checkout-status="ready"]').waitFor();
      await page.locator("#traveler-0-fullName").fill("Ana Pérez");
      await page.locator("#traveler-0-documentNumber").fill("V12345678");
      await page.locator('form button[type="submit"]').click();
      await page.locator('[data-checkout-status="payment"]').waitFor();
      await page.locator("#payment-bank").fill("Banco de Venezuela");
      await page.locator("#payment-phone").fill("04125551122");
      await page.locator("#payment-reference").fill("ABC12345");
      await page.locator('form button[type="submit"]').click();
      await page.locator('[data-checkout-status="success"]').waitFor();
      await page.locator(`button:has-text("${labels.refresh}"):not([disabled])`).waitFor();

      const text = await page.locator('[data-checkout-status="success"]').innerText();
      const downloadLinks = await page.locator('a[href*="/api/v1/documents/"]').count();
      const expectedStatus = paymentStatus === "APPROVED" ? labels.approved : labels.review;
      const problems = [];
      if (!text.includes(bookingMock.code)) problems.push("sin código de reserva");
      if (!text.includes(expectedStatus)) problems.push(`sin estado ${expectedStatus}`);
      if (!text.includes(labels.preview)) problems.push("sin vista previa del voucher");
      if (!text.includes(labels.legend)) problems.push("sin leyenda de documento no fiscal");
      if (!text.includes(labels.note)) problems.push("sin nota de documentos");
      if (documentCalls < 1) problems.push("no consultó GET /documents");
      if (caseName === "revisión" && downloadLinks !== 0) problems.push("descarga falsa en revisión");
      if (caseName === "aprobado" && downloadLinks !== 1) problems.push("sin descarga READY");
      if (problems.length > 0) {
        failures.push(`/${locale} ${caseName}: ${problems.join(", ")}`);
        console.error(`FAIL /${locale} ${caseName}: ${problems.join(", ")}`);
      } else {
        console.log(`OK   /${locale} ${caseName}: confirmación honesta con documentos reales`);
      }
      await context.close();
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
