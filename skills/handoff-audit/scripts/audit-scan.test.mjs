import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'audit-scan.mjs');
export const fixtureUrl = 'file://' + join(here, '..', 'examples', 'fixture-tier1.html');

// Memoized: one Chromium launch per distinct viewport set for the whole suite.
const cache = new Map();
export function scan(viewports = '320') {
  if (cache.has(viewports)) return cache.get(viewports);
  const tmp = join(tmpdir(), `audit-scan-${process.pid}-${viewports.replace(/,/g, '-')}.json`);
  const stdout = execFileSync('node', [script, '--url', fixtureUrl, '--viewports', viewports, '--out', tmp], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const result = { summary: JSON.parse(stdout), full: JSON.parse(readFileSync(tmp, 'utf8')) };
  rmSync(tmp, { force: true });
  cache.set(viewports, result);
  return result;
}

test('--help exits 0 and prints usage', () => {
  const out = execFileSync('node', [script, '--help'], { encoding: 'utf8' });
  assert.match(out, /audit-scan\.mjs/);
  assert.match(out, /--viewports/);
  assert.match(out, /--out/);
});

test('missing --url exits non-zero', () => {
  assert.throws(() => execFileSync('node', [script], { encoding: 'utf8', stdio: 'pipe' }));
});

test('garbage --viewports exits non-zero (no false clean scan)', () => {
  let err;
  try {
    execFileSync('node', [script, '--url', 'http://localhost/', '--viewports', 'foo,bar'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert(err, 'expected to throw');
  assert.match(err.stderr, /positive integers/);
});

test('negative viewport exits non-zero up front', () => {
  let err;
  try {
    execFileSync('node', [script, '--url', 'http://localhost/', '--viewports', '320,-100,768'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert(err, 'expected to throw');
  assert.match(err.stderr, /positive integers/);
});

test('missing --viewports value exits non-zero cleanly', () => {
  let err;
  try {
    execFileSync('node', [script, '--url', 'http://localhost/', '--viewports'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert(err, 'expected to throw');
  assert.match(err.stderr, /positive integers/);
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(b64) {
  const buf = Buffer.from(b64, 'base64');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('dead-link: finds all three plants with DISTINCT unique selectors, skips the JS-toggle', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'dead-link');
  assert.equal(found.length, 3, 'expected three dead-link candidates (cta, promo, footer Home)');
  const selectors = found.map((c) => c.selector);
  assert.ok(selectors.every(Boolean), 'every dead-link selector must be non-null');
  assert.equal(new Set(selectors).size, 3, 'the three selectors must differ (no pin overlap)');
  assert.ok(!selectors.some((s) => s.includes('menu-toggle')), 'JS-toggle (role/aria) must not be flagged');
});

test('every non-console candidate carries a valid element-in-context PNG', () => {
  const all = scan('320').full.candidates;
  assert.ok(all.length > 0, 'expected at least one candidate');
  for (const c of all.filter((c) => c.type !== 'console-error')) {
    assert.ok(c.screenshot_base64, `candidate ${c.type} missing screenshot`);
    const buf = Buffer.from(c.screenshot_base64, 'base64');
    assert.ok(buf.subarray(0, 8).equals(PNG_MAGIC), `candidate ${c.type} screenshot is not a PNG`);
  }
  for (const c of all.filter((c) => c.type === 'console-error')) {
    assert.ok(Array.isArray(c.console) && c.console.length >= 1, 'console-error candidate must carry console lines');
    assert.ok(!('screenshot_base64' in c), 'console-error candidate must not carry a screenshot');
  }
});

test('screenshot clip actually frames the element (clip-semantics guard)', () => {
  const link = scan('320').full.candidates.find((c) => c.type === 'dead-link');
  const { width } = pngSize(link.screenshot_base64);
  assert.ok(width >= link.rect.width, `shot width ${width} < element width ${link.rect.width}`);
  assert.ok(width <= 320, `shot width ${width} exceeds the 320 viewport`);
});

import { spawnSync } from 'node:child_process';

// Memoized: one hazards-fixture Chromium launch for the whole suite.
let hazardsCache = null;
function scanHazards() {
  if (hazardsCache) return hazardsCache;
  const hazardsUrl = 'file://' + join(here, '..', 'examples', 'fixture-hazards.html');
  const tmp = join(tmpdir(), `audit-scan-hazards-${process.pid}.json`);
  const res = spawnSync('node', [script, '--url', hazardsUrl, '--viewports', '320', '--out', tmp], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  const full = JSON.parse(readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  hazardsCache = { full, stderr: res.stderr };
  return hazardsCache;
}

test('pre-shot verification: occluded and mutated candidates are dropped, loudly', () => {
  const { full, stderr } = scanHazards();
  const links = full.candidates.filter((c) => c.type === 'dead-link');
  assert.equal(links.length, 1, 'only the visible, stable link survives');
  assert.ok(links[0].selector.includes('visible-one'), 'the survivor is .visible-one');
  assert.match(stderr, /dropped dead-link .*covered/, 'occluded drop is reported on stderr');
});

test('post-shot re-compare: a continuously moving element never ships a screenshot', () => {
  const { full, stderr } = scanHazards();
  assert.ok(!full.candidates.some((c) => c.selector && c.selector.includes('mover')), 'the mover must not ship');
  assert.match(stderr, /dropped placeholder-text .*mover.*post-shot re-compare failed/);
});

test('pointer-events veils: opaque veil drops the candidate, transparent shield does not', () => {
  const { full, stderr } = scanHazards();
  const imgs = full.candidates.filter((c) => c.type === 'broken-image');
  assert.equal(imgs.length, 1, `only the transparently-shielded image survives, got: ${imgs.map((c) => c.selector).join(', ')}`);
  assert.ok(imgs[0].selector.includes('shielded-broken'), 'the survivor is the shielded one');
  assert.match(stderr, /dropped broken-image .*veiled-broken.*pointer-events:none overlay/);
});

test('veil scan: a full-viewport pointer-events:none toast portal does not false-drop candidates via descendant text', () => {
  const portalUrl = 'file://' + join(here, '..', 'examples', 'fixture-toast-portal.html');
  const tmp = join(tmpdir(), `audit-scan-portal-${process.pid}.json`);
  const res = spawnSync('node', [script, '--url', portalUrl, '--viewports', '320', '--out', tmp], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  const full = JSON.parse(readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  const imgs = full.candidates.filter((c) => c.type === 'broken-image');
  assert.equal(imgs.length, 1, `the broken image must survive the pointer-events:none toast portal, got: ${imgs.map((c) => c.selector).join(', ')}`);
  assert.ok(imgs[0].selector.includes('real-broken'), 'survivor is the real broken image');
});

test('broken-image: flags the failed <img>, skips src-less placeholders', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'broken-image');
  assert.equal(found.length, 1, 'no-src/empty-src placeholders must not be flagged');
  assert.ok(found[0].selector, 'broken-image needs a unique selector');
  assert.match(found[0].evidence, /failed to load/);
  assert.ok(!found[0].selector.includes('tpl-'), 'the flagged one is the real broken image');
});

test('placeholder-text: flags visible Lorem ipsum, skips script text and invisible elements', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'placeholder-text');
  assert.ok(found.length >= 1, 'expected at least the .lorem paragraph');
  assert.ok(found.some((c) => c.selector && c.selector.includes('lorem')), 'must flag the .lorem paragraph');
  assert.match(found[0].evidence, /placeholder/i);
  const sels = found.map((c) => c.selector || '');
  assert.ok(!sels.some((s) => s.includes('hid-')), 'visibility:hidden/opacity:0 must not be flagged');
  assert.ok(!sels.some((s) => s.includes('script')), 'script text must not be flagged');
});

test('layout-overflow: flags horizontal overflow at 320', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'layout-overflow');
  assert.equal(found.length, 1);
  assert.match(found[0].evidence, /past viewport width/);
});

test('element-clip: flags the clipbox, stays silent on intentional ellipsis', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'element-clip');
  assert.ok(found.length >= 1, 'expected at least one clipped element');
  assert.ok(found.some((c) => c.selector && c.selector.includes('clipbox')), 'should flag the .clipbox');
  assert.ok(!found.some((c) => c.selector && c.selector.includes('ellipsized')), 'text-overflow: ellipsis is intentional — must NOT be flagged');
});

test('console-error: one merged board-only candidate; synthetic error kept, resource noise filtered', () => {
  const found = scan('320').full.candidates.filter((c) => c.type === 'console-error');
  assert.equal(found.length, 1, 'all console errors merge into one candidate per viewport');
  const c = found[0];
  assert.equal(c.selector, null, 'console-error is board-only (no selector)');
  assert.match(c.evidence, /fixture synthetic console error/);
  assert.doesNotMatch(c.evidence, /failed to load resource/i, 'resource-load noise duplicates broken-image — must be filtered');
  assert.ok(Array.isArray(c.console) && c.console.some((line) => /fixture synthetic console error/.test(line)), 'console array carries the synthetic message');
  assert.ok(!c.console.some((line) => /failed to load resource/i.test(line)), 'resource-load noise must not appear in console lines either');
  assert.ok(!('screenshot_base64' in c), 'console-error must not carry a screenshot in the full payload');
});

test('dedupe across viewports: dead-link stays 3 across three viewports', () => {
  const links = scan('320,768,1440').full.candidates.filter((c) => c.type === 'dead-link');
  assert.equal(links.length, 3, 'same links must not multiply per viewport');
  const cons = scan('320,768,1440').full.candidates.filter((c) => c.type === 'console-error');
  assert.equal(cons.length, 1, 'one logical console error must not multiply across viewports (digit-normalized dedup)');
  assert.equal(cons[0].viewport, 320, 'smallest viewport wins');
});

test('cross-type anchor collision folds into one finding (.promo)', () => {
  const all = scan('320').full.candidates;
  const promo = all.filter((c) => c.selector && c.selector.includes('promo'));
  assert.equal(promo.length, 1, 'one anchor = one finding (pins must not stack)');
  assert.equal(promo[0].type, 'dead-link', 'higher severity (Medium) wins over placeholder (Low)');
  assert.match(promo[0].evidence, /also placeholder-text \(at 320px\)/, 'merged evidence names the losing type AND its viewport');
  const sels = all.filter((c) => c.selector).map((c) => c.selector);
  assert.equal(new Set(sels).size, sels.length, 'no two final findings may share an anchor');
});

test('viewport order independence: descending --viewports still yields mobile-first output', () => {
  const all = scan('1440,320').full.candidates;
  const overflow = all.find((c) => c.type === 'layout-overflow');
  assert.equal(overflow.viewport, 320, 'smallest viewport kept regardless of scan order');
  const viewports = all.map((c) => c.viewport);
  const sorted = [...viewports].sort((a, b) => a - b);
  assert.deepEqual(viewports, sorted, 'final candidates are ordered mobile-first for the cap and ids');
});

test('severity rubric + stable ids', () => {
  const all = scan('320').full.candidates;
  const byType = (t) => all.find((c) => c.type === t);
  assert.equal(byType('broken-image').severity, 'High');
  assert.equal(byType('layout-overflow').severity, 'High');
  assert.equal(byType('element-clip').severity, 'High');
  assert.equal(byType('dead-link').severity, 'Medium');
  assert.equal(byType('console-error').severity, 'Medium');
  assert.equal(byType('placeholder-text').severity, 'Low');
  assert.ok(all.every((c) => /^c\d+$/.test(c.id)), 'every candidate carries a stable id for the poster manifest');
});

test('stdout is a base64-free summary; --out carries the full payload', () => {
  const { summary, full } = scan('320');
  assert.ok(Array.isArray(summary.candidates) && Array.isArray(full.candidates));
  assert.equal(summary.candidates.length, full.candidates.length);
  for (const c of summary.candidates) {
    assert.ok(!('screenshot_base64' in c), 'stdout must never carry base64');
    assert.equal(c.has_screenshot, c.type !== 'console-error', 'console-error carries no screenshot; every other type does');
  }
  assert.ok(full.candidates.filter((c) => c.type !== 'console-error').every((c) => c.screenshot_base64), '--out must carry the blobs for non-console candidates');
  assert.ok(Array.isArray(summary.scanned));
  assert.equal(summary.scanned[0].status, 'ok');
  assert.deepEqual(summary.truncated, {}, 'fixture is small — nothing capped');
});
