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
 * Recolecta las claves usadas en cada archivo asociando cada llamada al
 * traductor con su declaración más reciente. Así un archivo con dos namespaces
 * (por ejemplo `metadata` en generateMetadata y `nav` en el layout) no aplica
 * todas las claves a ambos. También cubre alias como `tOrg`.
 */
interface TranslatorDeclaration {
  name: string;
  namespace: string;
  index: number;
}

function usedKeysByFile(): Array<[string, string[]]> {
  const declaration =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|'([^']*)')\s*\)|(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[^}]*?namespace:\s*(?:"([^"]*)"|'([^']*)')/g;
  const call = /\b(\w+)\(\s*(?:"([^"]*)"|'([^']*)')\s*[,)]/g;
  const group = (match: RegExpExecArray, positions: number[]): string | null => {
    for (const position of positions) {
      if (match[position] !== undefined) return match[position] ?? null;
    }
    return null;
  };

  return sourceFiles().map((file) => {
    const text = readFileSync(file, "utf8");
    const declarations: TranslatorDeclaration[] = [];
    declaration.lastIndex = 0;
    let found = declaration.exec(text);
    while (found) {
      const name = group(found, [1, 4]);
      const namespace = group(found, [2, 3, 5, 6]);
      if (name !== null) {
        declarations.push({ name, namespace: namespace ?? "", index: found.index });
      }
      found = declaration.exec(text);
    }

    const keys: string[] = [];
    call.lastIndex = 0;
    found = call.exec(text);
    while (found) {
      const name = found[1];
      const key = group(found, [2, 3]);
      const position = found.index;
      const owner = declarations
        .filter((entry) => entry.name === name && entry.index < position)
        .at(-1);
      if (key !== null && owner) {
        keys.push(owner.namespace ? `${owner.namespace}.${key}` : key);
      }
      found = call.exec(text);
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
