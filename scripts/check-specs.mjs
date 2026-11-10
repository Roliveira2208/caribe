#!/usr/bin/env node
// Valida estructura de specs y changes. Uso: node scripts/check-specs.mjs
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "openspec";
const errors = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const dirs = (p) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : [];

const baseBlocks = [
  "## Purpose",
  "## Requirements",
  "## Casos límite",
  "## Acceptance",
  "## Out of scope",
];
const specIds = new Set(dirs(join(root, "specs")));

for (const d of specIds) {
  const f = join(root, "specs", d, "spec.md");
  if (!existsSync(f)) {
    err(f, "falta spec.md");
    continue;
  }
  const t = readFileSync(f, "utf8");
  for (const b of baseBlocks) if (!t.includes(b)) err(f, `falta el bloque "${b}"`);
  const reqs = t.split(/^### Requirement:/m).slice(1);
  if (reqs.length === 0) err(f, "sin requisitos");
  reqs.forEach((r, i) => {
    const name = r.split("\n")[0].trim() || `#${i + 1}`;
    if (!/#### Scenario:/.test(r)) err(f, `requisito "${name}" sin escenarios`);
    if (!/\bSHALL\b/.test(r)) err(f, `requisito "${name}" sin SHALL`);
  });
  for (const s of t.split(/^#### Scenario:/m).slice(1)) {
    const n = s.split("\n")[0].trim();
    if (!/- WHEN /.test(s) || !/- THEN /.test(s)) err(f, `escenario "${n}" sin WHEN/THEN`);
  }
}

for (const c of dirs(join(root, "changes")).filter((c) => c !== "archive")) {
  for (const file of ["proposal.md", "tasks.md"]) {
    if (!existsSync(join(root, "changes", c, file))) err(`changes/${c}`, `falta ${file}`);
  }
  const tf = join(root, "changes", c, "tasks.md");
  if (existsSync(tf)) {
    const t = readFileSync(tf, "utf8");
    if (!/^- \[[ x]\] T-/m.test(t)) err(tf, "no hay tareas con formato `- [ ] T-...`");
    for (const m of t.matchAll(/Prueba: ([a-z-]+) ›/g)) {
      if (!specIds.has(m[1])) err(tf, `referencia a spec inexistente "${m[1]}"`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${specIds.size} specs válidas`);
