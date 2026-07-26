import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const poster = join(here, 'audit-post.mjs');

// 1x1 transparent PNG — a real, valid base64 payload without a browser.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const scanFile = join(tmpdir(), `audit-post-scan-${process.pid}.json`);
const postFile = join(tmpdir(), `audit-post-manifest-${process.pid}.json`);
const cfgFile = join(tmpdir(), `audit-post-config-${process.pid}.json`);

function writeFixtures() {
  writeFileSync(scanFile, JSON.stringify({
    scanned: [{ viewport: 320, status: 'ok' }],
    truncated: {},
    candidates: [
      { id: 'c1', type: 'dead-link', viewport: 320, selector: '.footcol > a', selector_unique: true,
        rect: { x: 40, y: 500, width: 40, height: 18 }, pin: { x: 60, y: 509 },
        html: '<a href="#">Home</a>', evidence: 'href="#"', severity: 'Medium', screenshot_base64: PNG_1PX },
      { id: 'c2', type: 'console-error', viewport: 320, selector: null, selector_unique: false,
        rect: null, pin: null, html: null, evidence: 'console errors (1): boom', severity: 'Medium', console: ['boom'] },
    ],
  }));
  writeFileSync(postFile, JSON.stringify({
    page_url: 'https://example.com/',
    findings: [
      { id: 'c1', body: 'Footer Home link goes nowhere (href="#").' },
      { id: 'c2', body: 'Console error on load.', severity: 'Medium' },
    ],
  }));
}

function startStub() {
  let seen = null;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: seen.body.id,
        result: { content: [{ type: 'text', text: 'Created 2 pin(s) on https://example.com/ (one review each):\nrvw_aaa cmt_aaa\nrvw_bbb cmt_bbb' }] },
      }));
    });
  });
  return new Promise((resolve) => srv.listen(0, () => resolve({ srv, port: srv.address().port, seen: () => seen })));
}

test('--help exits 0 and prints usage', () => {
  const out = execFileSync('node', [poster, '--help'], { encoding: 'utf8' });
  assert.match(out, /audit-post\.mjs/);
  assert.match(out, /--scan/);
  assert.match(out, /--post/);
});

test('posts merged findings via JSON-RPC tools/call; token stays out of stdout', async () => {
  writeFixtures();
  const { srv, port, seen } = await startStub();
  try {
    // execFile (async), not execFileSync: execFileSync blocks the Node.js
    // event loop, which would deadlock this in-process HTTP stub — it could
    // never handle the request the child process sends back to it.
    const { stdout: out } = await execFileAsync('node', [poster, '--scan', scanFile, '--post', postFile, '--endpoint', `http://127.0.0.1:${port}`], {
      encoding: 'utf8',
      env: { ...process.env, HANDOFF_MCP_TOKEN: 'sekret-token' },
    });
    const req = seen();
    assert.equal(req.auth, 'Bearer sekret-token');
    assert.equal(req.body.method, 'tools/call');
    assert.equal(req.body.params.name, 'create_comments');
    assert.equal(req.body.params.arguments.page_url, 'https://example.com/');
    const f = req.body.params.arguments.findings;
    assert.equal(f.length, 2);
    assert.equal(f[0].selector, '.footcol > a');
    assert.equal(f[0].screenshot_base64, PNG_1PX, 'screenshot travels file → HTTP, untouched');
    assert.equal(f[0].severity, 'Medium', 'severity defaults from the candidate');
    assert.deepEqual(f[1].console, ['boom'], 'console-error posts its console lines');
    assert.ok(!('selector' in f[1]) && !('pin' in f[1]) && !('rect' in f[1]) && !('html' in f[1]) && !('screenshot_base64' in f[1]),
      'console-error posts board-only: no selector/pin/rect/html/screenshot');
    assert.match(out, /rvw_aaa/, 'server response text is printed for the agent to report');
    assert.doesNotMatch(out, /sekret-token/, 'token must never be printed');
  } finally {
    srv.close();
    rmSync(scanFile, { force: true }); rmSync(postFile, { force: true });
  }
});

