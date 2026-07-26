import { execFileSync } from "node:child_process";

// The walkthrough header says which branch and commit the frames were shot from, and
// how many files that branch touches. The pure part is kept apart from the git calls
// so it can be tested without a repository.

// Where to count "how many files changed" from. The first branch that exists becomes
// the reference point.
export const BASE_CANDIDATES = ["origin/HEAD", "origin/master", "origin/main", "master", "main"];

// 🔴 HARD-WON LESSON: we counted only UNCOMMITTED changes (`diff HEAD`), so for anyone
// whose work was already committed the header always showed an honest zero —
// "0 files" reads as "nothing changed". What has to be counted is the whole branch
// from its base plus whatever is not committed yet.
export function countChangedFiles(...lists) {
  const all = new Set();
  for (const list of lists) {
    for (const line of String(list ?? "").split("\n")) {
      const f = line.trim();
      if (f) all.add(f);
    }
  }
  return all.size;
}

export function parseGitContext({ branch, sha, baseSha, files, uncommitted }) {
  return {
    branch: String(branch).trim() || null,
    headSha: String(sha).trim().slice(0, 7) || null,
    baseSha: String(baseSha ?? "").trim().slice(0, 7) || null,
    filesChanged: countChangedFiles(files, uncommitted),
  };
}

export function readGitContext(cwd = process.cwd()) {
  // stderr to /dev/null: without it the git usage text (dozens of lines about
  // --histogram and friends) spilled into the walkthrough output and drowned the
  // useful "FAILED …" / "Draft ready" lines.
  const run = (args) => {
    try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return ""; }
  };

  // Not a git repository — we collect no context and print NOTHING. Walkthroughs are
  // often recorded outside a repo (somebody else's application), and git commands
  // there are pure noise.
  if (run(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
    return parseGitContext({ branch: "", sha: "", baseSha: "", files: "", uncommitted: "" });
  }

  // The base of the branch: the commit this piece of work started from.
  let baseSha = "";
  for (const ref of BASE_CANDIDATES) {
    const resolved = run(["rev-parse", "--abbrev-ref", ref]).trim() || ref;
    const merged = run(["merge-base", "HEAD", resolved]).trim();
    if (merged) { baseSha = merged; break; }
  }

  return parseGitContext({
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    sha: run(["rev-parse", "HEAD"]),
    baseSha,
    // What has been done in the branch…
    files: baseSha ? run(["diff", "--name-only", `${baseSha}..HEAD`]) : "",
    // …and what is not committed yet.
    uncommitted: run(["diff", "--name-only", "HEAD"]),
  });
}
