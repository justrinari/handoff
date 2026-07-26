// A walkthrough plan is markdown the agent edits as TEXT before the expensive
// recording. The format is deliberately boring: front matter plus numbered steps.
//
//   ---
//   title: New checkout
//   origin: http://localhost:3000
//   ---
//   1. open /cart — Cart
//   2. click button.promo-apply — Apply the promo code
//   3. type input.promo "SALE20" — Enter the code
//   4. check .cart-total — Total recalculated
//   5. scroll .terms — Terms below the fold
//   6. wait .deal-card — wait for the card (NO frame is taken)
//
// A target may contain SPACES without quotes: the caption is separated by a dash,
// and everything between the action and the dash is the target. The target used to
// be taken as a single whitespace token, so `check button:has-text("New deal")` did
// not parse — now it does. Single quotes around the target are still accepted (for
// backwards compatibility) and stripped while parsing.

export const ACTIONS = ["open", "click", "type", "check", "scroll", "wait"];

// Actions that have nothing to do without a target.
const NEEDS_TARGET = ["open", "click", "type", "check", "scroll", "wait"];

// `wait` only waits (no frame is taken) — it needs no caption.
const NEEDS_CAPTION = ["open", "click", "type", "check", "scroll"];

const SYNTAX_HINT =
  'format: <action> <target> — <caption>. example: click button:has-text("Place order") — Checkout';

export function parsePlan(source) {
  const lines = String(source).split(/\r?\n/);
  const meta = {};
  let i = 0;

  if (lines[0]?.trim() === "---") {
    i = 1;
    for (; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = lines[i].match(/^\s*([a-zA-Z_]+)\s*:\s*(.+?)\s*$/);
      if (m) meta[m[1]] = m[2];
    }
    i++; // the closing ---
  }
  if (!meta.origin) throw new Error("The plan does not specify an origin (front matter `origin:`)");

  const steps = [];
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const m = raw.match(/^\s*\d+\.\s*(.+)$/);
    if (!m) continue; // prose lines between steps are ignored
    steps.push(parseStep(m[1], i + 1));
  }

  if (steps.length === 0) throw new Error("The plan has no steps");
  return { title: meta.title ?? "Walkthrough", origin: meta.origin, steps };
}

// The body of a step: <action> <target...> ["text"] — <caption>.
// The action is the first token; everything up to the dash separator is the target
// (spaces allowed); the caption follows the dash. For `type`, the tail of the target
// carries the "text" in double quotes.
function parseStep(body, lineNo) {
  const head = body.match(/^(\S+)\s*([\s\S]*)$/);
  const action = head[1];
  if (!ACTIONS.includes(action)) {
    throw new Error(`line ${lineNo}: unknown action "${action}" (allowed: ${ACTIONS.join(", ")})`);
  }

  const sep = findSeparator(head[2]);
  const targetPart = (sep >= 0 ? head[2].slice(0, sep) : head[2]).trim();
  const caption = sep >= 0 ? head[2].slice(sep + 1).trim() : null;

  if (caption === null && NEEDS_CAPTION.includes(action)) {
    throw new Error(`line ${lineNo}: no caption (${SYNTAX_HINT})`);
  }

  let target = null, text = null;
  if (action === "type") {
    const tm = targetPart.match(/^([\s\S]*?)\s+"([^"]*)"\s*$/);
    if (!tm) {
      throw new Error(`line ${lineNo}: the "type" action needs its text in double quotes (${SYNTAX_HINT})`);
    }
    target = stripQuotes(tm[1]);
    text = tm[2];
  } else {
    target = stripQuotes(targetPart) || null;
  }

  if (NEEDS_TARGET.includes(action) && !target) {
    const kind = action === "wait" ? "a selector or a number of ms" : "a path or a selector";
    throw new Error(`line ${lineNo}: the "${action}" action needs a target (${kind})`);
  }

  return { action, target, text, title: caption };
}

// Strip the single quotes around a target if the author put them there (backwards compatibility).
function stripQuotes(s) {
  const t = String(s ?? "").trim();
  return /^'.*'$/.test(t) ? t.slice(1, -1) : t;
}

// The caption is separated by a dash — em dash or plain hyphen, whichever the author prefers.
function findSeparator(line) {
  const em = line.indexOf("—");
  if (em >= 0) return em;
  const hyphen = line.search(/\s-\s/);
  return hyphen >= 0 ? hyphen + 1 : -1;
}
