import { describe, it, expect } from "vitest";
import { parsePlan } from "./plan.js";

const PLAN = `---
title: New checkout
origin: http://localhost:3000
---

1. open /cart — Cart
2. click button.promo-apply — Apply the promo code
3. type input.promo "SALE20" — Enter the code
4. check .cart-total — Total recalculated
`;

describe("parsePlan", () => {
  it("reads title and origin from the front matter", () => {
    const p = parsePlan(PLAN);
    expect(p.title).toBe("New checkout");
    expect(p.origin).toBe("http://localhost:3000");
  });

  it("parses every step in order", () => {
    const p = parsePlan(PLAN);
    expect(p.steps).toHaveLength(4);
    expect(p.steps[0]).toEqual({ action: "open", target: "/cart", text: null, title: "Cart" });
    expect(p.steps[1]).toEqual({ action: "click", target: "button.promo-apply", text: null, title: "Apply the promo code" });
    expect(p.steps[2]).toEqual({ action: "type", target: "input.promo", text: "SALE20", title: "Enter the code" });
    expect(p.steps[3]).toEqual({ action: "check", target: ".cart-total", text: null, title: "Total recalculated" });
  });

  it("accepts a plain hyphen as the caption separator", () => {
    const p = parsePlan(`---\ntitle: T\norigin: http://x\n---\n1. open / - Home\n`);
    expect(p.steps[0].title).toBe("Home");
  });

  it("rejects a plan without origin", () => {
    expect(() => parsePlan(`---\ntitle: T\n---\n1. open / — Home\n`)).toThrow(/origin/);
  });

  it("rejects a plan without steps", () => {
    expect(() => parsePlan(`---\ntitle: T\norigin: http://x\n---\n`)).toThrow(/no steps/);
  });

  it("rejects an unknown action with the line number", () => {
    const bad = `---\ntitle: T\norigin: http://x\n---\n1. open / — Home\n2. swipe .x — Swipe\n`;
    expect(() => parsePlan(bad)).toThrow(/line 6.*swipe/);
  });

  it("requires a target for click", () => {
    const bad = `---\ntitle: T\norigin: http://x\n---\n1. click — Click\n`;
    expect(() => parsePlan(bad)).toThrow(/click/);
  });
});

// Found on the first live project (a Tailwind CRM): its buttons carry classes like
// `button.flex.items-center:nth-of-type(7)` — they drift with any markup change,
// while the stable selector is text-based and contains spaces.
describe("a target in single quotes", () => {
  it("parses a selector with spaces in it", () => {
    const plan = parsePlan(`---
origin: http://localhost:8000
---

1. click 'button:has-text("Advance the deal through stages")' — Picked the tour
`);
    expect(plan.steps[0].target).toBe('button:has-text("Advance the deal through stages")');
    expect(plan.steps[0].title).toBe("Picked the tour");
  });

  it("does not get in the way of the text for type — that one is in double quotes", () => {
    const plan = parsePlan(`---
origin: http://localhost:8000
---

1. type 'input[placeholder="Search by ID and name"]' "Sanders" — Found the deal
`);
    expect(plan.steps[0].target).toBe('input[placeholder="Search by ID and name"]');
    expect(plan.steps[0].text).toBe("Sanders");
  });

  it("still works for plain targets without any quotes", () => {
    const plan = parsePlan(`---
origin: http://localhost:8000
---

1. open /lm/funnels/2043817462115908377?view=kanban — Funnel
2. click button.fixed.bottom-6 — Help
`);
    expect(plan.steps[0].target).toBe("/lm/funnels/2043817462115908377?view=kanban");
    expect(plan.steps[1].target).toBe("button.fixed.bottom-6");
  });
});

describe("the scroll action", () => {
  it("parses as an ordinary step with a target", () => {
    const plan = parsePlan(`---
origin: http://localhost:8000
---

1. scroll '[role="dialog"] >> text=Deal is older than 3 weeks' — Scrolled to the group requirements
`);
    expect(plan.steps[0].action).toBe("scroll");
    expect(plan.steps[0].target).toBe('[role="dialog"] >> text=Deal is older than 3 weeks');
  });

  it("requires a target — scrolling to nowhere is meaningless", () => {
    expect(() => parsePlan(`---
origin: http://x
---

1. scroll — Somewhere
`)).toThrow(/needs a target/);
  });
});

// Live feedback #3: `check button:has-text("Create deal")` (a space in the target, no
// single quotes) used to fail to parse — the target is now taken whole, up to the dash.
describe("a target with spaces and NO quotes", () => {
  it("parses has-text with a space in it without single quotes", () => {
    const p = parsePlan(`---\norigin: http://x\n---\n1. check button:has-text("Create deal") — Creating a deal\n`);
    expect(p.steps[0].action).toBe("check");
    expect(p.steps[0].target).toBe('button:has-text("Create deal")');
    expect(p.steps[0].title).toBe("Creating a deal");
  });

  it("type with a spaced target and no single quotes, text in double quotes", () => {
    const p = parsePlan(`---\norigin: http://x\n---\n1. type input[placeholder="Search the requests"] "Sanders" — Searching\n`);
    expect(p.steps[0].target).toBe('input[placeholder="Search the requests"]');
    expect(p.steps[0].text).toBe("Sanders");
  });
});

// Live feedback #2: slow pages; `wait` waits, but takes NO frame.
describe("the wait action", () => {
  it("waits on a selector — a caption is not required", () => {
    const p = parsePlan(`---\norigin: http://x\n---\n1. wait .deal-card\n`);
    expect(p.steps[0]).toEqual({ action: "wait", target: ".deal-card", text: null, title: null });
  });

  it("waits on a number of ms", () => {
    const p = parsePlan(`---\norigin: http://x\n---\n1. wait 1500 — pause\n`);
    expect(p.steps[0].action).toBe("wait");
    expect(p.steps[0].target).toBe("1500");
  });

  it("requires a target", () => {
    expect(() => parsePlan(`---\norigin: http://x\n---\n1. wait\n`)).toThrow(/needs a target/);
  });
});
