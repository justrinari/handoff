import { describe, it, expect } from "vitest";
import { renderLocalHtml, formatBytes, failedTally, ATTACH_LIMIT_BYTES } from "./local.js";

const shots = [
  { title: "Open the pricing page", url: "http://localhost:3000/pricing", status: "ok", png: Buffer.from("first"), failure: null },
  { title: "Pick the Pro plan", url: "http://localhost:3000/pricing", status: "ok", png: Buffer.from("second"), failure: null },
];

describe("renderLocalHtml", () => {
  it("returns one self-contained document with a frame per step", () => {
    const html = renderLocalHtml({ title: "Checkout flow" }, shots);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("Open the pricing page");
    expect(html).toContain("Pick the Pro plan");
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(html).toContain(Buffer.from("first").toString("base64"));
  });

  it("makes no network requests — no external src or href", () => {
    const html = renderLocalHtml({ title: "Checkout flow" }, shots);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("keeps a failed step visible instead of dropping it", () => {
    const withFailure = [...shots, { title: "Submit", url: "http://localhost:3000/pay", status: "failed", png: null, failure: "selector not found" }];
    const html = renderLocalHtml({ title: "Checkout flow" }, withFailure);
    expect(html).toContain("Submit");
    expect(html).toContain("selector not found");
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(2);
  });

  it("escapes step titles so a page title cannot inject markup", () => {
    const nasty = [{ title: '<img src=x onerror="alert(1)">', url: "http://localhost:3000/", status: "ok", png: Buffer.from("x"), failure: null }];
    const html = renderLocalHtml({ title: "T" }, nasty);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  // Quick Look, attachment previews and html-to-pdf converters render with scripting
  // OFF. The first step has to be on screen from the markup alone, or the file this
  // package promises you can "just double-click" opens blank.
  it("shows the first step from the markup alone, with no script executed", () => {
    const html = renderLocalHtml({ title: "Checkout flow" }, shots);
    expect(html.match(/class="frame on"/g)).toHaveLength(1);
    // Buttons only — the stylesheet legitimately mentions the same attribute.
    expect(html.match(/<button[^>]*aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("1 / 2");
    // The visible one is the FIRST step, not whichever section happened to be last.
    const shown = html.slice(html.indexOf('class="frame on"'), html.indexOf("<img"));
    expect(shown).toContain("Open the pricing page");
    expect(shown).not.toContain("Pick the Pro plan");
  });

  // The step list and the panel must not hold two different opinions about what
  // "failed" means, or a step reads fine in the list and broken in the panel.
  it("marks a step failed in the list and in the panel from the same rule", () => {
    for (const png of [null, Buffer.alloc(0)]) {
      const html = renderLocalHtml({ title: "T" }, [{ title: "Submit", url: "http://x/", status: "ok", png, failure: "no frame" }]);
      expect(html).toContain("This step did not complete");
      expect(html).toMatch(/<button[^>]+class="bad"/);
      // An empty buffer must not become an empty data: URI (a broken-image icon).
      expect(html).not.toContain("data:image/png;base64,");
    }
  });

  it("escapes the url and the failure text, not just the title", () => {
    const nasty = [{
      title: "Step",
      url: 'http://x/"><script>alert(1)</script>',
      status: "failed",
      png: null,
      failure: '<b onmouseover="alert(2)">boom</b>',
    }];
    const html = renderLocalHtml({ title: "T" }, nasty);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain('<b onmouseover=');
    expect(html).toContain("&lt;script&gt;alert(1)");
    expect(html).toContain("&lt;b onmouseover=&quot;alert(2)&quot;&gt;boom");
  });

  it("explains itself when the walkthrough recorded no steps", () => {
    const html = renderLocalHtml({ title: "Checkout flow" }, []);
    expect(html).toContain("No steps were recorded");
    expect(html).not.toContain("1 / 0");
  });
});

// The size is not trivia: the file is meant to be sent, and inlined frames make it
// grow with the step count until it stops fitting into an email.
describe("file size", () => {
  it("reads as KB below a megabyte and MB above it", () => {
    expect(formatBytes(0)).toBe("1 KB");          // never "0 KB": a written file is not empty
    expect(formatBytes(400 * 1024)).toBe("400 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.75 * 1024 * 1024)).toBe("3.8 MB");
  });

  // The unit has to roll before the number reaches its own limit, or the size reads
  // like a bug: "1024 KB" is a megabyte spelled wrong.
  it("rolls to MB before the kilobytes reach 1024", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.0 MB");
    expect(formatBytes(1023 * 1024)).toBe("1023 KB");
  });

  it("puts the warning threshold at the 25 MB attachment limit", () => {
    expect(ATTACH_LIMIT_BYTES).toBe(26214400);
    expect(formatBytes(ATTACH_LIMIT_BYTES)).toBe("25.0 MB");
  });

  // A file one byte over the limit must not print the limit back at the reader:
  // "25.0 MB is over the 25 MB limit" reads as a bug in the tool, not as advice.
  it("never prints a size that reads as under the limit it just exceeded", () => {
    expect(formatBytes(ATTACH_LIMIT_BYTES + 1)).toBe("25.1 MB");
  });
});

// The line the run prints instead of "open it in a browser" when steps were lost. It
// is the only place a --local run says how bad the damage was, and it is written for
// somebody who has not yet opened the file.
describe("the failed-step tally", () => {
  it("counts the losses against the whole capture", () => {
    expect(failedTally(1, 6)).toBe("1 of 6 steps failed");
    expect(failedTally(5, 6)).toBe("5 of 6 steps failed");
  });

  // A total loss is the branch that matters: the file holds no screenshots at all, and
  // "6 of 6 steps failed" sends the reader looking for the survivors there aren't any.
  it("says a total loss in words rather than counting to itself", () => {
    expect(failedTally(6, 6)).toBe("every step failed");
    expect(failedTally(1, 1)).toBe("every step failed");
  });
});
