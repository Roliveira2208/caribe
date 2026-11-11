import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const LOCALES = ["es", "en"] as const;

function readMessages(locale: (typeof LOCALES)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(appRoot, "messages", `${locale}.json`), "utf8"));
}

function flatten(node: unknown, prefix = ""): Array<[string, unknown]> {
  if (typeof node !== "object" || node === null) return [[prefix, node]];
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? flatten(value, path)
      : [[path, value]];
  });
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(join(appRoot, "src"));
  return out;
}

/**
 * Recolecta las claves de mensajes usadas en cada archivo de src componiendo el
 * namespace (useTranslations/getTranslations) con cada llamada t("clave").
 * Un archivo sin namespace declarado se trata como namespace raiz.
 */
function usedKeysByFile(): Array<[string, string[]]> {
  const stringArg = /(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/g;
  const objectArg = /getTranslations\(\s*\{[^}]*?namespace:\s*(?:"([^"]*)"|'([^']*)')/g;
  const tCall = /\bt\(\s*(?:"([^"]*)"|'([^']*)')\s*[,)]/g;

  const firstGroup = (match: RegExpExecArray): string | null => match[1] ?? match[2] ?? null;

  return sourceFiles().map((file) => {
    const text = readFileSync(file, "utf8");
    const namespaces = new Set<string>();
    for (const re of [stringArg, objectArg]) {
      re.lastIndex = 0;
      let match = re.exec(text);
      while (match) {
        const namespace = firstGroup(match);
        if (namespace !== null) namespaces.add(namespace);
        match = re.exec(text);
      }
    }
    const keys: string[] = [];
    tCall.lastIndex = 0;
    let match = tCall.exec(text);
    while (match) {
      const key = firstGroup(match);
      if (key !== null) {
        if (namespaces.size === 0) keys.push(key);
        else for (const ns of namespaces) keys.push(ns ? `${ns}.${key}` : key);
      }
      match = tCall.exec(text);
    }
    return [file, keys];
  });
}

describe("messages del admin", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    const esKeys = flatten(readMessages("es")).map(([key]) => key);
    const enKeys = flatten(readMessages("en")).map(([key]) => key);

    const missingInEn = esKeys.filter((key) => !enKeys.includes(key));
    const missingInEs = enKeys.filter((key) => !esKeys.includes(key));
    expect(missingInEn, "claves que estan en es.json pero no en en.json").toEqual([]);
    expect(missingInEs, "claves que estan en en.json pero no en es.json").toEqual([]);
  });

  it("todos los valores son cadenas no vacias", () => {
    for (const locale of LOCALES) {
      const leaves = flatten(readMessages(locale));
      expect(leaves.length, `${locale}.json sin mensajes`).toBeGreaterThan(0);
      for (const [key, value] of leaves) {
        expect(typeof value, `${locale}.json: "${key}" no es cadena`).toBe("string");
        expect(String(value).trim().length, `${locale}.json: "${key}" esta vacio`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("toda clave usada en src existe en es y en", () => {
    const esKeys = new Set(flatten(readMessages("es")).map(([key]) => key));
    const enKeys = new Set(flatten(readMessages("en")).map(([key]) => key));
    const problems: string[] = [];

    for (const [file, keys] of usedKeysByFile()) {
      for (const key of keys) {
        if (!esKeys.has(key)) problems.push(`${file}: falta "${key}" en messages/es.json`);
        if (!enKeys.has(key)) problems.push(`${file}: falta "${key}" en messages/en.json`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("los archivos fuente usan mensajes (sin claves usadas el test no protege nada)", () => {
    const usedCount = usedKeysByFile().reduce((sum, [, keys]) => sum + keys.length, 0);
    expect(usedCount).toBeGreaterThan(0);
  });
});
