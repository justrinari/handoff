// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { installGhost, moveGhost, pulseGhost, removeGhost, GHOST_HOST_ID } from "./cursor.js";

const host = () => document.getElementById(GHOST_HOST_ID);
const dot = () => host()?.shadowRoot?.querySelector(".dot");

beforeEach(() => {
  document.querySelectorAll(`#${GHOST_HOST_ID}`).forEach((n) => n.remove());
});

describe("installGhost", () => {
  it("lives in its own shadow root and lets clicks through", () => {
    installGhost();
    expect(host()).toBeTruthy();
    expect(host().shadowRoot).toBeTruthy();
    expect(host().style.pointerEvents).toBe("none");
    expect(dot()).toBeTruthy();
  });

  it("is idempotent — a second call does not add a second cursor", () => {
    installGhost();
    installGhost();
    expect(document.querySelectorAll(`#${GHOST_HOST_ID}`).length).toBe(1);
  });
});

describe("moveGhost", () => {
  // Arguments as ONE array: Playwright passes exactly one argument into the browser,
  // and every function signature in this module has to account for that.
  // The cursor travels by transform ONLY: left/top would make somebody else's page
  // recompute its layout eight times a second, right in the middle of recording.
  it("moves by transform, not by layout", () => {
    installGhost();
    moveGhost([120, 48, 500]);
    expect(dot().style.transform).toBe("translate3d(120px, 48px, 0)");
    // The transition is set whole: the travel is long, the fade-in is quick. With a
    // lone transitionDuration the cursor would spend half the clip as a translucent smudge.
    expect(dot().style.transition).toContain("transform 500ms");
    expect(dot().style.transition).toContain("opacity 120ms");
    expect(dot().style.left).toBe("");
    expect(dot().style.top).toBe("");
  });

  it("survives being called before install", () => {
    expect(() => moveGhost([10, 10, 300])).not.toThrow();
  });
});

describe("pulseGhost", () => {
  it("adds a ring that animates and cleans itself up", () => {
    installGhost();
    pulseGhost();
    const ring = host().shadowRoot.querySelector(".ring");
    expect(ring).toBeTruthy();
    expect(ring.style.opacity).toBe("1");
  });
});

describe("removeGhost", () => {
  // The frame must stay CLEAN: the labels on it are drawn by the walkthrough page,
  // not by the recording. A cursor in the picture is a label baked in forever.
  it("leaves no trace before the still frame is taken", () => {
    installGhost();
    removeGhost();
    expect(host()).toBe(null);
  });

  it("does not mind being called twice", () => {
    installGhost();
    removeGhost();
    expect(() => removeGhost()).not.toThrow();
  });
});
