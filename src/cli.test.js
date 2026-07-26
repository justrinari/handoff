// The flag wiring of bin/handoff.mjs. Everything checked here happens BEFORE the
// browser is launched, so these tests cost nothing and need no Chrome — which is also
// the point of the checks themselves: a bad flag combination must be refused before a
// capture is spent on it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = resolve(fileURLToPath(new URL("../bin/handoff.mjs", import.meta.url)));

let dir, planFile;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "handoff-cli-"));
  planFile = join(dir, "flags.md");
  writeFileSync(planFile, "---\ntitle: Flags\norigin: http://127.0.0.1:1\n---\n\n1. open / — The page\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (args) =>
  new Promise((done) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, HANDOFF_KEY: "" } }, (err, stdout, stderr) =>
      done({ code: err?.code ?? 0, stdout, stderr }),
    );
  });

describe("handoff walk --local", () => {
  it("is documented in --help", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--local <file>");
    expect(stdout).toContain("works without an account");
    // The help is the first surface after `npm i -g`, so what --local does to the clip
    // has to be answered there and not only in the README.
    expect(stdout).toContain("--local implies it");
  });

  // --out and --local are two different "instead of a draft" outputs. Neither may win
  // silently: the run would then do something nobody asked for.
  it("refuses to run together with --out", async () => {
    const { code, stderr } = await run(["walk", planFile, "--local", join(dir, "w.html"), "--out", join(dir, "w.json")]);
    expect(code).toBe(2);
    expect(stderr).toContain("--out and --local");
    expect(stderr).toContain("cannot be combined");
  });

  it("refuses a --local with no path instead of swallowing the next flag", async () => {
    const { code, stderr } = await run(["walk", planFile, "--local", "--headless"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--local needs a path");
  });

  // The promise "--local uploads nothing and needs no key" is not a property of any
  // function — it is a property of WHERE the branch sits in this file. Move it below
  // the upload and every other test here still passes while the help text, the public
  // docs page and the claims ledger all quietly become false. So the position itself
  // is the thing under test.
  it("writes the file BEFORE the upload and BEFORE the key check — the ordering is the promise", () => {
    const src = readFileSync(BIN, "utf8");
    // Anchored patterns, not string literals: the needles must survive rewording and
    // reindentation of the messages around them. And a needle that stops matching has
    // to say so in words — a bare "expected -1 to be greater than -1" reads like a
    // broken test, and the next contributor deletes it instead of fixing the code.
    const at = (re, what) => {
      const m = re.exec(src);
      if (!m) throw new Error(`ordering guard: could not find ${what} in bin/handoff.mjs — if you renamed it, update this test, don't delete it`);
      return m.index;
    };

    const branch = at(/^if \(localFile\) \{/m, "the --local branch");
    const upload = at(/await uploadFrames\(/, "the uploadFrames call");
    const keyCheck = at(/^if \(!cfg\.agentKey\) \{/m, "the key check that guards createDraft");

    // Both below the branch, so a --local run reaches neither: nothing is uploaded,
    // and no key is required.
    expect(upload).toBeGreaterThan(branch);
    expect(keyCheck).toBeGreaterThan(branch);
  });

  // Same kind of guard, same reason: whether a --local run records a screencast is
  // decided by one `&& !localFile` that no other test touches. Delete it and every
  // --local capture pays for a dozen JPEGs a step that nothing will ever read — a
  // minute of somebody's time, silently, with the suite still green and three
  // documents (help, README, the public CLI page) newly wrong.
  it("records no clip on the --local path — the flag implies --no-clip", () => {
    const src = readFileSync(BIN, "utf8");
    const m = /^const recordClip = (.+);$/m.exec(src);
    if (!m) throw new Error("clip guard: could not find `const recordClip = …` in bin/handoff.mjs — if you renamed it, update this test, don't delete it");
    // Both halves: --no-clip stays honoured, and --local switches it off by itself.
    expect(m[1]).toContain('has("no-clip")');
    expect(m[1]).toContain("!localFile");
    // A value nobody passes on is not a promise: the flag has to reach the capture.
    expect(src).toMatch(/walkPlan\(page, plan, \{[^}]*\brecordClip\b[^}]*\}\)/);
  });
});