test('reads endpoint + token from an MCP config file (--config)', async () => {
  writeFixtures();
  const { srv, port, seen } = await startStub();
  writeFileSync(cfgFile, JSON.stringify({
    mcpServers: { 'design-review': { url: `http://127.0.0.1:${port}`, headers: { Authorization: 'Bearer cfg-token' } } },
  }));
  try {
    // See note above: async execFile, not execFileSync, so the in-process
    // stub server can respond instead of deadlocking against it.
    await execFileAsync('node', [poster, '--scan', scanFile, '--post', postFile, '--config', cfgFile], { encoding: 'utf8' });
    assert.equal(seen().auth, 'Bearer cfg-token');
  } finally {
    srv.close();
    rmSync(scanFile, { force: true }); rmSync(postFile, { force: true }); rmSync(cfgFile, { force: true });
  }
});

test('finds the server in project-scoped MCP config (claude mcp add local scope)', async () => {
  writeFixtures();
  const { srv, port, seen } = await startStub();
  // claude mcp add defaults to LOCAL scope: the entry lives under
  // projects.<dir>.mcpServers in ~/.claude.json, NOT top-level mcpServers.
  writeFileSync(cfgFile, JSON.stringify({
    projects: {
      '/Users/someone/project': {
        mcpServers: { 'design-review': { url: `http://127.0.0.1:${port}`, headers: { Authorization: 'Bearer proj-token' } } },
      },
    },
  }));
  try {
    await execFileAsync('node', [poster, '--scan', scanFile, '--post', postFile, '--config', cfgFile], { encoding: 'utf8' });
    assert.equal(seen().auth, 'Bearer proj-token');
  } finally {
    srv.close();
    rmSync(scanFile, { force: true }); rmSync(postFile, { force: true }); rmSync(cfgFile, { force: true });
  }
});

test('--timeout aborts a hung request with a non-zero exit and a clear message', async () => {
  writeFixtures();
  // A server that accepts connections but never responds.
  const srv = createServer(() => { /* never end the response */ });
  await new Promise((resolve) => srv.listen(0, resolve));
  const port = srv.address().port;
  try {
    await assert.rejects(
      execFileAsync('node', [poster, '--scan', scanFile, '--post', postFile, '--endpoint', `http://127.0.0.1:${port}`, '--timeout', '500'], {
        encoding: 'utf8',
        env: { ...process.env, HANDOFF_MCP_TOKEN: 'x' },
      }),
      (e) => {
        assert.notEqual(e.code, 0);
        assert.match(e.stderr, /timed out after 500ms/);
        return true;
      },
    );
  } finally {
    srv.closeAllConnections?.();
    srv.close();
    rmSync(scanFile, { force: true }); rmSync(postFile, { force: true });
  }
});

test('connection refused surfaces the underlying cause, not just "fetch failed"', async () => {
  writeFixtures();
  // Port 1 won't do: it's on the WHATWG fetch bad-port blocklist, so undici
  // rejects with cause "bad port" before ever dialing. Grab a real free port
  // and close it so connecting yields an actual ECONNREFUSED.
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, resolve));
  const deadPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  try {
    await assert.rejects(
      execFileAsync('node', [poster, '--scan', scanFile, '--post', postFile, '--endpoint', `http://127.0.0.1:${deadPort}`], {
        encoding: 'utf8',
        env: { ...process.env, HANDOFF_MCP_TOKEN: 'x' },
      }),
      (e) => {
        assert.notEqual(e.code, 0);
        assert.match(e.stderr, /ECONNREFUSED|connect/);
        return true;
      },
    );
  } finally {
    rmSync(scanFile, { force: true }); rmSync(postFile, { force: true });
  }
});

test('refuses a finding whose candidate has no screenshot (HARD RULE 1)', async () => {
  writeFixtures();
  const scan = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync('${scanFile}','utf8'))`], { encoding: 'utf8' }));
  scan.candidates[0].screenshot_base64 = null;
  writeFileSync(scanFile, JSON.stringify(scan));
  assert.throws(() => execFileSync('node', [poster, '--scan', scanFile, '--post', postFile, '--endpoint', 'http://127.0.0.1:1'], {
    encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, HANDOFF_MCP_TOKEN: 'x' },
  }), /screenshot/i);
  rmSync(scanFile, { force: true }); rmSync(postFile, { force: true });
});
