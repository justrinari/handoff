#!/usr/bin/env node
// audit-scan.mjs — Tier1 breakage scanner for the handoff-audit skill.
// Black box: run with --help. stdout is a base64-free JSON summary; the full
// payload (with screenshots) goes to --out. Diagnostics go to stderr.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const HELP = `audit-scan.mjs — Handoff breakage scanner (tier1 + tier3 profiles)

Usage:
  node audit-scan.mjs --url <URL> [--profile tier1|tier3] [--viewports 320,768,1440] [--out <file.json>]

Scans the page at each viewport for OBJECTIVE breakage (broken images, dead
links, console errors, responsive layout breakage, leftover placeholder text).
--profile tier3 adds the persona-audit detectors on top of the tier1 set:
unlabeled form controls, keyboard focus traps (read-only Tab pass — no clicks,
no typing), overlapping text. Default: tier1.
stdout: JSON summary { scanned, truncated, candidates } WITHOUT screenshot
base64 (candidates carry has_screenshot instead) — safe to read into an agent
context. --out: the same object with full screenshot_base64 per candidate —
feed it to audit-post.mjs, do NOT read it into a model. Each candidate carries
a UNIQUE selector (or a pin fallback) and an element-in-context PNG
(console-error candidates carry \`console\` error lines instead of a
screenshot) — the HARD RULES, guaranteed in code. Never emits
contrast/decor/ARIA nitpicks.
`;

function parseArgs(argv) {
  const args = { url: null, viewports: [320, 768, 1440], out: null, profile: 'tier1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--url') args.url = argv[++i];
    else if (a === '--viewports') {
      const raw = argv[++i];
      args.viewports = (raw || '').split(',').map((s) => parseInt(s.trim(), 10));
    }
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--profile') args.profile = argv[++i];
  }
  return args;
}

// networkidle never fires on ad/analytics-heavy pages — degrade to 'load' + a
// settle pause instead of silently skipping the viewport (a skipped viewport
// would read as "page is clean", which is worse than a degraded scan).
async function loadPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    return 'ok';
  } catch {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(3000);
      return 'degraded';
    } catch (err) {
      process.stderr.write(`warn: viewport load failed: ${err.message}\n`);
      return 'failed';
    }
  }
}

// stdout must never carry base64 — strip blobs, keep a has_screenshot marker.
function summarize(result) {
  return {
    ...result,
    candidates: result.candidates.map(({ screenshot_base64, ...rest }) => ({
      ...rest,
      has_screenshot: Boolean(screenshot_base64),
    })),
  };
}

