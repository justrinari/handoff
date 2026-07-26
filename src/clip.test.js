import { describe, it, expect } from "vitest";
import { CLIP, capFrames, shouldKeep, timeline, startClip } from "./clip.js";

// A fake CDP session: it records the commands, can "deliver" a frame and keeps its
// own clock — otherwise the sampling over time cannot be tested.
function fakeCdp() {
  const sent = [];
  const handlers = {};
  return {
    sent,
    send: (method, params) => { sent.push([method, params]); return Promise.resolve(); },
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, payload) => handlers[event]?.(payload),
  };
}

// A clock the test moves by hand: startClip reads time through it.
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms) => { t += ms; } };
}

describe("capFrames", () => {
  it("holds the ceiling when frames arrive in a burst", () => {
    const frames = Array.from({ length: 30 }, (_, i) => `f${i}`);
    expect(capFrames(frames, 12)).toHaveLength(12);
  });

  it("leaves a short clip alone", () => {
    expect(capFrames(["a", "b"], 12)).toEqual(["a", "b"]);
  });
});

describe("shouldKeep", () => {
  // 🔴 HARD-WON LESSON: limiting ONLY by frame count ate the budget in 0.2 s (a screen
  // emits up to 60 frames per second), and the clip cut off before reaching the target
  // — the press was not in it at all.
  it("takes the first frame and then thins out to the recorded rate", () => {
    expect(shouldKeep(0, null)).toBe(true);
    expect(shouldKeep(16, 0)).toBe(false);      // the next screen frame — too early
    expect(shouldKeep(125, 0)).toBe(true);      // 1/8 of a second has passed — take it
  });

  it("stops at the end of the window", () => {
    expect(shouldKeep(CLIP.MAX_MS + 1, 0)).toBe(false);
  });
});

describe("timeline", () => {
  it("stamps frames with seconds at the recorded rate", () => {
    expect(timeline(["a", "b", "c"], 8)).toEqual([
      { path: "a", t: 0 },
      { path: "b", t: 0.125 },
      { path: "c", t: 0.25 },
    ]);
  });
});

describe("startClip", () => {
  it("asks CDP for cheap JPEG frames and acks every one", async () => {
    const cdp = fakeCdp();
    const clip = await startClip(cdp, { now: fakeClock().now });
    expect(cdp.sent[0][0]).toBe("Page.startScreencast");
    expect(cdp.sent[0][1].format).toBe("jpeg");
    expect(cdp.sent[0][1].quality).toBe(CLIP.QUALITY);

    cdp.emit("Page.screencastFrame", { data: "AAAA", sessionId: 7 });
    // Without the ack the browser stops sending frames after the very first one.
    expect(cdp.sent.some(([m, p]) => m === "Page.screencastFrameAck" && p.sessionId === 7)).toBe(true);

    const frames = await clip.stop();
    expect(frames).toEqual([{ data: "AAAA", t: 0 }]);
    expect(cdp.sent.some(([m]) => m === "Page.stopScreencast")).toBe(true);
  });

  // The key property: a clip must cover the WHOLE recording window, not just its
  // first milliseconds, otherwise the press never makes it in.
  it("thins a 60-per-second flood down to the recorded rate", async () => {
    const cdp = fakeCdp();
    const clock = fakeClock();
    const clip = await startClip(cdp, { now: clock.now });
    for (let i = 0; i < 120; i++) {                    // two seconds at 60 frames
      cdp.emit("Page.screencastFrame", { data: `f${i}`, sessionId: i });
      clock.tick(16);
    }
    const frames = await clip.stop();
    expect(frames.length).toBeLessThanOrEqual(CLIP.MAX_FRAMES);
    expect(frames[0].t).toBe(0);
    // The last frame sits at the end of the recording window, not two tenths in.
    expect(frames[frames.length - 1].t).toBeGreaterThan(1);
  });

  it("stops collecting once the cap is reached", async () => {
    const cdp = fakeCdp();
    const clock = fakeClock();
    const clip = await startClip(cdp, { now: clock.now });
    for (let i = 0; i < CLIP.MAX_FRAMES + 5; i++) {
      cdp.emit("Page.screencastFrame", { data: `f${i}`, sessionId: i });
      clock.tick(125);
    }
    const frames = await clip.stop();
    expect(frames).toHaveLength(CLIP.MAX_FRAMES);
  });

  it("survives a browser that never sends a frame", async () => {
    const cdp = fakeCdp();
    const clip = await startClip(cdp);
    expect(await clip.stop()).toEqual([]);
  });
});
