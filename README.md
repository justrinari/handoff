# get-handoff

Record a click-through walkthrough of a web flow — from a plain-text plan.

`get-handoff` drives a real browser through a plan you write in Markdown and shoots a frame
at every step that does something — `wait` only waits. The result is either a single
self-contained HTML file you can send as an attachment, or — with an agent key — a link on
the [Handoff](https://get-handoff.com) cloud.

## Install

```sh
npm i -g get-handoff
```

Or skip the install and run it with `npx get-handoff …`. The binary answers to both
`handoff` and `get-handoff`.

It needs Node 20 or newer — the floor `playwright-core` sets — and a locally installed
**Google Chrome** — the package ships `playwright-core`, which drives a browser but never
downloads one. Chromium, Edge and Firefox are not substitutes for the browser it launches;
`--attach` is the way to drive something else, and it takes any Chromium-family browser you
started yourself with a debug port.

A plan is Markdown: a front matter block with the `origin`, then one numbered line per
step. `flow.md`:

```markdown
---
origin: https://example.com
---
1. open / — The home page
```

## Without an account

```sh
handoff walk flow.md --local demo.html
```

`--local` writes one self-contained HTML file: every frame is inlined as a `data:` URI, so
there is no network, no server and nothing to revoke — double-click it, or drop it into a
chat. **This path needs no key and uploads nothing**; no draft is created either.

Because the frames are inlined, the file grows with the step count. The CLI prints its size
and warns past 25 MB, which is the attachment ceiling most mail services apply.

A step that fails does not abort the capture: it keeps its place in the file, with the
reason it failed, and the run exits non-zero. The one exception is the window going away —
close the tab or the browser mid-run and the walkthrough stops there, with the steps after
it never shot.

## What the cloud adds

With an agent key, `walk` uploads the frames and creates a draft — nothing is public yet.
`publish` turns that draft into a link, optionally attaching a summary written after
looking at the captured frames. **The published page opens without an account**, and it
only shows: a viewer cannot leave a note on a frame.

```sh
handoff walk flow.md \
  --api https://bhbdmxhgrjzksqpswjye.supabase.co/functions/v1 \
  --key fbt_your_key
```

The key comes from the browser extension, not from a signup form: install
[Handoff](https://chromewebstore.google.com/detail/kdojobaddodgeecdboledochcdndkehf), open
**Connect AI agent**, and expand *Update your token* — the `fbt_…` key is there in full,
with a copy button. The extension mints it on its own, so there is no account to create,
and it is the same key your agent already uses over MCP.

> **The `--api` default is localhost.** Without it the CLI talks to a local Supabase at
> `http://127.0.0.1:54321/functions/v1`, so against the cloud you must always pass it. If
> you happen to be running that local stack, the symptom is `Invalid agent key` with a
> perfectly valid key; if you aren't, it's a bare `fetch failed`.

The rest of Handoff runs in the other direction, and it is the browser extension — not a
walkthrough link — that carries feedback back: someone pins a comment on the live page, and
your coding agent reads those pins over MCP and fixes them in your repo. The team sees the
same pins on a shared board. See [get-handoff.com](https://get-handoff.com).

## Commands

| Command | What it does |
|---|---|
| `handoff walk <plan.md>` | Runs the plan in a browser, captures a frame per step, and creates a draft (or, with `--local`, writes the HTML file). |
| `handoff publish <wlk_id> [--summary file.json]` | Publishes a draft as a public link. The summary is a JSON array of `{ stepIdx, text }`, one item per step. |
| `handoff list` | Every walkthrough belonging to your key, with its status, plan key and title; published ones also show their link. |
| `handoff prune` | Deletes **all** drafts of your key, plus every walkthrough whose link you revoked — together with the notes left on it. Walkthroughs with a live link are untouched. No confirmation prompt. |
| `handoff revoke <slug\|wlk_id>` | Switches off a link you already shared. The record stays until the next `prune` — revoking does not delete the capture by itself. |

`publish`, `list`, `prune` and `revoke` all need a key and no browser.

| Flag | Default | What it does |
|---|---|---|
| `--api <url>` | local Supabase | base URL of the Handoff functions; **required against the cloud** |
| `--key <key>` | none | your agent key |
| `--local <file>` | off | write a self-contained HTML walkthrough instead of creating a draft |
| `--attach <url>` | off | drive an already-running Chrome over CDP instead of launching one |
| `--headless` | off | do not show a window; applies to the launched browser only, ignored when attaching |
| `--settle <ms>` | 400 | extra pause after each step before the frame is taken |
| `--no-clip` | off | skip the screencast; the viewer doesn't play it, so this is a free speed-up. `--local` implies it — nothing there consumes a clip |
| `--fail-fast` | off | if any step failed, don't create the draft (no effect with `--local`) |
| `--out <file>` | off | write the request body to a file instead of creating a draft; the frames are still uploaded first when a key is present |
| `--summary <file>` | none | `publish` only; the JSON summary to attach |

`HANDOFF_API`, `HANDOFF_KEY` and `HANDOFF_SETTLE` set the same three values from the
environment; the flags win. Flags take their value as the next argument — `--api=URL` is
not understood. The key is never stored: there is no login step and no config file.

By default `walk` launches its own persistent Chrome profile in `~/.handoff/browser`, so a
site you log into once stays logged in for later captures.

A walkthrough's identity is the plan's **filename** (minus the extension) together with your
key and the plan's `origin`: re-running the same file updates that same walkthrough instead
of making a second one, and the link stays what it was. Rename the file, or point it at a
different origin, and you get a new walkthrough. Note what that means for one that is
already **published**: the frames are replaced in place, so a re-shoot goes live on the
existing link immediately, with no publish step in between.

## Plan actions

Every step reads `<action> <target> — <caption>`.

| Action | Target | What happens |
|---|---|---|
| `open` | path or URL | navigates; a relative path is appended to `origin` as-is, so it must start with `/` |
| `click` | selector | clicks the first match |
| `type` | selector + text | fills the field; the text goes last, in double quotes |
| `check` | selector | waits for the element to be visible |
| `scroll` | selector | scrolls the element into view |
| `wait` | selector or ms | waits; **no frame is captured** and no caption is needed |

```markdown
---
title: New checkout
origin: http://localhost:3000
---

1. open /cart — The cart
2. click button.promo-apply — Apply a promo code
3. type input.promo "SALE20" — Enter the code
4. check .cart-total — Total recalculates
5. scroll .terms — Terms below the fold
6. wait .deal-card — hold for the card to render
```

`origin` is required, `title` is optional, and front matter is only recognised when the very
first line of the file is `---`. Lines that aren't numbered steps are ignored, so you can
keep notes between them.

Targets are Playwright selectors, so `button:has-text("Place order")` works, and they need
no quotes even when they contain spaces. An ambiguous selector doesn't fail the step: the
first match wins.

The caption separator is the first em dash in the line; only if there is no em dash at all
does the parser fall back to the first space-hyphen-space. A target containing either
sequence gets cut in half — that's the failure worth memorising, because the step still
runs, just against the wrong selector.

Full reference, including the sharp edges: [get-handoff.com/docs/cli/](https://get-handoff.com/docs/cli/).

## What else is in this repository

The CLI is at the root — this repository is the npm package. Three things sit beside it:

- **[`examples/`](examples/)** — two walkthrough plans that run as-is against a public demo
  site, plus the prompt you paste to a coding agent to have it record a walkthrough of what it
  just changed. Start here.
- **[`docs/mcp-contract.md`](docs/mcp-contract.md)** — the wire contract of the Handoff MCP
  server: its endpoint, its Bearer auth, and all eleven tools, written so you could point your
  own client at it.
- **[`skills/handoff-audit/`](skills/handoff-audit/)** — an agent skill that runs the other
  direction. It scans a live page with a bundled Playwright scanner and posts the genuinely
  pin-worthy findings back as pins, so the team sees them on the page and the board. It is
  built to judge rather than to lint: it caps output at the top 5–8 findings, requires a
  screenshot for each, and drops anything a linter already emits. Two profiles — objective
  breakage, and a persona audit. It has its own dependencies; `npm install` there separately.

**Not here, and deliberately:** the browser extension, the cloud backend, the web board and the
sharing service are closed source. This repository is the CLI and the skill.

## Licence

[PolyForm Shield 1.0.0](LICENSE) — source-available, not open source.

Read it, run it for any purpose, fork it, port it, build on it. The limit that matters is
competition: you may not provide a product that competes with this software **or with any
product the licensor provides using the software** — and providing it free of charge is
still competing. Whether a particular Handoff product falls under that second half is a
question for the licence text and not for a summary, so this one does not answer it.

Two narrower limits sit alongside it: you may not sublicense or transfer your licences, and
your patent licence ends the moment you claim in writing that the software infringes a
patent. The permission to fork and port carries a condition of its own: anyone who gets any
part of this code from you must get these terms (or the URL for them) and the
`Required Notice:` line along with it.

That licence covers what is in this repository — the CLI and the audit skill. The Handoff
browser extension, cloud and web board are closed source and are not here. Everything above is a summary —
Noncompete, Competition, Notices, No Other Rights and Patent Defense in [LICENSE](LICENSE)
are what bind.