// Serialized into the page. Returns raw candidates: { type, selector, selector_unique, rect, pin, html, evidence }.
function inPageDetect(profile) {
  const out = [];
  const seen = new Set();

  function cssPath(el) {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter((c) => /^[A-Za-z_-]/.test(c));
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const sibs = [...node.parentNode.children].filter((n) => n.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (document.querySelectorAll(sel).length === 1) return sel;
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function uniqueSelector(el) {
    const sel = cssPath(el);
    const ok = document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === el;
    return ok ? sel : null;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function push(type, el, evidence) {
    const sel = uniqueSelector(el);
    const rect = rectOf(el);
    const key = type + '|' + (sel || `${rect.x},${rect.y}`);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      type,
      selector: sel,
      selector_unique: !!sel,
      rect,
      pin: { x: rect.x + Math.round(rect.width / 2), y: rect.y + Math.round(rect.height / 2) },
      html: (el.outerHTML || '').slice(0, 2000),
      evidence,
    });
  }

  function runDetectors() {
    // --- dead-link (the ONE heuristic detector: href="#" is a standard JS-trigger
    // pattern on live sites, so anything marked as interactive is excluded) ---
    document.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href');
      const dead = href === '#' || href === '' || href === null || /^javascript:\s*void/i.test(href || '');
      if (!dead) return;
      const jsTrigger = a.hasAttribute('role') || a.hasAttribute('aria-expanded') ||
        a.hasAttribute('aria-haspopup') || a.hasAttribute('aria-controls') ||
        a.hasAttribute('data-toggle') || a.hasAttribute('onclick');
      if (jsTrigger) return;
      push('dead-link', a, `href=${JSON.stringify(href)} does not navigate (no JS-trigger markers — verify before pinning)`);
    });

    // --- broken-image (lazy images are covered by the scroll pass in main()) ---
    document.querySelectorAll('img').forEach((img) => {
      // No source at all = template placeholder, not a failed load.
      const srcAttr = img.getAttribute('src');
      const attempted = img.currentSrc || srcAttr;
      if (!attempted || !(img.complete && img.naturalWidth === 0)) return;
      // <picture>/srcset: the attempted source can differ from the src attribute —
      // name both so the evidence matches what the reader sees in the markup.
      const evidence = srcAttr && attempted !== srcAttr
        ? `image failed to load (attempted ${JSON.stringify(attempted)}; src attribute ${JSON.stringify(srcAttr)})`
        : `image failed to load (src=${JSON.stringify(attempted)})`;
      push('broken-image', img, evidence);
    });

    // --- placeholder-text ---
    const PLACEHOLDER = /lorem ipsum|\bTODO\b|\bTBD\b|dummy text|placeholder text/i;
    const seenEl = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) {
      const text = (tn.nodeValue || '').trim();
      if (text.length > 3 && PLACEHOLDER.test(text)) {
        const el = tn.parentElement;
        if (!el || seenEl.has(el)) continue;
        // Script/style text is never user-visible content, even when the tag is styled.
        if (el.closest('script,style,noscript,template')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // In-flow but invisible (a11y-hidden, fade-in wrappers) is a design choice,
        // not a defect. checkVisibility resolves the ANCESTOR chain (opacity doesn't
        // inherit as a computed value, so a getComputedStyle check would miss wrappers).
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        seenEl.add(el);
        push('placeholder-text', el, `visible placeholder text: ${JSON.stringify(text.slice(0, 80))}`);
      }
    }

    // --- layout-overflow (page-level horizontal) ---
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      let worst = null;
      let worstRight = de.clientWidth;
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > worstRight) {
          worstRight = r.right;
          worst = el;
        }
      });
      if (worst) {
        push('layout-overflow', worst, `element extends ${Math.round(worstRight)}px, past viewport width ${de.clientWidth}px (horizontal scroll)`);
      }
    }

    // --- element-clip (visible text cut off by a clipping container) ---
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      const clips = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden';
      if (!clips) return;
      // Intentional truncation and scroll containers are design, not defects:
      if (cs.textOverflow === 'ellipsis') return;
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') return;
      if (el.closest('[class*="carousel"],[class*="slider"],[class*="marquee"],[class*="ticker"]')) return;
      const hasText = (el.textContent || '').trim().length > 0;
      if (!hasText) return;
      const cutX = el.scrollWidth > el.clientWidth + 4;
      const cutY = el.scrollHeight > el.clientHeight + 4;
      if (!cutX && !cutY) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        push('element-clip', el, `content clipped: scroll ${el.scrollWidth}x${el.scrollHeight} vs client ${el.clientWidth}x${el.clientHeight}`);
      }
    });

    // ---------- tier3-only detectors below ----------
    if (profile !== 'tier3') return;

    // --- unlabeled-control (tier3): a field a person cannot identify. The bar
    // is "cannot tell what to type", NOT "missing ARIA": placeholder/title
    // count as a name source here, and disabled controls are skipped. ---
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      // checkbox/radio are excluded: you don't "type" into them, and their
      // label is conventionally adjacent visible text this detector cannot
      // see — flagging them would be false-positive ARIA-noise. Text inputs
      // whose only label is adjacent visible text (e.g. "<span>City</span>
      // <input>") remain a known false-positive source; the persona lens at
      // the Judge step is the backstop.
      if (el.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(type)) return;
      if (el.disabled) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      const id = el.getAttribute('id');
      const hasLabelFor = !!(id && document.querySelector('label[for="' + CSS.escape(id) + '"]'));
      const hasWrappingLabel = !!el.closest('label');
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const labelledby = (el.getAttribute('aria-labelledby') || '').trim();
      const labelledbyHasText = !!labelledby && labelledby.split(/\s+/).some((ref) => {
        const t = document.getElementById(ref);
        return !!t && (t.textContent || '').trim().length > 0;
      });
      const placeholder = (el.getAttribute('placeholder') || '').trim();
      const title = (el.getAttribute('title') || '').trim();
      if (hasLabelFor || hasWrappingLabel || ariaLabel || labelledbyHasText || placeholder || title) return;
      const tag = el.tagName.toLowerCase();
      push('unlabeled-control', el, `form control has no label, aria-label, placeholder, or title (${tag}${tag === 'input' ? ` type="${type}"` : ''})`);
    });

    // --- text-overlap (tier3): two text-bearing elements painted over each
    // other. Known false-positive source: decorative overlaps — cut from
    // Tier1 for exactly that reason; the persona lens judges every hit. ---
    const textEls = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (textEls.length >= 1200) return; // perf cap: 1200² pairwise checks stay well under a second client-side, while covering content-rich pages the old 300 cap blinded in the tail
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.nodeValue || '').trim()).join('');
      if (ownText.length < 3) return;
      if (el.closest('script,style,noscript,template')) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      textEls.push({ el, r });
    });
    for (let i = 0; i < textEls.length; i++) {
      for (let j = i + 1; j < textEls.length; j++) {
        const a = textEls[i];
        const b = textEls[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix <= 0 || iy <= 0) continue;
        const inter = ix * iy;
        const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if (smaller <= 0 || inter / smaller < 0.3) continue;
        push('text-overlap', b.el, `text overlaps another text element (${Math.round((inter / smaller) * 100)}% of the smaller box) — the other one reads: ${JSON.stringify((a.el.textContent || '').trim().slice(0, 60))}`);
      }
    }
  }

  runDetectors();
  return out;
}

