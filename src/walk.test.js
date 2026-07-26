import { describe, it, expect } from "vitest";
import { walkPlan } from "./walk.js";

// A fake page: it records what was done to it.
function fakePage(opts = {}) {
  const calls = [];
  return {
    calls,
    url: () => "http://localhost:3000/cart",
    goto: (u) => { calls.push(["goto", u]); return Promise.resolve(); },
    click: (s) => {
      calls.push(["click", s]);
      return opts.clickFails ? Promise.reject(new Error("selector not found")) : Promise.resolve();
    },
    fill: (s, t) => { calls.push(["fill", s, t]); return Promise.resolve(); },
    waitForSelector: (s) => { calls.push(["wait", s]); return Promise.resolve(); },
    waitForTimeout: () => Promise.resolve(),
    evaluate: (fn, arg) => { calls.push(["evaluate", fn.name || "anon", arg ?? null]); return Promise.resolve(); },
    // Actions go through locator(...).first(): on a live page a selector often finds
    // several elements, and Playwright's strict mode would fail.
    locator: (sel) => ({
      first: () => ({
        boundingBox: () => { calls.push(["box", sel]); return Promise.resolve({ x: 100, y: 40, width: 60, height: 24 }); },
        click: () => {
          calls.push(["click", sel]);
          if (opts.closedError) return Promise.reject(new Error("Target page, context or browser has been closed"));
          return opts.clickFails ? Promise.reject(new Error("selector not found")) : Promise.resolve();
        },
        fill: (t) => { calls.push(["fill", sel, t]); return Promise.resolve(); },
        waitFor: () => { calls.push(["wait", sel]); return Promise.resolve(); },
        scrollIntoViewIfNeeded: () => { calls.push(["scroll", sel]); return Promise.resolve(); },
      }),
    }),
    context: () => ({
      newCDPSession: () => opts.cdpFails
        ? Promise.reject(new Error("target closed"))
        : Promise.resolve(fakeCdpSession(calls)),
    }),
  };
}

function fakeCdpSession(calls) {
  return {
    send: (m) => { calls.push(["cdp", m]); return Promise.resolve(); },
    on: () => {},
  };
}

const capture = () => Promise.resolve({
  png: Buffer.from("x"), elementMap: [], actionRect: null,
  url: "http://localhost:3000/cart", viewport: "1280x800", devicePixelRatio: 1,
});

const plan = {
  title: "T", origin: "http://localhost:3000",
  steps: [
    { action: "open", target: "/cart", text: null, title: "Cart" },
    { action: "click", target: "button.pay", text: null, title: "Payment" },
    { action: "type", target: "input.promo", text: "SALE20", title: "Promo code" },
    { action: "check", target: ".total", text: null, title: "Total" },
  ],
};

describe("walkPlan", () => {
  it("performs each action against the page", async () => {
    const page = fakePage();
    await walkPlan(page, plan, { capture });
    // We only look at actions ON THE PAGE: the cursor and the clip recording also go
    // through `page`, but they have nothing to do with the scenario.
    const actions = new Set(["goto", "click", "fill", "wait"]);
    expect(page.calls.filter(([what]) => actions.has(what))).toEqual([
      ["goto", "http://localhost:3000/cart"],
      ["click", "button.pay"],
      ["fill", "input.promo", "SALE20"],
      ["wait", ".total"],
    ]);
  });

  it("returns one shot per step, in order, carrying the caption", async () => {
    const shots = await walkPlan(fakePage(), plan, { capture });
    expect(shots).toHaveLength(4);
    expect(shots.map((s) => s.title)).toEqual(["Cart", "Payment", "Promo code", "Total"]);
    expect(shots.every((s) => s.status === "ok")).toBe(true);
  });

  it("marks a step failed and keeps going — a broken step must not kill the run", async () => {
    const shots = await walkPlan(fakePage({ clickFails: true }), plan, { capture });
    expect(shots).toHaveLength(4);
    expect(shots[1].status).toBe("failed");
    expect(shots[1].failure).toMatch(/selector not found/);
    expect(shots[3].status).toBe("ok");
  });
});

