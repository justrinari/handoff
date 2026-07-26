// A thin client for the part-1 edge functions. `fetch` is passed as a parameter —
// that is how tests swap it out, and how it is taken from the environment in production.

import { timeline } from "./clip.js";

export function pngDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function uploadFrames(shots, cfg, fetchImpl = fetch) {
  const out = [];
  for (const shot of shots) {
    if (!shot.png) { out.push({ ...shot, screenshotPath: null }); continue; }
    const res = await fetchImpl(`${cfg.apiBase}/screenshot-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: pngDataUrl(shot.png) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`could not upload a frame: ${body.error ?? res.status}`);
    out.push({ ...shot, screenshotPath: body.path });
  }
  return out;
}

export function jpegDataUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

// Clip frames go through the same screenshot-upload as the still frames (it accepts
// JPEG). A clip is decoration — no viewer plays one back any more (see the header of
// clip.js), so if a frame fails to upload, the step keeps its still frame and the
// walkthrough does not fall over.
export async function uploadClips(shots, cfg, fetchImpl = fetch) {
  const out = [];
  for (const shot of shots) {
    const frames = shot.clipFrames ?? [];
    if (frames.length === 0) { out.push({ ...shot, clipPaths: [] }); continue; }
    const stamped = [];
    let broken = false;
    for (const frame of frames) {
      const res = await fetchImpl(`${cfg.apiBase}/screenshot-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
        body: JSON.stringify({ dataUrl: jpegDataUrl(frame.data) }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok || !body.path) { broken = true; break; }
      // A frame's timecode is REAL, taken while recording, and it is stored with the
      // frame even though nothing plays it back: a measurement kept as measured stays
      // usable later, an evened-out one is a fiction the data can never be talked out of.
      stamped.push({ path: body.path, t: frame.t });
    }
    // Older recordings may carry no timecodes — then we lay the frames out by rate.
    const complete = stamped.every((f) => typeof f.t === "number");
    out.push({ ...shot, clipPaths: broken ? [] : (complete ? stamped : timeline(stamped.map((f) => f.path))) });
  }
  return out;
}

export async function createDraft(payload, cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.apiBase}/walkthrough-create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not create the draft: ${body.error ?? res.status}`);
  return body;
}

// Publishing a draft with its summary — the same contract as the MCP publish_walkthrough
// (the server validates the summary: one item per step, all steps covered). The summary
// may be omitted — then we just publish; calling again updates the summary in place.
export async function publishWalkthrough(walkthroughId, summary, cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.apiBase}/walkthrough-publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
    body: JSON.stringify(summary === undefined ? { walkthroughId } : { walkthroughId, summary }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not publish: ${data.error ?? res.status}`);
  return data;
}

// The walkthroughs of this key (what is recorded, what is still a draft).
export async function listWalkthroughs(cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.apiBase}/walkthrough-list`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not fetch the list: ${data.error ?? res.status}`);
  return data.walkthroughs ?? [];
}

// Clean up the drafts of this key (published walkthroughs are untouched).
export async function pruneWalkthroughs(cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.apiBase}/walkthrough-prune`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not prune: ${data.error ?? res.status}`);
  return data.pruned ?? 0;
}

// Revoking a link: the only "stop" button for a walkthrough that has already been
// shared. Accepts the slug from the URL or the draft id — whichever is at hand.
export async function revokeWalkthrough(target, cfg, fetchImpl = fetch) {
  const body = /^wlk_/.test(target) ? { walkthroughId: target } : { slug: target };
  const res = await fetchImpl(`${cfg.apiBase}/walkthrough-revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.agentKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`could not revoke: ${data.error ?? res.status}`);
  return data;
}
