# The Handoff MCP contract

The Handoff cloud speaks [MCP](https://modelcontextprotocol.io) over HTTP. Your coding agent
connects to it, reads the comments people pinned on your live pages, and writes back — replies,
resolutions, its own findings, and walkthroughs.

The server is closed source. This document describes its wire contract so you can point any MCP
client at it, or write your own. It was written by reading the server's source, and every claim
below is a claim about a specific request or response.

## Endpoint

```
https://bhbdmxhgrjzksqpswjye.supabase.co/functions/v1/mcp
```

That is the whole URL. There is **no** `api.get-handoff.com` — this project once published that
hostname in its own documentation and it has never had a DNS record. If you find a Handoff MCP
URL anywhere that is not the one above, check it before you use it.

The host is a Supabase Edge Function deployment, so the URL is the project's Supabase hostname
rather than a vanity domain. The extension and the web board both build it the same way: a
`FUNCTIONS_BASE` constant plus `/mcp`.

Three routes live under that path:

| Method | Path | Speaks |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC 2.0 — this is MCP proper |
| `GET` | `/mcp/pending` | `text/plain` — for the Stop-hook guard, not for MCP clients |
| `GET` | `/mcp/hook?client=…` | `application/json` — the guard's ready-to-merge config |

`OPTIONS` is answered for CORS (`Access-Control-Allow-Origin: *`, allowed headers
`authorization, content-type`). Any other method on `/mcp` gets `405` with JSON-RPC error
`-32600`.

## Authentication

Every route requires a Bearer **agent key**:

```
Authorization: Bearer fbt_0123456789ab
```

The header is parsed case-insensitively and the `Bearer ` prefix is stripped. Keys look like
`fbt_` followed by 12 hex characters — short enough that the extension shows one in full. There
is no OAuth, no refresh, no expiry handshake: one static key, sent on every request.

Missing or unknown key:

```
HTTP/1.1 401
{"error": "Invalid or missing agent key"}
```

Note the shape: on the POST route a bad key is a **plain JSON body, not a JSON-RPC error
object**. Clients that only parse `result`/`error` will see nothing useful — check the status
code. (`GET /mcp/pending` is different again: its 401 has an empty body on purpose, so the shell
hook that calls it can treat any failure as "nothing owed".)

Where the key comes from: the browser extension mints one for itself, with no signup. Open the
extension → **Connect AI agent** → expand *Update your token*, and the `fbt_…` value is shown in
full with a copy button. The same screen prints a ready `claude mcp add` command. The server
never issues keys over MCP.

A key resolves to a **scope**, and the scope is the only access control in the protocol — every
tool below silently sees exactly what the key can see and nothing else. Two kinds exist:

- a **personal** key, scoped to its owner's own reviews plus every site shared to that owner as
  a member (and every site the owner owns, so a site owner sees comments members left);
- a **share** key, scoped to a single site.

A tool asked for something outside the scope does not return an authorization error. It returns
a normal result saying the thing was not found — for example `"Comment not found for this agent
key."` Do not read that as "it does not exist".

## Transport

JSON-RPC 2.0 in the POST body. The response format depends on your `Accept` header:

- `Accept: text/event-stream` → the reply comes back as one SSE frame
  (`event: message\ndata: {…}\n\n`), which is MCP's Streamable HTTP;
- anything else → a plain `application/json` body.

There is no persistent stream, no session id, and no server→client push. Every request is
independent.

Supported methods:

| Method | Behaviour |
|---|---|
| `initialize` | Returns the handshake (below). |
| `tools/list` | Returns `{ tools: [...] }` — the eleven definitions. |
| `tools/call` | Runs one tool: `params.name`, `params.arguments`. |
| `notifications/*` | Accepted and discarded — `202` with no body. |
| anything else | JSON-RPC error `-32601 Method not found: <name>`. |

A body that is not JSON gets `-32700 Parse error`. An exception inside a tool becomes `-32603`.

### `initialize`

```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "feedback-tool", "version": "0.1.0" },
  "instructions": "Handoff is feedback a person left on a live web page: …"
}
```

`protocolVersion` echoes whatever you sent in `params.protocolVersion`, defaulting to
`2025-06-18`. Only the `tools` capability is advertised — there are no resources, no prompts, no
sampling.

`instructions` is generated per request and worth reading rather than ignoring: it carries the
loop the server wants an agent to follow (read feedback → fix it in your own repository →
resolve the comment). It is also budgeted to about 2048 characters, because that is where at
least one client truncates it. `params.clientInfo.name` changes its content — the server matches
`cursor` / `codex` loosely in that string and otherwise assumes Claude Code.

## The eleven tools

There are exactly eleven. Six read, five write.

### Reading

#### `list_reviews`

Lists your recent reviews, newest first, as Markdown. **No parameters.**

Each line is `- <reviewId> — url: <target_url> — <n> comments, <created_at>`. Empty scope
returns the literal string `No reviews found for this agent key.`

#### `get_latest_review`

The most recent review, rendered the same way as `get_review`. **No parameters.**

#### `get_review`

One review as a Markdown document: its URL, title, viewport, environment, captured console
lines, then a numbered section per comment carrying severity, body, comment id, kind, CSS
selector, computed styles, agent status and the discussion thread.

| Parameter | Type | Required |
|---|---|---|
| `reviewId` | string | yes |

Screenshots are **not** embedded. Each comment that has one prints the exact `get_screenshot(…)`
call that would show it.

Note what this tool does *not* return: the element's `outerHTML`. Only `get_page_bundle` carries
that.

#### `get_page_bundle`

Every comment on one page — matched on the review's exact target URL — as a single Markdown
document grouped by severity (`Blocker`, `High`, `Medium`, `Low`, `Redesign`), so an agent can
prioritise and split the work.

| Parameter | Type | Required |
|---|---|---|
| `targetUrl` | string | yes |

This is the richest read: it is the only tool that includes each element's `outerHTML`, and it
lists both the element screenshot and the full-screen context screenshot. There is **no status
filter** — resolved and accepted comments come back too, marked with their status. Filter
client-side if you only want open ones.

Call this before `create_comments`, to avoid pinning something already reported.

#### `get_screenshot`

Returns an image content block (`{ "type": "image", "data": "<base64>", "mimeType":
"image/png" }`) — inline, not a URL. This is the only way to see a comment's screenshot.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `reviewId` | string | yes | |
| `commentId` | string | yes | |
| `variant` | string | no | `"element"` (default) or `"context"` |

`element` is the annotated element or region; `context` is the full-screen capture with the
target outlined. If the comment has no screenshot of that variant you get the text `No
screenshot for this comment.` instead of an image.

**This call has a side effect.** The server records a claim: this key has taken that pin on. See
[Claims](#claims-the-side-effect-on-two-tools).

#### `get_frame`

One sampled frame of a comment's **screen recording**, inline as an image.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `reviewId` | string | yes | |
| `commentId` | string | yes | |
| `index` | number | yes | 0-based |

These frames belong to a video comment recorded by the extension. They are **not** walkthrough
frames — a walkthrough's frames live in a different table entirely and are never reachable
through this tool.

Records a claim, exactly like `get_screenshot`.

### Writing

#### `resolve_comment`

Marks a comment resolved by the agent, after the underlying issue is actually fixed.

| Parameter | Type | Required |
|---|---|---|
| `reviewId` | string | yes |
| `commentId` | string | yes |
| `note` | string | yes |

The note renders on a small on-page pin badge, so one sentence — what changed plus a commit
reference. Sets the comment's status to `agent_resolved` and appends a `resolved` event to its
log; the team can then Accept or Reopen it.

Returns `✓ resolved <commentId>.` followed by either your remaining outstanding claims or a note
that nothing else is open.

#### `reply_comment`

Posts a message into the comment's discussion thread **and** resolves the comment — one call,
both effects.

| Parameter | Type | Required |
|---|---|---|
| `reviewId` | string | yes |
| `commentId` | string | yes |
| `body` | string | yes |

The body is trimmed and truncated to 2000 characters; an empty one is rejected. It renders in a
small pin popover, so 1–2 sentences. Read the thread back with `get_review`.

The reply is visible to the team on the board and on the page. It is **not** visible on a public
share link — that page deliberately does not render comment authorship, and it renders no
threads for a viewer to reply into.

#### `create_comments`

Audit mode, and the only tool that runs in reverse: the agent posts its **own** findings as pins
on a page. The team then sees them on the live page and on the Task Board with an AI author
badge.

| Parameter | Type | Required |
|---|---|---|
| `page_url` | string | yes — must be an `http(s)` URL with a host |
| `page_title` | string | no |
| `findings` | array of finding objects | yes — 1 to 20 |

Each finding:

| Field | Type | Required | Notes |
|---|---|---|---|
| `body` | string | yes | the problem, 1–2 sentences; truncated at 2000 chars |
| `severity` | string | yes | `Low`, `Medium`, `High`, `Blocker`, `Redesign` |
| `selector` | string | no | CSS selector — the preferred anchor |
| `rect` | `{x, y, width, height}` numbers | no | region in document coordinates — fallback anchor |
| `pin` | `{x, y}` numbers | no | point in document coordinates — last-resort anchor |
| `html` | string | no | element `outerHTML`, truncated at 2000 chars |
| `screenshot_base64` | string | no | close-up PNG, raw base64, no `data:` prefix |
| `context_screenshot_base64` | string | no | wide PNG showing where on the page it is |
| `console` | array of strings | no | page-level error lines |

The anchor rules are strict and worth getting right the first time:

- `console` is **mutually exclusive** with `selector`, `rect`, `pin` and `html`. A console
  finding is page-level: there is nothing on the page to photograph, so it needs no screenshot,
  and the lines render under the card's Details → Console. Max 10 lines, 500 characters each.
- Otherwise the anchor is chosen in order: `selector` → element pin; `rect` → region; `pin` →
  point-anchored region; none of them → a board-only comment with no pin on the page.

Size caps, enforced on the base64 string length: about 2 MB decoded per screenshot, about 10 MB
across the whole call, counting both shots of every finding.

**One call creates one review per finding.** Twenty findings are twenty reviews, and each counts
against the account's review cap. The response lists every created comment id with its review
id.

Failures are reported as text, not as JSON-RPC errors, and some of them are partial — if the
comment rows were inserted but an anchor insert failed, the response says so and tells you not
to retry. Read it before retrying anything.

#### `record_walkthrough`

Builds a walkthrough plan. **It does not record anything.**

This is the piece most likely to surprise you. The cloud server cannot drive a browser, so this
tool returns *text*: a ready-to-save plan file, the command to start a debuggable Chrome, and
the exact `npx get-handoff walk …` command — with your key and API base already substituted.
You (or your agent) run that command locally. The CLI in this repository is what actually opens
a browser and takes the frames.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `goal` | string | yes | becomes the title |
| `origin` | string | yes | the app URL, e.g. `http://localhost:3000` |
| `name` | string | no | basename for the plan file; defaults to a slug of `goal` |
| `steps` | array | yes | at least one |

Each step:

| Field | Type | Required | Notes |
|---|---|---|---|
| `action` | string | yes | one of `open`, `click`, `type`, `check`, `scroll` |
| `target` | string | yes | a path for `open`, otherwise a CSS or text selector |
| `text` | string | only for `type` | the text to enter |
| `caption` | string | yes | shown under the frame |

The plan is written to `.handoff/walkthroughs/<slug>.md`. Validation is deliberately light here
— the CLI's own parser is the real gate at capture time, and it accepts one action this schema
does not: `wait`, which pauses without taking a frame. Add those by hand to the plan file.

Running `walk` with a key produces a private **draft** and prints its id (`wlk_…`). Nothing is
public at that point.

#### `publish_walkthrough`

Turns a draft into a public link and attaches the summary readers scan beside the frames.

| Parameter | Type | Required |
|---|---|---|
| `walkthroughId` | string | yes — the `wlk_…` id printed by `handoff walk` |
| `summary` | array of `{stepIdx: number, text: string}` | yes |

`stepIdx` is 0-based. The summary is meant to cover **every** step, one line each, in order,
written after looking at the captured frames. Re-calling with a new summary updates a link that
is already public, in place, with no re-record.

Returns `✓ Published: <url>`.

Two things the published page does not do:

1. **It only shows.** A viewer cannot leave a note on a frame. Comments on walkthrough frames
   were designed and then cut; the viewer is read-only and there is no endpoint behind it.
2. **It is not where pins come from.** Pins are created on a real page by the browser extension,
   or by an agent calling `create_comments`. Never from the walkthrough viewer.

## Claims: the side effect on two tools

`get_screenshot` and `get_frame` — and only those two — record a claim against your key when
they successfully hand back an image. The reasoning: reading a list costs nothing, but looking
at a pin's picture means you have taken that pin on.

The claim is what `GET /mcp/pending` reports. That route returns `text/plain`, and **an empty
body means nothing is owed** — the protocol is deliberately parser-free, because a shell hook
consumes it. When something is owed, it names each comment and asks for a `resolve_comment` or
`reply_comment` call.

A claim expires after 12 hours, so a pin you honestly cannot fix does not haunt every future
turn. Re-reading the same screenshot refreshes the claim rather than duplicating it.

`GET /mcp/hook?client=claude|cursor|codex` returns a ready-to-merge Stop-hook config, with your
key already in it, that calls `/pending` before an agent's turn ends. It is optional. If your
key has never called `/pending`, the `initialize` instructions will include a short pitch asking
the agent to offer installing it; once the hook has called once, the pitch stops.

## Things that are easy to get wrong

A short list, each of which has already been documented incorrectly at least once:

- **A published walkthrough page only shows.** No note can be left on a frame.
- **A public share link for pinned comments is view-only too.** It renders comment cards from
  JSON with no form, no input and no textarea, and the endpoint behind it performs only reads.
  It also does not show who wrote each comment.
- **Leaving a comment needs the browser extension** — but *not* an account. The extension mints
  its own key with no signup, so a person you share a page with can pin feedback without
  registering for anything.
- **A share link is per site (origin), not per review.** It shows every comment on that origin.
- **Feedback is scoped per page** — origin plus pathname — not per whole site.
- **`get_page_bundle` returns closed comments too.** There is no status filter.
- **`get_frame` serves video frames, not walkthrough frames.**
- **Re-running the same plan file updates that walkthrough in place** — including a published
  one, whose live link gets the new frames with no publish step in between.
