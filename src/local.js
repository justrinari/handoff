// A walkthrough you can open without an account: ONE html file, every frame inlined
// as a data: URI. No network, no server, no link to revoke — double-click it, or drop
// it into a chat and the person on the other side sees the same flow.
//
// This is the offline twin of the hosted viewer (web/walkthrough): same light palette,
// same navy/amber language, so a person who has seen a Handoff link recognises the
// file. Nothing is imported from there — this file has to stand alone — and the
// cursor gesture is deliberately absent: locally we render still frames only.
//
// The markup is COMPLETE without the script: the first step is already on screen, the
// counter already reads 1 / N. Quick Look, attachment previews and html-to-pdf
// converters render with scripting off, and those are exactly the "just double-click
// it" paths this file promises. The script only adds flipping between steps.

// Every frame is inlined, so this file's weight is the sum of the capture: a viewport
// screenshot at 2x DPR runs ~0.5-1.5 MB and base64 adds a third on top. Ten steps are
// comfortable, thirty are not — and the file's whole promise is that you can drop it
// into a chat. 25 MB is the attachment ceiling Gmail and most mail servers apply, so
// that is where the CLI stops calling the file "shareable" and says what to do instead.
export const ATTACH_LIMIT_BYTES = 25 * 1024 * 1024;

// One decimal from a megabyte up, whole kilobytes below: the reader is deciding
// "can I send this?", not auditing bytes.
//
// Rounded UP, and the unit is chosen from the rounded number, not the raw one. Both
// rules exist to stop the printed size from reading below a limit the file has already
// passed: rounding to nearest turned 26214401 bytes into "25.0 MB is over the 25 MB
// limit" (which reads as a bug in the tool), and picking the unit from the raw bytes
// printed "1024 KB" for anything in the last kilobyte below a megabyte.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  const kb = Math.max(1, Math.ceil(n / 1024));
  if (kb < 1024) return `${kb} KB`;
  return `${(Math.ceil((n / 1024 / 1024) * 10) / 10).toFixed(1)} MB`;
}

// How the run reports a capture that lost steps, in the one line that also names the
// file. What the file CONTAINS decides the wording: when every step failed it holds no
// screenshots at all, and "N of N steps failed" invites the reader to look for the
// survivors. Saying it in words also spares the count an "(s)" that reads like an
// unfinished placeholder.
//
// It lives here, next to formatBytes, because the branch is otherwise reachable only
// through a real browser run — and a sentence nobody can test is a sentence that rots.
export function failedTally(failed, total) {
  return failed === total ? "every step failed" : `${failed} of ${total} steps failed`;
}

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ONE definition of "this step has no frame to show", shared by the step list and the
// panel. Two rules drifting apart is how a step ends up reading fine in the list and
// broken in the panel. An empty buffer counts as no frame: rendering it would emit an
// empty data: URI, i.e. a broken-image icon with no explanation.
const failedStep = (s) => s?.status === "failed" || !s?.png?.length;

// The amber-ground mark of the hosted viewer, inline: an icon that costs no request.
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E" +
  "%3Crect width='24' height='24' rx='7' fill='%23F5A623'/%3E" +
  "%3Crect x='6' y='9' width='9' height='9' rx='2' fill='none' stroke='%230F1320' stroke-width='2'/%3E" +
  "%3Crect x='13' y='5' width='6' height='6' rx='1.5' fill='%230F1320'/%3E%3C/svg%3E";

const MARK =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="24" height="24" rx="7" fill="#0F1320"/>' +
    '<rect x="6" y="9" width="9" height="9" rx="2" fill="none" stroke="#fff" stroke-width="2"/>' +
    '<rect x="13" y="5" width="6" height="6" rx="1.5" fill="#fff"/>' +
    '<circle cx="20" cy="5" r="3" fill="#F5A623"/>' +
  "</svg>";

