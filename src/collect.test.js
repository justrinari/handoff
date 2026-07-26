// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { collectElements } from "./collect.js";

// jsdom does not compute layout, so we set the geometry explicitly.
function withRect(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

describe("collectElements", () => {
  it("collects interactive and text elements with their geometry", () => {
    document.body.innerHTML = `<button id="pay">Pay</button><p id="note">Total 4200</p>`;
    withRect(document.querySelector("#pay"), 96, 44, 78, 26);
    withRect(document.querySelector("#note"), 20, 120, 300, 20);

    const out = collectElements();
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      selector: "#pay", tag: "button", text: "Pay",
      rect: { x: 96, y: 44, w: 78, h: 26 },
    });
  });

  it("prefers an id, then tag with up to two classes", () => {
    document.body.innerHTML = `<button class="btn btn-primary extra">Pay</button>`;
    withRect(document.querySelector("button"), 0, 0, 80, 30);
    expect(collectElements()[0].selector).toBe("button.btn.btn-primary");
  });

  it("disambiguates siblings with nth-of-type", () => {
    document.body.innerHTML = `<a class="x">1</a><a class="x">2</a>`;
    document.querySelectorAll("a").forEach((a, i) => withRect(a, 0, i * 40, 80, 30));
    expect(collectElements().map((e) => e.selector)).toEqual(["a.x:nth-of-type(1)", "a.x:nth-of-type(2)"]);
  });

  it("skips invisible slivers and anything scrolled out of the frame", () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button><button id="c">C</button>`;
    withRect(document.querySelector("#a"), 0, 0, 3, 3);        // too small
    withRect(document.querySelector("#b"), 0, 2000, 80, 30);   // below the frame
    withRect(document.querySelector("#c"), 10, 10, 80, 30);    // just right
    expect(collectElements().map((e) => e.selector)).toEqual(["#c"]);
  });

  it("trims long text", () => {
    document.body.innerHTML = `<p id="t">${"a".repeat(120)}</p>`;
    withRect(document.querySelector("#t"), 0, 0, 300, 40);
    expect(collectElements()[0].text.length).toBe(60);
  });

  // A colleague pokes at an icon or a badge as often as at a button. Miss those and
  // they get "element not recognised" instead of a selector.
  it("covers visual atoms and anything marked with a role or label", () => {
    document.body.innerHTML = `
      <span id="badge">Free beta</span>
      <svg id="icon"></svg>
      <code id="cmd">npm i</code>
      <div id="tab" role="tab">For developers</div>
      <div id="close" aria-label="Close"></div>`;
    for (const id of ["#badge", "#icon", "#cmd", "#tab", "#close"]) {
      withRect(document.querySelector(id), 10, 10, 60, 24);
    }
    expect(collectElements().map((e) => e.selector).sort())
      .toEqual(["#badge", "#close", "#cmd", "#icon", "#tab"]);
  });

  // Wrappers are left out: the "smallest under the point" rule returns the contents
  // anyway, and an extra div would only litter the map.
  it("leaves plain wrappers out", () => {
    document.body.innerHTML = `<div id="wrap"><button id="go">Next</button></div>`;
    withRect(document.querySelector("#wrap"), 0, 0, 400, 200);
    withRect(document.querySelector("#go"), 10, 10, 80, 30);
    expect(collectElements().map((e) => e.selector)).toEqual(["#go"]);
  });

  // An element that matches several rules at once (a link with a role) must land in
  // the map exactly once, otherwise the hit test argues with itself.
  it("never lists the same element twice", () => {
    document.body.innerHTML = `<a id="cta" role="button" aria-label="Install">Install</a>`;
    withRect(document.querySelector("#cta"), 0, 0, 120, 40);
    expect(collectElements()).toHaveLength(1);
  });
});

// 🔴 HARD-WON LESSON, found on a live Tailwind application (CRM2.0, 2026-07-22): classes like
// `group/menu-item`, `hover:bg-x`, `w-1/2` are everyday, and in a selector their
// characters mean something else. querySelectorAll used to throw on the first such
// element and the frame map was not collected AT ALL: the step went down as a failure.
describe("Tailwind classes do not break the frame map", () => {
  it("escapes slashes and colons in classes", () => {
    document.body.innerHTML = `<button class="group/menu-item hover:bg-blue-500">Menu</button>`;
    const el = document.querySelector("button");
    withRect(el, 10, 10, 80, 30);

    const out = collectElements();
    expect(out).toHaveLength(1);
    // The selector must WORK: it has to find the same element back.
    expect(() => document.querySelector(out[0].selector)).not.toThrow();
    expect(document.querySelector(out[0].selector)).toBe(el);
  });

  it("does not lose the map over one odd element", () => {
    document.body.innerHTML =
      `<button class="w-1/2">Half</button><p class="ok">Text</p>`;
    withRect(document.querySelector("button"), 10, 10, 80, 30);
    withRect(document.querySelector("p"), 10, 60, 200, 20);

    const out = collectElements();
    expect(out).toHaveLength(2);                       // both collected, not zero
    expect(out.every((e) => e.selector.length > 0)).toBe(true);
  });
});
