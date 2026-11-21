import { chromium } from "@playwright/test";

/**
 * Contraste WCAG AA del texto visible de la web publica.
 *   pnpm --filter @caribe/web verify:contrast
 * No se importa desde src/ y no forma parte del build de produccion. Usa solo
 * @playwright/test, ya presente como devDependency.
 */
const baseUrl = process.env.CARIBE_WEB_URL ?? "http://localhost:3000";
const paths = [
  "/es",
  "/es/search",
  "/es/login",
  "/es/two-factor",
  "/es/account/trips",
  "/es/ruta-que-no-existe",
  "/en",
  "/en/search",
];

const auditText = () => {
  // El navegador emite rgb, color(srgb ...) y oklab segun la propiedad. Un
  // canvas de 1x1 normaliza cualquiera de esos formatos a RGBA sin añadir
  // dependencias ni reimplementar la conversion de espacios de color.
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const channels = (value) => {
    if (!value || value === "none" || value === "transparent") return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const rgba = context.getImageData(0, 0, 1, 1).data;
    return [rgba[0], rgba[1], rgba[2], rgba[3] / 255];
  };

  const over = (foreground, background) => {
    const alpha = foreground[3];
    return [
      foreground[0] * alpha + background[0] * (1 - alpha),
      foreground[1] * alpha + background[1] * (1 - alpha),
      foreground[2] * alpha + background[2] * (1 - alpha),
      1,
    ];
  };

  const luminance = (color) => {
    const linear = color.slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };

  const ratio = (first, second) => {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  const chain = (node) => {
    const result = [];
    for (let current = node; current; current = current.parentElement) result.push(current);
    return result.reverse();
  };

  const failures = [];
  const elements = Array.from(document.querySelectorAll("body *"));
  for (const element of elements) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (element.closest('[aria-hidden="true"]')) continue;

    const ancestors = chain(element);
    let opacity = 1;
    let background = [251, 247, 239, 1];
    for (const node of ancestors) {
      const nodeStyle = getComputedStyle(node);
      opacity *= Number.parseFloat(nodeStyle.opacity);
      const color = channels(nodeStyle.backgroundColor);
      if (color && color[3] > 0)
        background = over([...color.slice(0, 3), color[3] * opacity], background);
    }
    if (opacity === 0) continue;

    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const minimum = large ? 3 : 4.5;

    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .slice(0, 70);

    const check = (text, rawColor, pseudo) => {
      if (!text || !rawColor) return;
      const value = channels(rawColor);
      if (!value) return;
      const foreground = over([...value.slice(0, 3), value[3] * opacity], background);
      const actual = ratio(foreground, background);
      if (actual + 0.01 < minimum) {
        failures.push({
          text,
          pseudo,
          ratio: Number(actual.toFixed(2)),
          minimum,
          color: style.color,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(", ")})`,
          tag: element.tagName.toLowerCase(),
          className: String(element.className).slice(0, 120),
        });
      }
    };

    check(directText, style.color, "");
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.placeholder) {
        const placeholder = getComputedStyle(element, "::placeholder").color;
        check(element.placeholder, placeholder, "::placeholder");
      }
    }
  }
  return failures;
};

const browser = await chromium.launch();
const failures = [];
for (const scheme of ["light", "dark"]) {
  for (const path of paths) {
    const context = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    // La sesion y los estados de carga se resuelven tras la hidratacion.
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    // La ruta inexistente se visita a proposito: su pantalla 404 tambien
    // muestra texto y debe cumplir AA. Cualquier otro error si es un fallo.
    if (!response || (response.status() !== 404 && !response.ok())) {
      failures.push({ scheme, path, text: `HTTP ${response?.status() ?? "sin respuesta"}` });
      await context.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    const found = await page.evaluate(auditText);
    for (const item of found) failures.push({ scheme, path, ...item });
    await context.close();
  }
}
await browser.close();

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} texto(s) sin contraste AA`);
  for (const item of failures) {
    console.error(
      `  ${item.scheme} ${item.path} ${item.ratio ?? ""}:1 < ${item.minimum ?? ""} :: ` +
        `${item.text ?? ""} [${item.tag ?? ""} ${item.className ?? ""}${item.pseudo ?? ""}] ` +
        `${item.color ?? ""} sobre ${item.background ?? ""}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `OK: texto visible con contraste AA en claro y oscuro (${paths.length} rutas x 2 esquemas)`,
  );
}