// The :root block below is copied VERBATIM from web/walkthrough/index.html (as of
// 2026-07-26), including the tokens this file never uses. Do not prune them: byte
// identity is the drift detector — diff the two :root blocks and the hosted viewer
// and this offline twin are still the same product, or the diff tells you they aren't.
// System fonts only: a web font would be a network request, and the whole promise of
// this file is that it works with the network off.
const STYLE = `
:root{
  color-scheme:light;
  --ground:#f9fafb; --card:#ffffff; --ink:#111827; --muted:#6b7280; --subtle:#9ca3af;
  --line:#e5e7eb; --line-strong:#d1d5db;
  --primary:#2e3d62; --primary-hover:#1f2a47;
  --accent:#F5A623; --accent-soft:rgba(245,166,35,.16); --accent-ink:#0B1220;
  --chip-bg:#f3f4f6; --hi-bg:#FFF8EC;
  --radius:16px; --radius-sm:8px;
  --card-shadow:0 4px 12px rgba(15,23,42,.08);
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--ground);color:var(--ink);line-height:1.5;
  font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
.app{min-height:100%;display:flex;flex-direction:column}

header.top{flex:none;display:flex;align-items:center;gap:12px;
  padding:12px 20px;background:var(--card);border-bottom:1px solid var(--line)}
header.top svg{display:block;width:28px;height:28px;flex:none}
.titles{min-width:0}
h1{font-size:15px;margin:0;font-weight:600;letter-spacing:-.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{font-size:11.5px;color:var(--muted);display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.dot{width:4px;height:4px;border-radius:50%;background:var(--muted);flex:none}
.ro{margin-left:auto;flex:none;font-size:11.5px;color:var(--muted);border:1px solid var(--line);
  background:var(--card);border-radius:999px;padding:4px 11px;white-space:nowrap}

.stage{flex:1;min-height:0;display:flex;gap:12px;padding:14px 16px}

aside.steps{flex:none;width:300px;display:flex;flex-direction:column;overflow:hidden;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px 14px 12px}
aside.steps h2{font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 11px}
aside.steps ol{list-style:none;margin:0;padding:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
aside.steps button{all:unset;cursor:pointer;display:flex;gap:9px;align-items:flex-start;width:100%;
  box-sizing:border-box;padding:8px 9px;border-radius:9px;font-size:13.5px;line-height:1.4;
  color:var(--muted);border:1px solid transparent;transition:background .12s ease}
/* all:unset drops the focus ring too — put a visible one back, or the list is
   unusable by keyboard. */
aside.steps button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
/* Without min-width:0 a long caption refuses to shrink and spills out of the panel. */
aside.steps button > .txt{min-width:0;overflow-wrap:anywhere}
aside.steps button:hover{background:var(--chip-bg)}
aside.steps button[aria-current="step"]{background:var(--hi-bg);border-color:var(--accent);color:var(--ink)}
aside.steps .n{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700;
  color:var(--muted);background:var(--chip-bg);border:1px solid var(--line);border-radius:999px;
  padding:1px 7px;white-space:nowrap;margin-top:2px}
aside.steps button[aria-current="step"] .n{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
/* Red is spent on one thing only: a step that did not complete. */
aside.steps button.bad .n{background:#FFF4F2;color:#8B2F1D;border-color:#F3C9C0}
aside.steps button.bad .txt{color:#8B2F1D}
aside.steps button.bad[aria-current="step"]{background:#FFF4F2;border-color:#F3C9C0}

.panel{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.frame{display:none;width:100%;flex-direction:column;align-items:center;gap:9px}
.frame.on{display:flex}
/* The frame takes focus when you flip to it (so the keyboard doesn't stay behind on
   the previous button), but it is a container, not a control — no ring for it. */
.frame:focus{outline:none}
.frame h2{font-size:16.5px;margin:0;font-weight:600;letter-spacing:-.01em;text-align:center;
  max-width:min(840px,100%);overflow-wrap:anywhere}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);
  max-width:min(840px,100%);text-align:center;overflow-wrap:anywhere}
.shot{display:block;max-width:100%;max-height:calc(100vh - 280px);width:auto;height:auto;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--card-shadow)}
/* Playwright failures are multi-line ("Timeout 5000ms exceeded." / "Call log:" / the
   waits). This is the one diagnostic the recipient needs — keep the line breaks. */
.fail{max-width:min(560px,100%);background:#FFF4F2;border:1px solid #F3C9C0;color:#8B2F1D;
  padding:14px 16px;border-radius:11px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.fail b{font-weight:600}

footer.bar{flex:none;display:flex;align-items:center;justify-content:center;gap:12px;
  flex-wrap:wrap;padding:8px 20px 14px;font-size:11.5px;color:var(--muted)}
.count{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:var(--card);
  border:1px solid var(--line);border-bottom-width:2px;border-radius:var(--radius-sm);padding:1px 6px;color:var(--ink)}

/* Narrow window: the step list moves above the frame instead of squeezing it away. */
@media (max-width:900px){
  .stage{flex-direction:column}
  aside.steps{width:100%;max-height:34vh}
  .shot{max-height:56vh}
}

/* "Print to PDF" should yield the whole walkthrough, one step per page — not the
   single step that happened to be on screen. */
@media print{
  .frame{display:flex;break-after:page}
  .frame:last-child{break-after:auto}
  .panel{justify-content:flex-start}
}
`;

