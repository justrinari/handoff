---
name: handoff-audit
description: >
  Use when auditing a live web page and posting the genuinely pin-worthy
  findings back to Handoff as pins (design-review MCP create_comments). Two
  profiles: an objective Tier1 breakage hunt (broken images, dead links,
  console errors, responsive layout breakage, leftover placeholder text) and a
  Tier3 persona audit (--profile tier3: unlabeled form controls, keyboard focus
  traps, overlapping text, judged through a named persona's eyes). Bundled
  Playwright scanner, self-critique gate, posts only what a live designer would
  flag — never lint-grade noise.
---

# Handoff Audit

Turn a live URL into a short list of **pin-worthy** findings on the Handoff
board. The Handoff board is for **judgment, not lint**. A finding earns a pin
only if it clears a live designer's bar: concrete, actionable, worth the time.
Anything a linter (axe/Lighthouse) already emits is CI noise — never post it.

## HARD RULES (non-negotiable)

1. **Every finding carries a screenshot.** No screenshot → do not post it. The
   scanner captures an element-in-context PNG; the poster ships it file → HTTP.
   **Base64 never passes through your context** — do not read the `--out` file,
   do not paste base64 into a tool call.
   Exception: console findings (page-level errors) carry the error lines as
   `console` evidence instead of a screenshot — there is nothing on the page
   to photograph; the board card explains this and shows the lines under
   Details → Console.
2. **Every anchor is unique.** Two findings must never share an anchor (pins
   overlap otherwise). The scanner verifies `querySelectorAll(sel).length === 1`,
   narrows if needed, folds cross-type collisions, or falls back to a pin
   coordinate.
3. **Self-critique gate before posting:** "Would the site owner spend 10 minutes
   fixing this? If no → drop it."
4. **Cap output at the top 5–8 by impact.** If you cut anything — or the scanner's
   `truncated` map shows its own cuts — tell the user what and why. Never
   silently truncate.
5. **Never post contrast/decor/ARIA nitpicks.** The scanner does not detect them
   by design.

## Workflow

### 1. Preflight
Confirm the scanner can run:
```bash
cd skills/handoff-audit && node -e "require.resolve('playwright')"
```
If it fails, tell the user to install and stop:
```bash
cd skills/handoff-audit && npm install && npx playwright install chromium
```

### 2. Read existing pins (avoid duplicates)
Call `get_page_bundle(page_url)` on the `design-review` MCP. Note the selectors
and pin positions of open comments — you will drop any candidate that matches
one (same selector, or a pin/rect landing on the same spot).

### 3. Run the scanner (black box — do NOT read its source)
```bash
cd skills/handoff-audit && node scripts/audit-scan.mjs --url "<PAGE_URL>" --out /tmp/handoff-audit-scan.json
```
Run `node scripts/audit-scan.mjs --help` if you need usage. **stdout is your
working set**: a JSON summary `{ scanned, truncated, candidates }` where each
candidate has `id`, `type`, `viewport`, `selector` (unique, or null with a
`pin` fallback), `rect`, `evidence`, `severity`, `has_screenshot`. The `--out`
file holds the same candidates WITH screenshot base64 — it exists for the
poster in step 6. **Never read it.**

Check `scanned` first: if every viewport is `"failed"`, report a failed scan
and stop — do NOT tell the user the page is clean.

A `"degraded"` status means `networkidle` never fired (ad/analytics-heavy
page) and the scanner fell back to `load` + settle — results are valid, note
it in the report.

For a persona audit, add `--profile tier3` — it runs the tier1 detectors plus
`unlabeled-control`, `focus-trap` and `text-overlap` (see
`references/profiles.md`). The focus-trap pass presses Tab up to 50 times —
read-only, no clicks, no typing, nothing is submitted.

### 4. Judge (this is your job, not the scanner's)
For each candidate in the stdout summary:
- Apply the **self-critique gate** (10-minute test). Drop marginal ones.
- Drop candidates matching an open pin from step 2.
- `dead-link` is the one **heuristic** type: `href="#"` with no JS-trigger
  markers usually means a dead link, but the scanner cannot see
  `addEventListener`. If the element looks like a menu/tab/accordion trigger,
  drop it.
- Candidates with `selector: null` anchor by viewport-specific pin coordinates —
  mention the viewport in the body ("at 320px") so the pin makes sense on a
  desktop board.
- `console-error` candidates carry no pin at all (page-level) and no
  screenshot — judge them from `evidence` (the joined error-line summary).
  The posted card ships the actual lines in `console` and renders them under
  Details → Console, so your `body` should describe the impact, not repeat
  the raw error text.
- Severity values are `High` (critical), `Medium` (actionable), `Low` (polish).
  Use the scanner's value; override only if your judgment differs. (The scanner
  guarantees `has_screenshot: true` for every candidate except console-error,
  which carries `console` evidence instead.)
- Write a short, human `body` per keeper — one problem, one sentence, what's
  wrong and where. Keep or override the scanner's `severity`.