// Element-in-context PNG (base64) via a viewport clip around the element + padding.
// Returns { shot: base64|null, reason: string|null } — reason explains a null shot.
async function shotForSelector(page, cand, pad = 80) {
  // One candidate must never abort the whole multi-viewport scan. Any rejection
  // below — an SPA route change destroying the execution context mid-scan (the
  // exact fast-mutating class this hardening targets), or a screenshot failure —
  // becomes a dropped finding, not exit 1 losing every already-collected pin.
  try {
    const el = await page.$(cand.selector);
    if (!el) return { shot: null, reason: 'element no longer present' };
    // Direct DOM scrollIntoView, NOT Playwright's scrollIntoViewIfNeeded: the
    // latter's actionability "stable box" wait never resolves on a continuously
    // animating element and stalls the whole scan for the 30s timeout (a spinner
    // or marquee candidate would freeze a real-page run). We only need the element
    // scrolled into frame for the clip; behavior:'instant' guards pages that set
    // scroll-behavior:smooth. This also lets the post-shot re-compare — not a
    // scroll stall — be what catches a moving element.
    await el.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })).catch(() => {});
    // Pre-shot verification: the DOM may have mutated since detection (hydration,
    // rotators) and fixed overlays may cover the element (cookie banners). A
    // screenshot that contradicts the evidence is worse than a skipped finding.
    const pre = await el.evaluate((node, expectedHtml) => {
      // page.screenshot()'s caret:hide adds an empty style="" to text-editable
      // controls (input/textarea) across the whole page — a rendering artifact,
      // not a content mutation. Strip it from both sides so multi-field forms
      // don't silently drop every control after the first screenshot.
      const strip = (h) => (h || '').replace(/ style=""/g, '');
      if (strip((node.outerHTML || '').slice(0, 2000)) !== strip(expectedHtml)) return { fail: 'mutated since detection' };
      const r = node.getBoundingClientRect();
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(node === hit || node.contains(hit) || hit.contains(node))) return { fail: 'covered by another element' };
      // pointer-events:none veil: invisible to elementFromPoint by definition,
      // but paints OVER the element in the screenshot when visually opaque.
      // A transparent event-shield is harmless and must not drop the candidate.
      for (const other of document.body.querySelectorAll('*')) {
        if (other === node || other.contains(node) || node.contains(other)) continue;
        const or = other.getBoundingClientRect();
        if (cx < or.left || cx > or.right || cy < or.top || cy > or.bottom) continue; // cheap reject first
        const cs = getComputedStyle(other);
        if (cs.pointerEvents !== 'none') continue; // pointer-aware overlays are caught by the hit-test above
        if (!['fixed', 'sticky', 'absolute'].includes(cs.position)) continue; // only positioned boxes float over unrelated content
        if (!other.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (parseFloat(cs.opacity) < 0.15) continue; // < ~15% opacity can't visibly corrupt a shot
        const bgMatch = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        // Unrecognized color forms (wide-gamut color()/oklch) don't match the rgba
        // regex → treated as opaque. That is the SAFE direction: an opaque veil read
        // as opaque drops the candidate (a wrong screenshot is worse than a missing
        // finding); the reverse would silently miss real veils.
        const bgAlpha = bgMatch
          ? (bgMatch[1].split(',')[3] !== undefined ? parseFloat(bgMatch[1].split(',')[3]) : 1)
          : 1;
        // Own DIRECT text only — NOT textContent. A full-viewport pointer-events:none
        // toast/notification portal covers every candidate but paints nothing at the
        // centroid; its transient toast text lives in nested children. Attributing that
        // descendant text to the empty wrapper would false-drop every finding on modern
        // apps. A veil that paints text over the element owns that text directly.
        const ownText = [...other.childNodes].filter((n) => n.nodeType === 3).map((n) => (n.nodeValue || '').trim()).join('');
        // > ~5% bg alpha, a background image, or the veil's own text = visible paint.
        const paints = bgAlpha > 0.05 || cs.backgroundImage !== 'none' || ownText.length > 0;
        if (paints) return { fail: 'covered by a pointer-events:none overlay' };
      }
      return { fail: null, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }, cand.html);
    if (pre.fail) return { shot: null, reason: `pre-shot verification failed (${pre.fail})` };
    const box = await el.boundingBox();
    if (!box || box.width === 0 || box.height === 0) return { shot: null, reason: 'zero-size box' };
    const vp = page.viewportSize();
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const width = Math.min(box.width + pad * 2, vp.width - x);
    const height = Math.min(box.height + pad * 2, vp.height - y);
    if (width <= 0 || height <= 0) return { shot: null, reason: 'zero-size clip' };
    const buf = await page.screenshot({ clip: { x, y, width, height } });
    // Post-shot re-compare: the pre-shot check and the shot are separate CDP
    // roundtrips (~100 ms apart) — a fast-mutating page can rewrite or move the
    // element in between, shipping a screenshot that trails the evidence. Same
    // style="" normalization as pre-shot (a text control's own screenshot adds
    // it, so without stripping every input/textarea would false-fail here).
    const still = await el.evaluate((node, expected) => {
      const strip = (h) => (h || '').replace(/ style=""/g, '');
      if (strip((node.outerHTML || '').slice(0, 2000)) !== strip(expected.html)) return false;
      const r = node.getBoundingClientRect();
      return Math.abs(r.left - expected.rect.left) <= 2 && Math.abs(r.top - expected.rect.top) <= 2 &&
        Math.abs(r.width - expected.rect.width) <= 2 && Math.abs(r.height - expected.rect.height) <= 2;
    }, { html: cand.html, rect: pre.rect }).catch(() => false);
    if (!still) return { shot: null, reason: 'post-shot re-compare failed (page mutated during shot)' };
    return { shot: buf.toString('base64'), reason: null };
  } catch (err) {
    return { shot: null, reason: `shot attempt aborted (${err.message})` };
  }
}

