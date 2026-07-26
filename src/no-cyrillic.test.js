import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// Anchored to the package root through import.meta.url, not process.cwd(): the guard
// has to be correct however it was invoked (from the repo root, from a workspace
// runner, from an editor) instead of silently depending on the working directory.
//
// In this repository the package root IS the repository root, so the walk below also
// covers skills/, docs/, examples/ and .github/. That is deliberate and not an
// accident of the layout: every one of those is read by a stranger who clones this —
// skills/handoff-audit/SKILL.md and docs/mcp-contract.md are opened as often as the
// README, and a half-translated example plan is exactly as confusing as a translated
// README. The guard covers what the public sees, so it grows when the tree grows.
const PKG_ROOT = fileURLToPath(new URL("../", import.meta.url));

// node_modules is excluded and must stay excluded: third-party READMEs are full of
// Cyrillic and would keep the guard permanently red for reasons no contributor here
// can fix. The rest is build and VCS output, not something anyone reads.
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

// Everything a reader of the public repository actually opens. README.md is the most
// read file in an npm package and package.json ships beside it — both belong here.
const WATCHED = /\.(js|mjs|cjs|ts|md|json|yml|yaml)$/;

// …plus the files at the package root that carry no extension at all. LICENSE is the
// one that matters: it ships inside the tarball, and it is a legal instrument — a
// translated line in it is worse than a translated line anywhere else here. Root only,
// and only names with no dot, so this never reaches for a binary somewhere in the tree.
const EXTENSIONLESS = /^[^.]+$/;

function walk(dir, atRoot = true) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, false));
    else if (WATCHED.test(entry.name) || (atRoot && EXTENSIONLESS.test(entry.name))) out.push(p);
  }
  return out;
}

// The range is written with escapes, not with literal letters: this file lives inside
// the tree it guards, and a literal range would flag the guard itself.
const CYRILLIC = /[\u0400-\u04FF]/;

// A contributor who trips this deserves a diagnosis, not a hunt: report the file, the
// line number and the offending line itself.
function offences(file) {
  const rel = relative(PKG_ROOT, file);
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, i) => (CYRILLIC.test(line) ? [`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`] : []));
}

describe("the public repository is English-only", () => {
  it("has no Cyrillic characters anywhere in the repo, including skills, docs, examples and LICENSE", () => {
    const found = walk(PKG_ROOT).flatMap(offences);
    expect(found).toEqual([]);
  });
});