describe("movement around an action", () => {
  it("puts the cursor up before recording and removes it before the clean frame", async () => {
    const page = fakePage();
    await walkPlan(page, { ...plan, steps: [plan.steps[1]] }, { capture });
    const seq = page.calls.map(([what, how]) => (what === "cdp" ? `cdp:${how}` : what === "evaluate" ? `ghost:${how}` : what));

    const iInstall = seq.indexOf("ghost:installGhost");
    const iStart = seq.indexOf("cdp:Page.startScreencast");
    const iClick = seq.indexOf("click");
    const iStop = seq.indexOf("cdp:Page.stopScreencast");
    const iRemove = seq.indexOf("ghost:removeGhost");

    expect(iInstall).toBeGreaterThanOrEqual(0);
    expect(iInstall).toBeLessThan(iStart);      // the cursor is in place when recording starts
    expect(iStart).toBeLessThan(iClick);        // the press made it into the clip
    expect(iClick).toBeLessThan(iStop);
    expect(iStop).toBeLessThan(iRemove);        // the cursor is removed after the recording…
  });

  it("draws no cursor on a navigation — there is no element to travel to", async () => {
    const page = fakePage();
    await walkPlan(page, { ...plan, steps: [plan.steps[0]] }, { capture });
    expect(page.calls.some(([w, h]) => w === "evaluate" && h === "moveGhost")).toBe(false);
  });

  // The ring reads as a press. On a check nobody presses anything, so a ring there
  // would lie: the cursor arrives to show where to look, and that is all.
  it("on a check the cursor travels but does not pulse", async () => {
    const page = fakePage();
    await walkPlan(page, { ...plan, steps: [plan.steps[3]] }, { capture });
    const ghosts = page.calls.filter(([w]) => w === "evaluate").map(([, how]) => how);
    expect(ghosts).toContain("moveGhost");
    expect(ghosts).not.toContain("pulseGhost");
  });

  it("a failed step leaves no cursor behind on the page", async () => {
    const page = fakePage({ clickFails: true });
    await walkPlan(page, { ...plan, steps: [plan.steps[1]] }, { capture });
    expect(page.calls.some(([w, h]) => w === "evaluate" && h === "removeGhost")).toBe(true);
  });

  // Feedback #9: the viewer does not play the clip — --no-clip skips recording it (faster).
  it("recordClip:false starts no screencast, the step is still shot", async () => {
    const page = fakePage();
    const shots = await walkPlan(page, { ...plan, steps: [plan.steps[1]] }, { capture, recordClip: false });
    expect(page.calls.some(([w, h]) => w === "cdp" && h === "Page.startScreencast")).toBe(false);
    expect(shots[0].status).toBe("ok");
    expect(shots[0].clipFrames).toEqual([]);
  });

  // A clip is decoration. If the recording did not start, the step is still sound and shot.
  it("a broken recording does not make the step a failure", async () => {
    const page = fakePage({ cdpFails: true });
    const shots = await walkPlan(page, { ...plan, steps: [plan.steps[1]] }, { capture });
    expect(shots[0].status).toBe("ok");
    expect(shots[0].clipFrames).toEqual([]);
    expect(page.calls.some(([w]) => w === "click")).toBe(true);
  });
});

// A frame is the viewport: a long reference page below the fold does not make it in.
describe("scrolling", () => {
  const scrollPlan = {
    title: "T", origin: "http://localhost:3000",
    steps: [{ action: "scroll", target: ".terms", text: null, title: "Terms" }],
  };

  it("scrolls to the target and takes a frame", async () => {
    const page = fakePage();
    const shots = await walkPlan(page, scrollPlan, { capture });
    expect(page.calls.some(([w, s]) => w === "scroll" && s === ".terms")).toBe(true);
    expect(shots[0].status).toBe("ok");
  });

  // At the start of a scroll the target is OFF screen — there is nothing for the
  // cursor to fly to; here the movement is shown by the page itself.
  it("does not send the cursor to something that is not visible yet", async () => {
    const page = fakePage();
    await walkPlan(page, scrollPlan, { capture });
    const ghosts = page.calls.filter(([w]) => w === "evaluate").map(([, h]) => h);
    expect(ghosts).not.toContain("moveGhost");
    expect(ghosts).not.toContain("pulseGhost");
  });
});

// Live feedback #2: `wait` lets the page finish loading, but takes NO frame.
describe("the wait action", () => {
  it("waits on a selector and adds NO frame to the walkthrough", async () => {
    const p = {
      title: "T", origin: "http://localhost:3000",
      steps: [
        { action: "open", target: "/", text: null, title: "Home" },
        { action: "wait", target: ".deal-card", text: null, title: null },
        { action: "check", target: ".x", text: null, title: "Check" },
      ],
    };
    const page = fakePage();
    const shots = await walkPlan(page, p, { capture });
    expect(shots.map((s) => s.action)).toEqual(["open", "check"]); // wait without a frame
    expect(page.calls.some(([w, s]) => w === "wait" && s === ".deal-card")).toBe(true);
  });

  it("wait <ms> — a blind pause, also without a frame", async () => {
    const p = { title: "T", origin: "http://x", steps: [{ action: "wait", target: "500", text: null, title: null }] };
    const shots = await walkPlan(fakePage(), p, { capture });
    expect(shots).toHaveLength(0);
  });
});

// Live feedback #11: the tab was closed by hand during the walkthrough — the rest of
// the steps would fail the same way, so we stop and give the person a clear reason.
describe("the window closed during a walkthrough", () => {
  it("marks the step with a hint and stops the walkthrough", async () => {
    const p = {
      title: "T", origin: "http://x",
      steps: [
        { action: "click", target: ".a", text: null, title: "A" },
        { action: "click", target: ".b", text: null, title: "B" },
      ],
    };
    const shots = await walkPlan(fakePage({ closedError: true }), p, { capture });
    expect(shots).toHaveLength(1); // we stopped after the first
    expect(shots[0].status).toBe("failed");
    expect(shots[0].failure).toMatch(/do not close the window/);
  });
});
