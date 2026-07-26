import { describe, it, expect } from "vitest";
import { buildPayload, ACTION_MAP } from "./payload.js";

const plan = { title: "New checkout", origin: "http://localhost:3000", steps: [] };

const shot = (over = {}) => ({
  url: "http://localhost:3000/cart",
  title: "Cart",
  action: "open",
  target: "/cart",
  screenshotPath: "key/shot_1.png",
  elementMap: [{ selector: "#pay", rect: { x: 1, y: 2, w: 3, h: 4 }, tag: "button", text: "Pay" }],
  actionRect: null,
  viewport: "1280x800",
  devicePixelRatio: 1,
  ...over,
});

describe("buildPayload", () => {
  it("carries the plan meta and git context", () => {
    const p = buildPayload(plan, [shot()], { branch: "feat/x", headSha: "abc1234", filesChanged: 7 });
    expect(p.title).toBe("New checkout");
    expect(p.origin).toBe("http://localhost:3000");
    expect(p.branch).toBe("feat/x");
    expect(p.headSha).toBe("abc1234");
    expect(p.filesChanged).toBe(7);
  });

  it("leaves summary empty — the agent fills it after looking at the frames", () => {
    const p = buildPayload(plan, [shot()], {});
    expect(p.summary).toEqual([]);
  });

  it("maps plan actions onto the API vocabulary", () => {
    expect(ACTION_MAP).toEqual({ open: "navigate", click: "click", type: "type", check: "assert", scroll: "scroll" });
    const p = buildPayload(plan, [shot({ action: "check", target: ".total" })], {});
    expect(p.steps[0].action.type).toBe("assert");
    expect(p.steps[0].action.selector).toBe(".total");
  });

  // For a navigation the target is a PATH, not a selector: put it in `selector` and a
  // click on the frame would look for an element called "/cart" on the page.
  it("never passes a navigation path off as a selector", () => {
    const p = buildPayload(plan, [shot({ action: "open", target: "/cart" })], {});
    expect(p.steps[0].action.type).toBe("navigate");
    expect(p.steps[0].action.selector).toBeUndefined();
  });

  it("keeps the action rect when the step had one", () => {
    const rect = { x: 96, y: 44, w: 78, h: 26 };
    const p = buildPayload(plan, [shot({ action: "click", target: "button.pay", actionRect: rect, label: "Pay" })], {});
    expect(p.steps[0].action).toEqual({ type: "click", selector: "button.pay", label: "Pay", rect });
  });

  it("passes the clip through to the draft", () => {
    const out = buildPayload(
      { origin: "http://localhost:3000", title: "T" },
      [{ url: "http://localhost:3000/cart", title: "Cart", action: "click", target: "button.pay",
         clipPaths: [{ path: "a.jpg", t: 0 }, { path: "b.jpg", t: 0.125 }] }],
    );
    expect(out.steps[0].clipFrames).toEqual([{ path: "a.jpg", t: 0 }, { path: "b.jpg", t: 0.125 }]);
  });

  it("a step without a clip sends an empty list, not undefined", () => {
    const out = buildPayload({ origin: "http://x", title: "T" }, [{ url: "http://x/", title: "A", action: "open" }]);
    expect(out.steps[0].clipFrames).toEqual([]);
  });

  it("passes a failed step through with its reason and no frame", () => {
    const p = buildPayload(plan, [shot({ status: "failed", failure: "selector not found", screenshotPath: null })], {});
    expect(p.steps[0].status).toBe("failed");
    expect(p.steps[0].failure).toBe("selector not found");
    expect(p.steps[0].screenshotPath).toBeNull();
  });
});

// The walkthrough's identity is the plan file, not the title: titles get edited, and a
// re-shoot still has to supersede the walkthrough shot from the same plan.
describe("planKey", () => {
  it("travels in the request body when the plan name is known", () => {
    const out = buildPayload({ ...plan, planKey: "help" }, [shot()], {});
    expect(out.planKey).toBe("help");
  });

  it("without a plan name it goes out empty, not as junk", () => {
    const out = buildPayload(plan, [shot()], {});
    expect(out.planKey).toBeNull();
  });
});
