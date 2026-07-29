#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parsePlan } from "../src/plan.js";
import { openBrowser } from "../src/browser.js";
import { walkPlan } from "../src/walk.js";
import { buildPayload } from "../src/payload.js";
import { uploadFrames, uploadClips, createDraft, revokeWalkthrough, publishWalkthrough, listWalkthroughs, pruneWalkthroughs } from "../src/api.js";
import { readGitContext } from "../src/git.js";
import { renderLocalHtml, formatBytes, failedTally, ATTACH_LIMIT_BYTES } from "../src/local.js";

const USAGE = `handoff walk <plan.md> [options]
handoff publish <wlk_id> [--summary <file.json>]  — publish a draft (and attach a summary)
handoff list              — list your walkthroughs (published ones and drafts)
handoff prune             — delete your drafts and revoked walkthroughs (live links stay)
handoff revoke <slug|id>  — revoke a link you already shared

  --attach <url>     drive an already-running Chrome over CDP
                     (default: launch a separate profile in ~/.handoff/browser)
  --headless         do not show a window
  --settle <ms>      pause after every step (or HANDOFF_SETTLE; give slow SPAs more)
  --no-clip          skip the screencast; the viewer doesn't play it, so this is a free
                     speed-up. --local implies it — nothing there consumes a clip
  --fail-fast        do not create a draft if any step failed (no effect with --local — no draft to skip)
  --out <file>       write the request body to a file instead of creating a draft
  --local <file>     write a self-contained HTML walkthrough instead of creating a
                     draft — works without an account; nothing is uploaded
  --summary <file>   (for publish) a JSON array [{stepIdx, text}, …] — one item per step
  --api <url>        where the Handoff cloud lives (or HANDOFF_API). ALWAYS PASS IT against
                     the cloud: the default is a local Supabase, http://127.0.0.1:54321/functions/v1
  --key <key>        agent key (or HANDOFF_KEY) — the browser extension's "Connect AI agent"
                     screen shows yours; --local needs none
  -h, --help         show this help

Plan actions: open <path> · click <selector> · type <selector> "text" · check <selector> ·
scroll <selector> · wait <selector|ms> (waits only, does NOT take a frame). A target may contain
spaces without quotes — the caption is separated by a dash: click button:has-text("Place order") — Checkout.

The CLI does not write the "what changed" summary: the agent writes it after looking at the recorded
frames and attaches it on publish — the MCP tool publish_walkthrough(walkthroughId, summary).`;

const args = process.argv.slice(2);
const cmd = args[0];

