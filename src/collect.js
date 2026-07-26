// The geometry map of a frame: it is what turns a colleague's click on the picture
// into a real CSS selector.
//
// IMPORTANT: this function must be SELF-CONTAINED — Playwright serialises its source
// and runs it in the browser, where there are no imports, no module constants and no
// neighbouring functions. So the helpers and thresholds live inside, and `document`
// and `window` are taken from the globals (in jsdom tests they are global too).

export function collectElements() {
  // A colleague pokes at more than buttons: at an icon, a badge, a piece of text.
  // Every tag we leave out becomes "element not recognised" instead of a selector,
  // so we take the visual atoms (span/svg/code) as well as anything marked up with a
  // role or a label. Wrappers (div/section) are deliberately left out: the "smallest
  // element under the point" rule already returns what is inside them.
  const INTERESTING = "a, button, input, select, textarea, h1, h2, h3, h4, p, img, li, label," +
    " span, svg, code, [role], [aria-label]";
  const MIN_SIDE = 8;      // slivers thinner than this are impossible to click
  const TEXT_MAX = 60;

  // 🔴 HARD-WON LESSON: Tailwind classes are full of characters that mean something
  // else in a selector — `group/menu-item`, `hover:bg-x`, `w-1/2`. Without escaping,
  // querySelectorAll THROWS, the frame map is not collected at all, and the step is
  // marked failed. One such class killed an entire recording.
  const esc = (s) => (typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(s)
    : String(s).replace(/[^\w-]/g, (c) => "\\" + c));

  const cssPath = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${esc(el.id)}`;
    const cls = (el.getAttribute("class") || "")
      .trim().split(/\s+/).filter(Boolean).slice(0, 2).map(esc);
    const base = tag + (cls.length ? "." + cls.join(".") : "");
    try {
      const same = [...document.querySelectorAll(base)];
      return same.length > 1 ? `${base}:nth-of-type(${same.indexOf(el) + 1})` : base;
    } catch {
      // Escaping did not save us (it happens with really exotic markup) — we hand back
      // at least the tag: an imprecise selector beats an empty frame.
      return tag;
    }
  };

  const out = [];
  for (const el of document.querySelectorAll(INTERESTING)) {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;     // outside the frame
    out.push({
      selector: cssPath(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, TEXT_MAX),
    });
  }
  return out;
}
