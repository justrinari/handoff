#!/usr/bin/env node
// audit-post.mjs — posts judged audit findings to Handoff via the design-review
// MCP endpoint (one JSON-RPC tools/call → create_comments). Screenshot base64
// travels file → HTTP directly; it never passes through a model's context.
// The Bearer token is read from an MCP config file or $HANDOFF_MCP_TOKEN and
// is NEVER printed.
import { readFileSync } from 'node:fs';

const HELP = `audit-post.mjs — post judged audit findings to Handoff

Usage:
  node audit-post.mjs --scan <scan.json> --post <manifest.json> \\
    ( --endpoint <mcp-url>            # token from $HANDOFF_MCP_TOKEN
    | --config <mcp-config.json> [--server design-review] )
    [--timeout <ms>]                  # HTTP request timeout, default 30000

Files:
  scan.json      full scanner output (audit-scan.mjs --out) — holds the blobs
  manifest.json  { "page_url": "...",
                   "findings": [ { "id": "c3", "body": "...", "severity"?: "High" } ] }

Merging: selector/rect/pin/html/screenshot come from the scan candidate by id;
body comes from the manifest; severity defaults to the candidate's. Console
findings (candidate.console: string[]) post as { body, severity, console } —
no screenshot, no selector/rect/pin/html (page-level, nothing to anchor to).
Sends ONE create_comments call (server caps: 20 findings, ~2 MB/shot, ~10 MB batch).
Candidate ids are scan-local: never re-run the scanner between writing the
manifest and posting.
Config formats: Claude Code ~/.claude.json, Cursor ~/.cursor/mcp.json
(mcpServers.<name>.{url,headers.Authorization}). Claude Code local-scope
entries (projects.<dir>.mcpServers, the "claude mcp add" default) are found
too. TOML configs (Codex): use --endpoint + $HANDOFF_MCP_TOKEN instead.
Output: the server's response text (review/comment ids). The token is never printed.
`;

function fail(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(2); }

function parseArgs(argv) {
  const args = { scan: null, post: null, endpoint: null, config: null, server: 'design-review', timeout: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--scan') args.scan = argv[++i];
    else if (a === '--post') args.post = argv[++i];
    else if (a === '--endpoint') args.endpoint = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--server') args.server = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
  }
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) fail('--timeout must be a positive number of milliseconds');
  return args;
}

function resolveEndpoint(args) {
  if (args.endpoint) {
    const token = process.env.HANDOFF_MCP_TOKEN;
    if (!token) fail('with --endpoint, set $HANDOFF_MCP_TOKEN (never paste the token into a chat)');
    return { url: args.endpoint, token };
  }
  if (args.config) {
    let cfg;
    try { cfg = JSON.parse(readFileSync(args.config, 'utf8')); }
    catch (e) { fail(`cannot read MCP config ${args.config}: ${e.message}`); }
    const servers = cfg.mcpServers || cfg.servers || {};
    let s = servers[args.server];
    if (!s || !s.url) {
      // claude mcp add defaults to local scope: the entry lives under
      // projects.<dir>.mcpServers, not the top level. Search all projects.
      for (const [dir, proj] of Object.entries(cfg.projects || {})) {
        const cand = proj && proj.mcpServers && proj.mcpServers[args.server];
        if (cand && cand.url) { s = cand; process.stderr.write(`note: using "${args.server}" from project scope ${dir}\n`); break; }
      }
    }
    if (!s || !s.url) fail(`server "${args.server}" with a url not found in ${args.config}`);
    const auth = (s.headers && (s.headers.Authorization || s.headers.authorization)) || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) fail(`no Authorization header for "${args.server}" in ${args.config}`);
    return { url: s.url, token };
  }
  fail('need --endpoint or --config (see --help)');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  if (!args.scan || !args.post) fail('--scan and --post are required (see --help)');

  const scan = JSON.parse(readFileSync(args.scan, 'utf8'));
  const post = JSON.parse(readFileSync(args.post, 'utf8'));
  if (typeof post.page_url !== 'string' || !/^https?:\/\//.test(post.page_url)) fail('manifest page_url must be an http(s) URL');
  if (!Array.isArray(post.findings) || post.findings.length === 0) fail('manifest needs a non-empty findings[]');

  const byId = new Map((scan.candidates || []).map((c) => [c.id, c]));
  const findings = post.findings.map((f) => {
    const c = byId.get(f.id);
    if (!c) fail(`unknown candidate id ${JSON.stringify(f.id)} (not in ${args.scan})`);
    if (typeof f.body !== 'string' || !f.body.trim()) fail(`finding ${f.id}: body is required`);
    const hasConsole = Array.isArray(c.console) && c.console.length > 0;
    if (!c.screenshot_base64 && !hasConsole) fail(`candidate ${f.id} has no screenshot — HARD RULE 1 forbids posting it`);
    const out = { body: f.body, severity: f.severity || c.severity };
    if (hasConsole) {
      // Console findings are page-level: no screenshot, no DOM anchor. The
      // error lines themselves are the evidence — the server rejects mixing
      // `console` with selector/rect/pin/html.
      out.console = c.console;
      return out;
    }
    out.screenshot_base64 = c.screenshot_base64;
    if (c.selector) out.selector = c.selector;
    if (c.rect) out.rect = c.rect;
    if (!c.selector && c.pin) out.pin = c.pin; // anchor priority: selector → rect → pin
    if (c.html) out.html = c.html;
    return out;
  });

  const { url, token } = resolveEndpoint(args);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'create_comments', arguments: { page_url: post.page_url, findings } },
      }),
      signal: AbortSignal.timeout(args.timeout),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') fail(`request timed out after ${args.timeout}ms`);
    fail(e.cause ? `${e.message}: ${e.cause.message ?? e.cause}` : e.message);
  }
  let msg = null; let raw = '';
  try { raw = await res.text(); msg = JSON.parse(raw); } catch { /* handled below */ }
  if (!res.ok || !msg || msg.error) fail(`server error (HTTP ${res.status}): ${msg && msg.error ? msg.error.message : (raw.slice(0, 300) || 'empty response')}`);
  const text = msg.result && Array.isArray(msg.result.content)
    ? msg.result.content.map((c) => c.text).filter(Boolean).join('\n')
    : JSON.stringify(msg.result);
  process.stdout.write(text + '\n');
}

main().catch((e) => fail(e.cause ? `${e.message}: ${e.cause.message ?? e.cause}` : e.message));
