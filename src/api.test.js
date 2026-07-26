import { describe, it, expect, vi } from "vitest";
import { uploadFrames, uploadClips, createDraft, pngDataUrl, revokeWalkthrough, publishWalkthrough, listWalkthroughs, pruneWalkthroughs } from "./api.js";

const cfg = { apiBase: "http://api.test/functions/v1", agentKey: "fbt_key" };

describe("pngDataUrl", () => {
  it("wraps bytes the way screenshot-upload expects", () => {
    expect(pngDataUrl(Buffer.from([1, 2, 3]))).toBe("data:image/png;base64,AQID");
  });
});

describe("uploadFrames", () => {
  it("uploads every shot that has a frame and writes back the returned path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ path: "key/shot_9.png" }) });
    const shots = [{ png: Buffer.from([1]) }, { png: null, status: "failed" }];
    const out = await uploadFrames(shots, cfg, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);                 // a failed step has nothing to upload
    expect(out[0].screenshotPath).toBe("key/shot_9.png");
    expect(out[1].screenshotPath).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/functions/v1/screenshot-upload");
    expect(init.headers.Authorization).toBe("Bearer fbt_key");
  });

  it("surfaces an upload error instead of silently losing the frame", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
    await expect(uploadFrames([{ png: Buffer.from([1]) }], cfg, fetchMock)).rejects.toThrow(/boom/);
  });
});

describe("uploadClips", () => {
  it("uploads every frame and stamps it with a timecode", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(JSON.parse(init.body).dataUrl.slice(0, 23));
      return { ok: true, json: async () => ({ path: `p${seen.length}.jpg` }) };
    };
    const out = await uploadClips(
      // A frame arrives with its OWN recording timecode — that is what we carry on.
      [{ clipFrames: [{ data: "AAA", t: 0 }, { data: "BBB", t: 0.131 }] }],
      { apiBase: "http://api", agentKey: "k" },
      fetchImpl,
    );
    expect(seen[0]).toBe("data:image/jpeg;base64,");
    expect(out[0].clipPaths).toEqual([
      { path: "p1.jpg", t: 0 },
      { path: "p2.jpg", t: 0.131 },
    ]);
  });

  it("a step without a clip stays a step without a clip", async () => {
    const out = await uploadClips([{ clipFrames: [] }], { apiBase: "http://api", agentKey: "k" }, async () => {
      throw new Error("must not be called");
    });
    expect(out[0].clipPaths).toEqual([]);
  });

  // A clip is decoration, a walkthrough is not: we do not let one bad picture
  // bring down the whole recording.
  it("a failed frame drops the clip, not the walkthrough", async () => {
    const out = await uploadClips([{ clipFrames: [{ data: "AAA", t: 0 }] }], { apiBase: "http://api", agentKey: "k" }, async () => ({
      ok: false, json: async () => ({ error: "boom" }),
    }));
    expect(out[0].clipPaths).toEqual([]);
  });
});

describe("createDraft", () => {
  it("posts the payload and returns the draft ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ walkthroughId: "wlk_1", slug: "abcd", status: "draft" }),
    });
    const out = await createDraft({ title: "T" }, cfg, fetchMock);
    expect(out).toEqual({ walkthroughId: "wlk_1", slug: "abcd", status: "draft" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/functions/v1/walkthrough-create");
    expect(JSON.parse(init.body)).toEqual({ title: "T" });
  });

  it("reports the server's complaint verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: "summary 0: stepIdx must reference a step" }),
    });
    await expect(createDraft({}, cfg, fetchMock)).rejects.toThrow(/stepIdx must reference a step/);
  });
});

describe("revokeWalkthrough", () => {
  it("revokes by the slug from the address bar", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return { ok: true, json: async () => ({ ok: true, slug: "abcd1234" }) };
    };
    const out = await revokeWalkthrough("abcd1234", cfg, fetchImpl);
    expect(calls[0][0]).toBe("http://api.test/functions/v1/walkthrough-revoke");
    expect(calls[0][1]).toEqual({ slug: "abcd1234" });
    expect(out.ok).toBe(true);
  });

  it("revokes by the draft id when that is what it was given", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: true }) };
    };
    await revokeWalkthrough("wlk_1af8f5d134424451afed", cfg, fetchImpl);
    expect(calls[0]).toEqual({ walkthroughId: "wlk_1af8f5d134424451afed" });
  });

  it("says why it did not work", async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({ error: "Not found" }) });
    await expect(revokeWalkthrough("no-such-thing", cfg, fetchImpl)).rejects.toThrow(/Not found/);
  });
});

describe("publishWalkthrough", () => {
  it("sends walkthroughId + summary to walkthrough-publish", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return { ok: true, json: async () => ({ url: "https://w/?w=abc", slug: "abc" }) };
    };
    const summary = [{ stepIdx: 0, text: "a" }];
    const out = await publishWalkthrough("wlk_1", summary, cfg, fetchImpl);
    expect(calls[0][0]).toBe("http://api.test/functions/v1/walkthrough-publish");
    expect(calls[0][1]).toEqual({ walkthroughId: "wlk_1", summary });
    expect(out.url).toBe("https://w/?w=abc");
  });

  it("without a summary it sends the id only, not an empty summary key", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; };
    await publishWalkthrough("wlk_1", undefined, cfg, fetchImpl);
    expect(calls[0]).toEqual({ walkthroughId: "wlk_1" });
  });

  it("says why it did not work", async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({ error: "summary must cover every step" }) });
    await expect(publishWalkthrough("wlk_1", [], cfg, fetchImpl)).rejects.toThrow(/every step/);
  });
});

describe("listWalkthroughs / pruneWalkthroughs", () => {
  it("list returns an array of walkthroughs", async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ walkthroughs: [{ walkthroughId: "wlk_1", status: "draft" }] }) }; };
    const out = await listWalkthroughs(cfg, fetchImpl);
    expect(calls[0]).toBe("http://api.test/functions/v1/walkthrough-list");
    expect(out).toHaveLength(1);
  });

  it("prune returns how many were deleted", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ pruned: 3 }) });
    expect(await pruneWalkthroughs(cfg, fetchImpl)).toBe(3);
  });

  it("prune says why it did not work", async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({ error: "boom" }) });
    await expect(pruneWalkthroughs(cfg, fetchImpl)).rejects.toThrow(/boom/);
  });
});