// Fallback when there is no unique selector: clip a region around the document rect.
async function shotForRect(page, rect, pad = 80) {
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 100)), rect.y);
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const vp = page.viewportSize();
  const x = Math.max(0, rect.x - scroll.x - pad);
  const y = Math.max(0, rect.y - scroll.y - pad);
  const width = Math.min(rect.width + pad * 2, vp.width - x);
  const height = Math.min(rect.height + pad * 2, vp.height - y);
  if (width <= 0 || height <= 0) return null;
  const buf = await page.screenshot({ clip: { x, y, width, height } });
  return buf.toString('base64');
}

const SEVERITY = {
  'broken-image': 'High',
  'layout-overflow': 'High',
  'element-clip': 'High',
  'focus-trap': 'High',
  'dead-link': 'Medium',
  'console-error': 'Medium',
  'unlabeled-control': 'Medium',
  'text-overlap': 'Medium',
  'placeholder-text': 'Low',
};
const SEV_RANK = { Blocker: 3, High: 2, Medium: 1, Low: 0 };
const MAX_PER_TYPE = 10;

function dedupe(list, truncated) {
  // 1) same finding re-found at another viewport → keep the smallest viewport
  const byKey = new Map();
  for (const c of list) {
    const key = c.type + '|' + (c.selector || (c.evidence ? c.evidence.replace(/\d+/g, '#') : (c.rect ? `${c.rect.x},${c.rect.y}` : 'x')));
    const prev = byKey.get(key);
    if (!prev || (c.viewport || 0) < (prev.viewport || 0)) byKey.set(key, c);
  }
  let out = [...byKey.values()].map((c) => ({ ...c, severity: SEVERITY[c.type] || 'Medium' }));

  // 2) cross-type anchor collision: one anchor = one finding (else pins stack —
  //    the original overlap bug back through a different door)
  const byAnchor = new Map();
  const anchorless = [];
  for (const c of out) {
    if (!c.selector) { anchorless.push(c); continue; }
    const prev = byAnchor.get(c.selector);
    if (!prev) { byAnchor.set(c.selector, c); continue; }
    const [win, lose] = (SEV_RANK[c.severity] ?? 0) > (SEV_RANK[prev.severity] ?? 0) ? [c, prev] : [prev, c];
    win.evidence += `; also ${lose.type} (at ${lose.viewport}px): ${lose.evidence}`;
    byAnchor.set(c.selector, win);
  }
  out = [...byAnchor.values(), ...anchorless];

  // 3) mobile-first order before the cap — stable sort preserves document order
  //    within a viewport, and makes output independent of --viewports arg order
  out.sort((a, b) => (a.viewport || 0) - (b.viewport || 0));

  // per-type cap — guards blob volume on messy pages; cuts are recorded, never silent
  const perType = new Map();
  const capped = [];
  for (const c of out) {
    const n = (perType.get(c.type) || 0) + 1;
    perType.set(c.type, n);
    if (n <= MAX_PER_TYPE) capped.push(c);
    else truncated[c.type] = (truncated[c.type] || 0) + 1;
  }
  return capped.map((c, i) => ({ id: `c${i + 1}`, ...c }));
}

