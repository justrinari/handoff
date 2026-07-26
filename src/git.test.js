import { describe, it, expect } from "vitest";
import { countChangedFiles, parseGitContext } from "./git.js";

describe("parseGitContext", () => {
  it("reads branch, sha and changed-file count", () => {
    const out = parseGitContext({
      branch: "feat/checkout-v2\n", sha: "abc1234def\n", baseSha: "9f8e7d6c5b\n",
      files: "a.ts\nb.ts\nc.ts\n", uncommitted: "",
    });
    expect(out).toEqual({ branch: "feat/checkout-v2", headSha: "abc1234", baseSha: "9f8e7d6", filesChanged: 3 });
  });

  it("survives a repo with no commits or no diff", () => {
    expect(parseGitContext({ branch: "", sha: "", baseSha: "", files: "", uncommitted: "" }))
      .toEqual({ branch: null, headSha: null, baseSha: null, filesChanged: 0 });
  });
});

// 🔴 HARD-WON LESSON, caught on a live walkthrough: the person's work was already
// committed, and the
// header said "0 files" — which reads as "nothing changed". We were counting only the
// uncommitted part.
describe("countChangedFiles", () => {
  it("counts the branch work, not just what is still uncommitted", () => {
    expect(countChangedFiles("src/a.ts\nsrc/b.ts\n", "")).toBe(2);
  });

  it("adds uncommitted changes on top", () => {
    expect(countChangedFiles("src/a.ts\n", "src/c.ts\n")).toBe(2);
  });

  it("counts a file changed twice only once", () => {
    // The file was fixed in a commit and is being edited right now — that is one file.
    expect(countChangedFiles("src/a.ts\nsrc/b.ts\n", "src/a.ts\n")).toBe(2);
  });

  it("is not fooled by blank lines", () => {
    expect(countChangedFiles("\n\n", null, undefined)).toBe(0);
  });
});