const SCRIPT = `
(function(){
  var frames = [].slice.call(document.querySelectorAll(".frame"));
  var buttons = [].slice.call(document.querySelectorAll("aside.steps button"));
  var count = document.getElementById("count");
  if (!frames.length) return;
  var at = 0;
  function go(i, focus){
    at = Math.max(0, Math.min(frames.length - 1, i));
    frames.forEach(function(f, k){ f.classList.toggle("on", k === at); });
    buttons.forEach(function(b, k){
      if (k === at) { b.setAttribute("aria-current", "step"); b.scrollIntoView({ block: "nearest" }); }
      else b.removeAttribute("aria-current");
    });
    count.textContent = (at + 1) + " / " + frames.length;
    // The keyboard has to follow the selection: leave focus on the button you clicked
    // and the next Enter fires the OLD step. Not on load, though — focusing on load
    // would scroll the page before anyone asked.
    if (focus) frames[at].focus();
  }
  buttons.forEach(function(b, k){ b.addEventListener("click", function(){ go(k, true); }); });
  addEventListener("keydown", function(e){
    if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1, true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1, true); }
    else if (e.key === "Home") { e.preventDefault(); go(0, true); }
    else if (e.key === "End") { e.preventDefault(); go(frames.length - 1, true); }
  });
  go(0, false);   // idempotent: the markup already shows step 1
})();
`;

/**
 * Render a recorded walkthrough as one self-contained HTML document.
 *
 * @param {{title?: string}} plan            the parsed plan (see plan.js)
 * @param {Array<{
 *   title?: string,                          the step caption written by the plan author
 *   url?: string,                            page url at the moment of capture
 *   status?: "ok"|"failed",
 *   failure?: string|null,                   why the step did not complete
 *   png?: Buffer|Uint8Array|null,            the frame; null when the step failed
 * }>} shots                                  what walkPlan() returned (see walk.js)
 * @returns {string} a complete document: every frame inlined, zero network requests.
 */
export function renderLocalHtml(plan, shots) {
  const steps = Array.isArray(shots) ? shots : [];
  const title = plan?.title || "Walkthrough";
  const n = steps.length;

  const list = steps
    .map((s, i) => {
      const cls = failedStep(s) ? ' class="bad"' : "";
      // The current step is marked in the MARKUP, not only by the script: with
      // scripting off this is the only thing that says where the walkthrough starts.
      const current = i === 0 ? ' aria-current="step"' : "";
      return `<li><button type="button"${cls}${current}>` +
        `<span class="n">${String(i + 1).padStart(2, "0")}</span>` +
        `<span class="txt">${esc(s?.title)}</span></button></li>`;
    })
    .join("");

  const frames = n
    ? steps
        .map((s, i) => `<section class="frame${i === 0 ? " on" : ""}" tabindex="-1">${frameBody(s)}</section>`)
        .join("")
    // A plan that captured nothing must say so. An empty panel looks like a bug in
    // the viewer rather than an empty recording.
    : `<div class="fail"><b>No steps were recorded.</b> The walkthrough finished without capturing a single frame.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Handoff</title>
<link rel="icon" href="${FAVICON}">
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <header class="top">
    ${MARK}
    <div class="titles">
      <h1>${esc(title)}</h1>
      <div class="meta"><span>${n} step${n === 1 ? "" : "s"}</span><span class="dot"></span><span>recorded locally</span></div>
    </div>
    <span class="ro">Offline copy</span>
  </header>

  <div class="stage">
    ${n ? `<aside class="steps">
      <h2>Steps</h2>
      <ol role="list">${list}</ol>
    </aside>` : ""}
    <main class="panel">${frames}</main>
  </div>
${n ? `
  <footer class="bar">
    <span class="count" id="count" aria-live="polite">1 / ${n}</span>
    <span class="dot"></span>
    <span><kbd>&larr;</kbd> <kbd>&rarr;</kbd> to flip &middot; <kbd>Home</kbd> <kbd>End</kbd> to jump</span>
  </footer>` : ""}
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// A failed step KEEPS ITS PLACE in the walkthrough: dropping it would let a broken
// recording read as a complete one.
function frameBody(s) {
  // h2, not h3: the frame caption is a peer of the "Steps" heading, not a subsection
  // of it — an h3 here would put every frame under the step list in the outline.
  const head = `<h2>${esc(s?.title)}</h2><div class="url">${esc(s?.url)}</div>`;
  if (!failedStep(s)) {
    const png = Buffer.isBuffer(s.png) ? s.png : Buffer.from(s.png);   // no copy: it already is one
    return `${head}<img class="shot" alt="Screenshot: ${esc(s?.title)}" src="data:image/png;base64,${png.toString("base64")}">`;
  }
  const why = s?.failure ? `: ${esc(s.failure)}` : ".";
  return `${head}<div class="fail"><b>This step did not complete</b>${why}</div>`;
}
