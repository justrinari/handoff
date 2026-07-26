// A clip around the action — with no codecs: CDP hands us a stream of JPEG frames and
// they sit in the bucket next to the still frames.
//
// They are still recorded and still uploaded, but NOTHING PLAYS THEM BACK any more: a
// real person rejected the flipbook wholesale ("flickers a lot"), so the viewer holds
// the still frame and animates a cursor toward the action instead — the reason is kept
// next to the code that replaced it, in web/walkthrough/src/data.js (`targetRect`).
// Hence --no-clip is sold as a free speed-up, and --local never records one at all.
//
// The numbers are deliberately far below the spec ones (3 s / 12 fps / 40 frames):
// the "arrived and pressed" movement reads in a second and a half, while 40 frames a
// step turn into tens of megabytes on a colleague's connection. Frame count is what
// drives that cost, which is why 40 became 12. To put it back, change these four numbers.
export const CLIP = {
  FPS: 8,
  MAX_FRAMES: 12,
  MAX_MS: 1600,
  QUALITY: 55,
};

// A ceiling just in case: the real thinning is done by sampling over time, but if the
// browser sends a burst of frames with identical timecodes, the limit saves us.
export function capFrames(frames, max = CLIP.MAX_FRAMES) {
  return frames.length <= max ? frames : frames.slice(0, max);
}

// The "do we keep this frame" decision: at least 1/FPS of a second must pass between
// neighbouring frames, and the whole clip must be no longer than MAX_MS.
//
// 🔴 HARD-WON LESSON: at first the frames were limited ONLY by their count. A screen
// emits up to 60 frames per second, so a limit of 12 was spent in 0.2 s — the clip cut
// off before reaching the target, and the press was not in it at all. What has to be
// counted is time, not arrival order.
export function shouldKeep(elapsedMs, lastKeptMs, { fps = CLIP.FPS, maxMs = CLIP.MAX_MS } = {}) {
  if (elapsedMs > maxMs) return false;
  if (lastKeptMs === null) return true;
  return elapsedMs - lastKeptMs >= 1000 / fps - 1;
}

export function timeline(paths, fps = CLIP.FPS) {
  return paths.map((path, i) => ({ path, t: Math.round((i / fps) * 1000) / 1000 }));
}

// `cdp` is a Playwright session (page.context().newCDPSession(page)) or its double.
// Returns frames as `{ data, t }`: `data` is base64 JPEG, `t` is seconds since the
// recording started. The time is REAL, not "index divided by fps": no surface plays
// the clip today, so nothing depends on it — but a recorded timecode is a measurement,
// and inventing an even one would bake a smoothness the recording never had into data
// that outlives this viewer.
export async function startClip(cdp, { viewport = { width: 1280, height: 800 }, now = () => Date.now() } = {}) {
  const frames = [];
  let started = null, lastKept = null;
  cdp.on("Page.screencastFrame", (ev) => {
    const at = now();
    if (started === null) started = at;
    const elapsed = at - started;
    if (frames.length < CLIP.MAX_FRAMES && shouldKeep(elapsed, lastKept)) {
      lastKept = elapsed;
      frames.push({ data: ev.data, t: Math.round(elapsed) / 1000 });
    }
    // The ack is mandatory: without it the browser goes quiet after the first frame.
    // The page may already have moved to another URL — the CDP session drops — but
    // that must not bring the walkthrough down, so we swallow the error silently.
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: CLIP.QUALITY,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  return {
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      return capFrames(frames);
    },
  };
}