#### Persona lens (tier3 only)

When you ran `--profile tier3`, judge as the persona, not as a generic reviewer:

- Persona = whatever the user named in their request. If they named none, derive
  one from the page type (landing → "first-time mobile visitor"; form-heavy page →
  "someone filling this in for the first time") and NAME IT in your report so the
  user can correct it.
- The gate question shifts from "would the owner spend 10 minutes fixing this?" to
  "does this block THIS person doing THEIR job?" Drop findings the persona would
  never hit.
- Per-type judgment:
  - `text-overlap` false-positives on decorative overlaps — drop freely; keep only
    overlaps that make text unreadable for the persona.
  - `focus-trap` — re-read the evidence (cycle size, unreachable count) before
    keeping; a modal that deliberately traps focus WHILE OPEN is correct UX — flag
    it only when the page loads into the trap.
  - `unlabeled-control` — the bar is "the persona cannot tell what to type", not
    "missing ARIA"; the scanner already treats placeholder/title as a name source
    and skips checkbox/radio. A text input labeled only by adjacent visible text
    can still false-positive — drop those.
- Write pin bodies from the persona's point of view ("Unlabeled field — unclear
  what to enter when signing up on a phone"), not lint-speak ("input lacks
  accessible name").

### 5. Cap
Keep the top **5–8** by impact (`severity` High → Low, mobile breakage first).
Report to the user everything you cut and why — yours AND the scanner's
`truncated` counts.

### 6. Post (via the bundled poster — never via a raw MCP call)
Write a manifest with ONLY ids, bodies and severities:
```json
{
  "page_url": "<PAGE_URL>",
  "findings": [
    { "id": "c3", "body": "Footer Home link goes nowhere (href=\"#\").", "severity": "Medium" }
  ]
}
```
**Candidate ids are scan-local.** Never re-run `audit-scan.mjs` after writing
the manifest — a fresh scan re-numbers `c1..cN` and your manifest would post
the wrong findings. Scan once → judge → manifest → post.

Save it to `/tmp/handoff-audit-post.json`, then run:
```bash
cd skills/handoff-audit && node scripts/audit-post.mjs \
  --scan /tmp/handoff-audit-scan.json --post /tmp/handoff-audit-post.json \
  --config <MCP-CONFIG-FILE>
```
`<MCP-CONFIG-FILE>` is your client's MCP config: `~/.claude.json` (Claude
Code), `~/.cursor/mcp.json` (Cursor). For TOML configs (Codex), use
`--endpoint <mcp-url>` with `$HANDOFF_MCP_TOKEN` set in the environment
instead. The script reads the Bearer token itself and never prints it — do not
echo the token anywhere.

The poster merges anchors and screenshots from the scan file by `id` and makes
one `create_comments` call. Its stdout is the server's response with the
review/comment ids. Your manifest entry stays the same shape (`{id, body,
severity?}`) for every candidate, including `console-error` — the poster is
what maps a console candidate to `{ body, severity, console }` (no
screenshot, no selector/rect/pin/html) automatically; you never write
`console` yourself.

### 7. Report
Tell the user: how many pins you posted — `create_comments` creates **one
review per finding**, so quote the `rvw_` ids from the poster output and link
the web board — plus the list of everything you cut, with reasons, and any
degraded/failed viewports from `scanned`.

## Known limitations

- **Rect-fallback findings skip shot-time verification.** Candidates with
  `selector: null` anchor by coordinates; the pre/post-shot verification and the
  veil check all need a selector, so those screenshots are best-effort. Treat
  them with extra scrutiny in step 4.
- **Shadow DOM is out of scope.** Detectors run against the light DOM; widgets
  rendered inside shadow roots are invisible to the scan.
- **Placeholder regex matches technical prose.** Visible code samples or docs
  text containing "TODO"/"lorem ipsum" will be flagged — that's what the
  judgment gate is for.
- **Flow dead-ends are not detected.** The scanner never walks a scenario — no
  clicks, no typed input, no form submission — so a button that silently does
  nothing after a click is invisible to it. An interactive persona walkthrough
  is a possible future project, deliberately out of scope here.
- **Tier3 detectors are judgment-backed, not lint.** `text-overlap` fires on
  decorative overlaps, `unlabeled-control` on text inputs labeled only by
  adjacent visible text, and `focus-trap` on a deliberately-trapping open modal —
  expected false positives the persona lens (step 4) is there to drop. A target
  stacked (z-index) above a `pointer-events:none` veil can be false-dropped — a
  skipped finding is the safe failure.

## Profiles

This version ships two profiles — **`tier1-breakage`** (default; objective
breakage, the single heuristic exception is documented above) and
**`tier3-persona`** (`--profile tier3`; adds `unlabeled-control`, `focus-trap`,
`text-overlap` and the persona lens in step 4). See `references/profiles.md` for
both rubrics and the Tier2 (conformance vs a reference) stub, added later without
changing this workflow.