// --help/-h (and an empty invocation) — help on stdout, exit code 0. `walk --help`
// used to treat --help as a path to the plan file and died with an ENOENT stack trace.
if (!cmd || cmd === "--help" || cmd === "-h" || args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const NEEDS_ARG = ["walk", "publish", "revoke"]; // list/prune take no argument
if (!["walk", "publish", "revoke", "list", "prune"].includes(cmd) || (NEEDS_ARG.includes(cmd) && !args[1])) {
  console.error(USAGE);
  process.exit(1);
}

const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

// ONE config for every command: this used to be computed twice, identically, under two
// names — and two copies of the same four lines are one edit away from disagreeing.
const cfg = {
  apiBase: opt("api", process.env.HANDOFF_API ?? "http://127.0.0.1:54321/functions/v1"),
  agentKey: opt("key", process.env.HANDOFF_KEY ?? ""),
};

// Four of the five commands cannot do anything at all without a key, and said so in
// four copies of the same three lines. `walk` deliberately does NOT use this: it has
// its own message, further down, because by then a capture exists and --local can
// still save it.
const requireKey = () => {
  if (cfg.agentKey) return;
  console.error("An agent key is required: pass --key or set HANDOFF_KEY.");
  process.exit(2);
};

// Revoking is the only "stop" button for a link that is already in people's chats.
if (cmd === "revoke") {
  requireKey();
  const res = await revokeWalkthrough(args[1], cfg);
  console.log(res.alreadyRevoked
    ? `Link ${res.slug} had already been revoked.`
    : `Link ${res.slug} revoked — the page no longer opens.`);
  process.exit(0);
}

// Publishing from the CLI is homogeneous with revoke (no browser needed). The summary
// is read from a JSON file: [{stepIdx, text}, …], one item per step. Without --summary
// we simply publish; calling again with a fresh summary updates it in place.
if (cmd === "publish") {
  requireKey();
  const summaryFile = opt("summary");
  let summary;
  if (summaryFile) {
    try { summary = JSON.parse(readFileSync(summaryFile, "utf8")); }
    catch (e) { console.error(`could not read summary ${summaryFile}: ${e.message}`); process.exit(2); }
  }
  const res = await publishWalkthrough(args[1], summary, cfg);
  console.log(res.alreadyPublished
    ? `Updated: ${res.url}${summary ? " (summary updated)" : ""}`
    : `Published: ${res.url}`);
  process.exit(0);
}

if (cmd === "list") {
  requireKey();
  const items = await listWalkthroughs(cfg);
  if (items.length === 0) { console.log("No walkthroughs yet."); process.exit(0); }
  for (const w of items) {
    const tail = w.url ? `  ${w.url}` : "";
    console.log(`  ${w.status.padEnd(10)} ${w.walkthroughId}  ${w.planKey ?? "—"}  "${w.title}"${tail}`);
  }
  process.exit(0);
}

if (cmd === "prune") {
  requireKey();
  // Name the two kinds separately: "deleted 4" after a prune the user expected to
  // hit drafts only would read as data loss. Revoked ones take their notes with them,
  // so that is said out loud rather than discovered later.
  const { pruned, drafts, revoked } = await pruneWalkthroughs(cfg);
  const parts = [];
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? "" : "s"}`);
  if (revoked) parts.push(`${revoked} revoked (with their notes)`);
  // A server older than the breakdown answers with the total alone: fall back to it
  // rather than printing "Deleted ." at a user who just deleted something.
  const what = parts.length ? parts.join(" and ") : `${pruned} walkthrough${pruned === 1 ? "" : "s"}`;
  console.log(pruned === 0
    ? "Nothing to delete: no drafts, no revoked walkthroughs."
    : `Deleted ${what}. Live links are untouched.`);
  process.exit(0);
}

// ─── walk ─── everything below this line is the walk command. The other four each
// have an explicit `if (cmd === "…")` block above and exit inside it; walk is what
// falls through, which a reader otherwise only discovers at the bottom of the file.

// Forgetting the plan path while adding a flag (`walk --local out.html`) used to read
// the flag as the filename and die with a raw ENOENT stack. A path is never a flag,
// and an unreadable one is answered in a sentence.
if (args[1].startsWith("--")) {
  console.error(`Missing the plan file: "${args[1]}" is a flag, not a path.\n`);
  console.error(USAGE);
  process.exit(1);
}
let planText;
try {
  planText = readFileSync(args[1], "utf8");
} catch (e) {
  console.error(`Could not read the plan: ${e.message}`);
  process.exit(2);
}
const plan = parsePlan(planText);
// The plan file IS the walkthrough's identity: `help.md` stays `help.md`,
// however the title inside may read.
plan.planKey = basename(args[1]).replace(/\.md$/i, "");

// Pause after every step. Slow SPAs (data pulled over XHR, buttons rendered seconds
// later) can be given more; an invalid value falls back to the walkPlan default.
const settleRaw = opt("settle", process.env.HANDOFF_SETTLE);
const settle = settleRaw != null && settleRaw !== "" && Number.isFinite(Number(settleRaw))
  ? Number(settleRaw) : undefined;

// Two different "instead of a draft" outputs: --out writes the request body FOR the
// cloud, --local writes a page that never goes near it. Letting one quietly win would
// mean the run does something the person did not ask for, so the combination is
// refused — and refused HERE, before the browser spends a minute on a capture that is
// going to be thrown away.
const outFile = opt("out");
const localFile = opt("local");
// PRESENCE, not value: `--local o.html --out` (a trailing --out with nothing after it)
// gives outFile === undefined, and testing the values would let --local quietly win —
// the very outcome this refusal exists to prevent.
if (has("out") && has("local")) {
  console.error("--out and --local cannot be combined: they are two different outputs.");
  console.error("--out writes the request body for the cloud; --local writes a self-contained HTML file that is never uploaded. Run the command twice if you want both.");
  process.exit(2);
}
// `--local` with nothing after it would be swallowed silently: opt() takes the next
// argument verbatim, so a run would either fall through to the cloud path or write a
// file called "--headless" — after spending a full capture on it.
if (has("local") && (!localFile || localFile.startsWith("--"))) {
  console.error("--local needs a path to write to: --local <file>.");
  process.exit(2);
}

// The clip is only ever consumed by the upload (api.js → payload.js). renderLocalHtml
// never looks at it, so on the --local path every step would open a CDP screencast and
// capture up to a dozen JPEGs for nothing. --no-clip is sold one help line above as a
// free speed-up because the viewer doesn't play it; here it is not a heuristic.
const recordClip = !has("no-clip") && !localFile;
// A one-step plan is the first thing a newcomer runs, so this line has to read right
// at 1 as well as at N.
console.log(`Walkthrough "${plan.title}" — ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"} on ${plan.origin}`);
const { page, close } = await openBrowser({ attach: opt("attach"), headless: has("headless") });
let shots;
try {
  shots = await walkPlan(page, plan, { settle, recordClip });
} finally {
  await close();
}

const failed = shots.filter((s) => s.status === "failed");
for (const s of shots) console.log(`  ${(s.status === "ok" ? "captured" : "FAILED").padEnd(8)}  ${s.title}${s.failure ? " — " + s.failure : ""}`);

// Failures are visible LOUDLY and BEFORE the draft is created: "captured/FAILED" used
// to drown in the log and broken runs went out to publication. --fail-fast creates no
// draft at all.
if (failed.length) {
  console.log(`\n⚠️  ${failed.length} step${failed.length === 1 ? "" : "s"} failed — check before publishing:`);
  for (const s of failed) console.log(`     ✗ ${s.title}${s.failure ? " — " + s.failure : ""}`);
  // --local writes no draft in the first place, and the file it writes is where you
  // SEE the failure (a failed step keeps its place, with its reason). Stopping here
  // would throw that away, so --fail-fast falls through to the write below — the exit
  // code stays 1 either way. Overriding a flag SILENTLY is not on: nobody who watched
  // a step fail goes back to re-read --help before trusting the next line.
  if (has("fail-fast") && localFile) {
    console.log("     (--fail-fast has no effect with --local: there is no draft to skip, and the file below is where you see which step failed.)");
  }
  if (has("fail-fast") && !localFile) {
    console.error("\n--fail-fast: no draft created. Fix the plan and re-shoot.");
    process.exit(1);
  }
}

// --local is the OFFLINE path and it runs BEFORE the upload: not "upload and also save
// a copy". A key in the environment changes nothing here — no frame leaves the machine
// and no draft is created. Want both? Run the command twice.
if (localFile) {
  const html = renderLocalHtml(plan, shots);
  // The capture only exists in memory, and this is its one chance to reach the disk: a
  // mistyped directory would otherwise cost a full browser run and pay back an ENOENT
  // stack trace — the exact failure this flag exists to prevent. Missing directories
  // are created, and anything still unwritable (permissions, a path that is a file, a
  // full disk) is answered in a sentence, keeping Node's errno — it names the path and
  // is the real diagnostic. Exit 2, not 1: 1 already means "the capture had failed
  // steps", and here nothing usable was written at all — the same class as the other
  // "cannot do what you asked" refusals above.
  try {
    mkdirSync(dirname(localFile), { recursive: true });
    writeFileSync(localFile, html);
  } catch (e) {
    // A write can fail PART WAY (ENOSPC is the realistic case for a file this size),
    // and a truncated page that will not open is worse than no page: remove it, so
    // "nothing usable is there" is a fact rather than a hope.
    try { unlinkSync(localFile); } catch {}
    console.error(`\nCould not write the walkthrough: ${e.message}`);
    console.error("There is no usable file at that path and the capture is gone with this run — re-run with --local pointing somewhere writable.");
    process.exit(2);
  }
  const bytes = Buffer.byteLength(html);
  const size = formatBytes(bytes);
  // "Open it in a browser" as the only line would be a cheerful report of a run that
  // captured nothing, so what the file CONTAINS decides the wording (failedTally, in
  // local.js — where it can be tested without spending a browser run).
  const tally = failedTally(failed.length, shots.length);
  console.log(failed.length
    ? `\nWritten to ${localFile} (${size}) — ${tally}; the file shows where.`
    : `\nWalkthrough written to ${localFile} (${size}). Open it in a browser — no account needed. Nothing was uploaded and no draft was created.`);
  if (bytes > ATTACH_LIMIT_BYTES) {
    // The remedy has to be one THIS person can act on: --local exists for people
    // without an account, and "publish it instead" is not advice you can follow
    // without one.
    const alternative = cfg.agentKey
      ? "re-record a shorter plan, or drop --local and send the published link instead."
      : "re-record a shorter plan, or split it into two.";
    // The limit is read from the constant, not spelled out twice: a hardcoded "25 MB"
    // next to a threshold that can be edited is a lie waiting to happen.
    const limit = Math.round(ATTACH_LIMIT_BYTES / 1024 / 1024);
    console.log(`⚠️  ${size} is over the ${limit} MB limit most mail and chat services apply. Every frame is inlined, so the file grows with the step count: ${alternative}`);
  }
  process.exit(failed.length ? 1 : 0);
}

// With a key the frames are always uploaded — even when the result goes to a file.
// Otherwise the agent could not do the very thing the work is split for: look at the
// RECORDED frames, write the summary and only then create the draft. Without a key a
// dry mode remains: see what was recorded without touching the cloud.
// Still frames first, clips second: a clip is decoration, and uploading it can no
// longer cost a step its still frame.
const framed = cfg.agentKey ? await uploadFrames(shots, cfg) : shots;
const uploaded = cfg.agentKey ? await uploadClips(framed, cfg) : framed;
const payload = buildPayload(plan, uploaded, readGitContext());

if (outFile) {
  writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nRequest body written to ${outFile}${cfg.agentKey ? " (frames uploaded)" : " (frames NOT uploaded — no key)"}.`);
  console.log("Write the summary — every item referencing a step — and create the draft:");
  console.log(`  curl -X POST $HANDOFF_API/walkthrough-create -H "Authorization: Bearer <key>" \\
       -H "content-type: application/json" --data @${outFile}`);
  process.exit(failed.length ? 1 : 0);
}

// The capture is already gone by the time we get here, so the message has to point at
// the flag that would have kept it — for a stranger who just installed the package,
// this is the difference between a dead end and a working tool.
if (!cfg.agentKey) {
  console.error("\nAn agent key is required to create a draft: pass --key or set HANDOFF_KEY.");
  console.error("No account? Re-run with --local <file> and the capture is written as a self-contained HTML walkthrough instead.");
  process.exit(2);
}
const draft = await createDraft(payload, cfg);

console.log(`\nDraft ready: ${draft.walkthroughId} (slug ${draft.slug})`);
console.log(`Look at the frames, then publish with a summary over MCP: publish_walkthrough(walkthroughId="${draft.walkthroughId}", summary=[…]).`);
process.exit(failed.length ? 1 : 0);
