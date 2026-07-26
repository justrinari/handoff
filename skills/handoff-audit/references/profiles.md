# Audit profiles

A profile = `{ job, detectors, severity rubric, inclusion filter }`. Shipped:
`tier1-breakage` (default) and `tier3-persona` (`--profile tier3`). The skill workflow (preflight → read pins → scan → gate →
cap → post → report) is profile-independent; a new profile only swaps detectors
and the inclusion filter.

## tier1-breakage (shipped — default)

- **Job:** objective breakage; no reference needed; near-zero false positives.
- **Detectors:** broken-image, dead-link, console-error, layout-overflow,
  element-clip, placeholder-text (see `scripts/audit-scan.mjs`).
  `console-error` is page-level and carries no screenshot; the error lines
  ship in the finding's `console` field and render in the card's Details →
  Console instead.
- **Known heuristic:** dead-link (`href="#"`) cannot see `addEventListener`
  handlers; the scanner excludes elements with role/aria/data-toggle/onclick
  markers, and the agent's gate drops anything that looks like a JS trigger.
- **Anti-noise exclusions (in code):** `text-overflow: ellipsis` and line-clamp
  truncation, carousel/slider/marquee containers, `Failed to load resource`
  console messages (duplicate broken-image), script/style/template text,
  invisible elements (`checkVisibility` — a11y-hidden and fade-in wrappers),
  no-src image placeholders, per-type cap ≤10 with cuts recorded in `truncated`.
- **Severity:** broken-image / layout-overflow / element-clip = High;
  dead-link / console-error = Medium; placeholder-text = Low.
- **Inclusion filter:** exclude contrast, decor, and ARIA nitpicks — that is the
  CI noise the board rejects.

## tier2-conformance (stub — not implemented)

- **Job:** drift from an agreed reference — `shared/tokens.ts`, Figma, approved
  copy. Requires the reference as input.
- **Planned detectors:** token/value drift (color/space/radius vs tokens),
  copy mismatch, spacing-scale violations.

## tier3-persona (shipped)

- **Job:** heuristic audit through a named persona's eyes ("first mobile visitor
  signing up"). a11y only as real blockers; decorative a11y stays excluded.
- **Run:** `node scripts/audit-scan.mjs --url <URL> --profile tier3` — every tier1
  detector plus the three below. The persona itself is not code: the agent applies
  it at the Judge step (SKILL.md → "Persona lens").
- **Detectors:**
  - `unlabeled-control` (Medium) — `input`/`select`/`textarea` with NO name source
    at all: no `<label>`, no `aria-label`/`aria-labelledby`, no placeholder, no
    title. Placeholder-only fields do NOT fire (a sighted person can tell what to
    type — flagging that would be ARIA lint). Hidden/submit/button-like inputs,
    checkbox/radio (labeled by adjacent text, not "typed" into), and disabled
    controls are excluded. Known residual: a text input labeled only by adjacent
    visible text can false-positive — the persona lens drops it.
  - `focus-trap` (High) — a read-only Tab traversal (≤50 presses, no clicks, no
    typing); flags a cycle of ≤5 elements repeating ≥3 times while other
    tab-reachable elements remain unreachable. The pin lands on the cycle's common
    ancestor. Counts only genuinely tab-reachable elements (visibility:hidden /
    inert excluded).
  - `text-overlap` (Medium) — two text-bearing elements (own direct text, not
    ancestor/descendant) whose boxes intersect by ≥30% of the smaller one. Known
    false-positive source: decorative overlaps — cut from Tier1 on the 2026-07-07
    revision for exactly this reason; the persona lens judges every hit.
- **Persona:** from the user's request, else derived from the page type and named
  in the report so the user can correct it. Examples: "first-time mobile visitor
  deciding whether to install", "keyboard-only user filling the signup form",
  "returning customer hunting for pricing".
- **Inclusion filter:** a real blocker for the persona, not ARIA hygiene. Contrast,
  decor and ARIA nitpicks stay excluded, exactly as in tier1.
