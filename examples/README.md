# Examples

Two walkthrough plans and one agent prompt. The plans run as-is — they point at
[northlane-demo.vercel.app](https://northlane-demo.vercel.app), a public demo site, so there is
nothing to install and nothing to log into.

| File | What it is |
|---|---|
| [`signup.md`](signup.md) | A short signup flow — five steps, ending on a validation message. |
| [`checkout.md`](checkout.md) | A longer flow — seven steps: pick a plan, fill in the billing address, place the order. |
| [`agent-prompt.md`](agent-prompt.md) | The text you paste to your coding agent to have it record a walkthrough of what it just changed. |

## Run them

From the repository root, with no account and nothing uploaded:

```sh
npx get-handoff walk examples/signup.md --local signup.html
npx get-handoff walk examples/checkout.md --local checkout.html
```

Each writes one self-contained HTML file — every frame inlined — that you open by
double-clicking. Add `--headless` if you'd rather not watch the browser work.

You need Node 18+ and a locally installed **Google Chrome**. The package drives a browser but
never downloads one.

## Then change one

Open either file. A plan is front matter plus numbered steps:

```markdown
---
title: Checkout now validates the address
origin: https://northlane-demo.vercel.app
---

1. open /checkout/ — The checkout page
2. type #name "Alex Moreau" — Filling in the billing name
3. click #place — Placing the order
```

Point `origin` at your own app, rewrite the selectors, and re-run. The caption after the em dash
is what shows under the frame.

The em dash is the one sharp edge worth knowing: it is the caption separator, so a selector
containing one gets cut in half — and the step still runs, just against the wrong target. The
full list of actions and edge cases is in the [root README](../README.md#plan-actions).

## Publishing instead of `--local`

`--local` is the whole feature without an account. To get a link a teammate opens instead of a
file you attach, you need an agent key from the browser extension, and then it is `walk` (which
creates a private draft) followed by `publish`. See the [root README](../README.md#what-the-cloud-adds).