// A trap = the tail of the focus chain repeats the same short sequence.
// Returns the distinct paths of the minimal cycle, or null.
function tailCycle(chain, maxLen = 5, minReps = 3) {
  for (let L = 1; L <= maxLen; L++) {
    const need = L * minReps;
    if (chain.length < need) continue;
    const tail = chain.slice(-need);
    if (tail.some((p) => p === null)) continue; // wrap through the document is not a trap
    const unit = tail.slice(0, L).join(',');
    let ok = true;
    for (let r = 1; r < minReps; r++) {
      if (tail.slice(r * L, (r + 1) * L).join(',') !== unit) { ok = false; break; }
    }
    if (ok && new Set(tail.slice(0, L)).size === L) return [...new Set(tail.slice(0, L))];
  }
  return null;
}

// Tier3-only: read-only Tab traversal that detects keyboard focus traps.
// No clicks, no typing — the ONLY interaction the scanner performs.
// Returns a candidate-shaped object (no viewport/screenshot yet) or null.
async function focusTrapPass(page) {
  const total = await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const sel = 'a[href], button, input, select, textarea, [tabindex]';
    return [...document.querySelectorAll(sel)].filter((el) => {
      if (el.disabled || el.tabIndex < 0) return false;
      if (el.closest('[inert]')) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      // browsers skip visibility:hidden / display:none in the Tab order, yet
      // those still occupy layout (non-zero rect) — count only genuinely
      // tab-reachable elements so the whole-page-wrap guard stays honest.
      return el.checkVisibility({ visibilityProperty: true });
    }).length;
  });
  if (total < 3) return null; // 1-2 focusables cycle by definition — not a trap

  const chain = [];
  let cycle = null;
  for (let i = 0; i < 50 && !cycle; i++) {
    await page.keyboard.press('Tab');
    const path = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const p = [];
      let n = el;
      while (n && n !== document.body) {
        p.unshift([...n.parentNode.children].indexOf(n));
        n = n.parentElement;
      }
      return p.join('/');
    });
    if (path === null && chain[chain.length - 1] === null) break; // focus left the page twice — free traversal
    chain.push(path);
    cycle = tailCycle(chain);
  }
  if (!cycle) {
    if (chain.length >= 50) process.stderr.write('note: focus-trap pass reached the 50-Tab cap without resolving a cycle — a trap behind >50 focusables would be missed\n');
    return null;
  }
  if (cycle.length >= total) return null; // whole-page wrap is not a trap

  return await page.evaluate(([paths, totalFocusable]) => {
    const byPath = (p) => p.split('/').reduce((n, i) => (n ? n.children[+i] : null), document.body);
    const els = paths.map(byPath).filter(Boolean);
    if (!els.length) return null;
    let anc = els[0];
    while (anc && anc !== document.body && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
    if (!anc || anc === document.body) anc = els[0];

    // Same selector algorithm as inPageDetect — duplicated because each
    // page.evaluate serializes its function in isolation (no shared closure).
    function cssPath(el) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        const cls = [...node.classList].filter((c) => /^[A-Za-z_-]/.test(c));
        if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
        const sibs = [...node.parentNode.children].filter((n) => n.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
        parts.unshift(part);
        const sel = parts.join(' > ');
        if (document.querySelectorAll(sel).length === 1) return sel;
        node = node.parentElement;
      }
      return parts.join(' > ');
    }
    const sel = cssPath(anc);
    const unique = document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === anc;
    const r = anc.getBoundingClientRect();
    const rect = {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    return {
      type: 'focus-trap',
      selector: unique ? sel : null,
      selector_unique: unique,
      rect,
      pin: { x: rect.x + Math.round(rect.width / 2), y: rect.y + Math.round(rect.height / 2) },
      html: (anc.outerHTML || '').slice(0, 2000),
      evidence: `keyboard focus cycles between ${paths.length} element(s) and never leaves — ${totalFocusable - paths.length} other focusable element(s) on the page are unreachable by Tab`,
    };
  }, [cycle, total]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  if (!args.url) { process.stderr.write('error: --url is required\n' + HELP); process.exit(2); }
  if (!args.viewports.length || args.viewports.some((v) => !Number.isInteger(v) || v <= 0)) {
    process.stderr.write('error: --viewports must be a comma-separated list of positive integers\n' + HELP);
    process.exit(2);
  }
  if (!['tier1', 'tier3'].includes(args.profile)) {
    process.stderr.write(`error: unknown --profile ${JSON.stringify(args.profile)} — expected tier1 or tier3\n` + HELP);
    process.exit(2);
  }

  const scanned = [];
  const candidates = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of args.viewports) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() !== 'error') return;
          const text = msg.text();
          // Resource-load failures are already covered by dedicated detectors
          // (broken-image etc.) — reporting them twice is noise.
          if (/failed to load resource/i.test(text)) return;
          consoleErrors.push(text);
        });
        page.on('pageerror', (err) => consoleErrors.push(err.message));

        const status = await loadPage(page, args.url);
        scanned.push({ viewport: width, status });
        if (status === 'failed') continue;
        // Lazy-load pass: scroll to the bottom and back so loading="lazy" images
        // and below-the-fold content actually load before detection. Step cap
        // guards against infinite-scroll pages.
        await page.evaluate(async () => {
          const step = window.innerHeight;
          let steps = 0;
          for (let y = 0; y < document.documentElement.scrollHeight && steps < 20; y += step, steps++) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 100));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(500);

        const raw = await page.evaluate(inPageDetect, args.profile);
        for (const cand of raw) {
          let shot;
          if (cand.selector) {
            const res = await shotForSelector(page, cand);
            shot = res.shot;
            if (!shot) process.stderr.write(`note: dropped ${cand.type} ${cand.selector} at ${width}px — ${res.reason}\n`);
          } else {
            shot = await shotForRect(page, cand.rect);
            if (!shot) process.stderr.write(`note: dropped ${cand.type} (no selector) at ${width}px — rect shot failed\n`);
          }
          if (!shot) continue; // HARD RULE 1: no screenshot → do not emit
          candidates.push({ ...cand, viewport: width, screenshot_base64: shot });
        }

        if (args.profile === 'tier3') {
          const trap = await focusTrapPass(page);
          if (trap) {
            const res = trap.selector
              ? await shotForSelector(page, trap)
              : { shot: await shotForRect(page, trap.rect), reason: 'rect shot failed' };
            if (res.shot) candidates.push({ ...trap, viewport: width, screenshot_base64: res.shot });
            else process.stderr.write(`note: dropped focus-trap ${trap.selector || '(no selector)'} at ${width}px — ${res.reason}\n`);
          }
        }

        if (consoleErrors.length) {
          // No screenshot: a console error has nothing to photograph (a
          // full-viewport shot of the page top is semantically empty). The
          // error lines themselves ARE the evidence — they ship as `console`
          // and render in the card's Details → Console.
          const unique = [...new Set(consoleErrors)].slice(0, 5);
          candidates.push({
            type: 'console-error',
            viewport: width,
            selector: null,
            selector_unique: false,
            rect: null,
            pin: null,
            html: null,
            evidence: `console errors (${unique.length}): ${unique.map((t) => t.slice(0, 200)).join(' | ')}`,
            console: unique.map((t) => t.slice(0, 200)),
          });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const truncated = {};
  const finalCandidates = dedupe(candidates, truncated);
  for (const [type, n] of Object.entries(truncated)) {
    process.stderr.write(`note: capped ${type} at ${MAX_PER_TYPE}, dropped ${n}\n`);
  }
  const result = { scanned, truncated, candidates: finalCandidates };
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(summarize(result), null, 2));
}

main().catch((err) => { process.stderr.write(`fatal: ${err.stack || err}\n`); process.exit(1); });
