# Agent prompt: "record a walkthrough of what you just changed"

Paste this to your coding agent after it finishes a change that is visible in the UI. It assumes
the agent is connected to the Handoff MCP server (see [`../docs/mcp-contract.md`](../docs/mcp-contract.md)).

---

Record a walkthrough of the change you just made, so I can send it to the team.

1. Work out the shortest click path through the app that **shows** the change — the fewest steps
   someone needs to see it, starting from a page they'd normally land on. Use the routes and
   selectors from the code you just touched; you know them, I don't.

2. Call `record_walkthrough` with the goal, the app's origin, and those steps. Remember it does
   not record anything — it hands back a plan file and the exact local command. Actions are
   `open`, `click`, `type`, `check` and `scroll`; every step needs a caption, and `type` needs
   its text. Prefer a text selector like `button:has-text("Place order")` over a CSS class when
   the classes are generated (Tailwind, CSS modules) and would break on the next build.

3. Save the plan file where it tells you to, then start the app and run the command it printed.
   It needs a Chrome it can attach to, with the app already open and signed in — the recorder
   attaches to your window, it will not log in for you. If nothing in the flow is behind a
   login, you can drop `--attach` and let it launch its own browser.

4. When the capture finishes it prints a walkthrough id (`wlk_…`) and leaves a **private draft**.
   Nothing is public yet. Look at the frames before going further.

5. Then call `publish_walkthrough` with that id and a summary: one line per step, covering every
   step, in step order, `stepIdx` counting from 0. Write it from the frames you just looked at,
   not from your plan — the plan says what you intended to capture, the frames say what actually
   happened. If a step didn't come out, say so or drop it rather than describing it from memory.

6. Give me the link, and tell me if any step failed during capture.

If I only want to check it myself first, skip the cloud entirely: run
`npx get-handoff walk <plan.md> --local walkthrough.html` and hand me that file. It needs no key,
uploads nothing, and opens by double-clicking.

---

## What the reader gets

A page of frames with a ghost cursor replaying the clicks, and your summary in a panel beside
them. It opens without an account.

It **only shows** — the viewer cannot leave a note on a frame. If you want comments back, that
is the browser extension pinning them on the real page, not this link.
