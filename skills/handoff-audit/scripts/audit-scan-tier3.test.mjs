import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'audit-scan.mjs');
const fixtureUrl = 'file://' + join(here, '..', 'examples', 'fixture-tier3.html');

// Memoized like scan() in audit-scan.test.mjs: one Chromium launch per
// (profile, viewports) pair for the whole suite.
const cache = new Map();
export function scanTier3(profile = 'tier3', viewports = '800') {
  const key = profile + '|' + viewports;
  if (cache.has(key)) return cache.get(key);
  const tmp = join(tmpdir(), `audit-scan-t3-${process.pid}-${profile}-${viewports.replace(/,/g, '-')}.json`);
  const res = spawnSync('node', [script, '--url', fixtureUrl, '--profile', profile, '--viewports', viewports, '--out', tmp], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  const result = { summary: JSON.parse(res.stdout), full: JSON.parse(readFileSync(tmp, 'utf8')), stderr: res.stderr };
  rmSync(tmp, { force: true });
  cache.set(key, result);
  return result;
}

test('--help documents --profile', () => {
  const out = execFileSync('node', [script, '--help'], { encoding: 'utf8' });
  assert.match(out, /--profile/);
  assert.match(out, /tier3/);
});

test('unknown --profile exits non-zero with a clear error', () => {
  let err;
  try {
    execFileSync('node', [script, '--url', 'http://localhost/', '--profile', 'tier9'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    err = e;
  }
  assert(err, 'expected to throw');
  assert.match(err.stderr, /unknown --profile/);
});

test('fixture is tier1-clean and profile-isolated: tier1 run emits no candidates at all', () => {
  const { full } = scanTier3('tier1');
  assert.deepEqual(full.candidates, [], `tier1 must see a clean page, got: ${full.candidates.map((c) => c.type).join(', ')}`);
});

test('unlabeled-control: every bare text control survives the shot pipeline; skips labeled/placeholder/aria/title/checkbox', () => {
  const found = scanTier3().full.candidates.filter((c) => c.type === 'unlabeled-control');
  const sels = found.map((c) => c.selector || '');
  assert.equal(found.length, 3, `all three bare controls must survive (screenshot-induced style="" must not silently drop them), got: ${sels.join(', ')}`);
  assert.equal(sels.filter((s) => /unlabeled-input/.test(s)).length, 2, 'both bare text inputs are flagged, not just the first');
  assert.ok(sels.some((s) => s.includes('unlabeled-textarea')), 'the bare textarea is flagged');
  assert.ok(!sels.some((s) => s.includes('bare-checkbox')), 'checkbox/radio are not text-entry controls — must not be flagged');
  for (const c of found) {
    assert.equal(c.severity, 'Medium');
    assert.match(c.evidence, /no label/i);
    assert.ok(c.screenshot_base64, `${c.selector} must carry a screenshot`);
  }
});

test('text-overlap: flags the stacked paragraphs, silent on caption-over-image', () => {
  const found = scanTier3().full.candidates.filter((c) => c.type === 'text-overlap');
  assert.equal(found.length, 1, `expected exactly the planted pair, got: ${found.map((c) => c.selector).join(', ')}`);
  assert.ok(found[0].selector.includes('overlap-over'), 'anchors to the later (painted-on-top) element');
  assert.equal(found[0].severity, 'Medium');
  assert.match(found[0].evidence, /overlaps/);
});

test('focus-trap: pins the trapping container, counts the unreachable rest', () => {
  const found = scanTier3().full.candidates.filter((c) => c.type === 'focus-trap');
  assert.equal(found.length, 1, `expected exactly the planted trap, got: ${found.map((c) => c.selector).join(', ')}`);
  assert.ok(found[0].selector.includes('trap-modal'), 'pin lands on the common ancestor of the cycle');
  assert.equal(found[0].severity, 'High');
  assert.match(found[0].evidence, /focus cycles/);
  assert.match(found[0].evidence, /unreachable/);
  assert.ok(found[0].screenshot_base64, 'trap candidate ships a screenshot like any selector candidate');
});

test('focus-trap guard: visibility:hidden focusables do not inflate `total` into a false trap', () => {
  const noTrapUrl = 'file://' + join(here, '..', 'examples', 'fixture-no-trap.html');
  const tmp = join(tmpdir(), `audit-scan-notrap-${process.pid}.json`);
  const res = spawnSync('node', [script, '--url', noTrapUrl, '--profile', 'tier3', '--viewports', '800', '--out', tmp], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  const full = JSON.parse(readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  const traps = full.candidates.filter((c) => c.type === 'focus-trap');
  assert.equal(traps.length, 0, `a page with no trap (just visibility:hidden focusables) must not be flagged, got: ${traps.map((c) => c.selector).join(', ')}`);
});
