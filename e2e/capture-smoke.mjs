// Smoke test: we record a fixture page and check that the frame, the element map and
// the button rect really do come out. No cloud, no database, no network.
//
// The page is e2e/fixture.html, INSIDE the package: this used to reach up into
// ../../web/landing/index.html, which is neither in the published tarball nor in this
// package's own repository — and which changed with the marketing copy, so the smoke
// measured that page as much as it measured the capture.
import { openBrowser, captureStep } from "../src/browser.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = "file://" + join(here, "fixture.html");

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "  ok" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
};

const { page, close } = await openBrowser({ headless: true });
try {
  await page.goto(fixture, { waitUntil: "networkidle" });
  const shot = await captureStep(page, { actionSelector: '[data-cta="record"]' });

  check("frame taken", shot.png.length > 10_000, `${Math.round(shot.png.length / 1024)} KB`);
  check("element map is not empty", shot.elementMap.length > 0, `${shot.elementMap.length} elements`);
  check("elements have a selector and a size",
    shot.elementMap.every((e) => e.selector && e.rect.w > 0 && e.rect.h > 0));
  check("action rect found", shot.actionRect !== null, JSON.stringify(shot.actionRect));
  check("rect is inside the frame",
    shot.actionRect && shot.actionRect.x >= 0 && shot.actionRect.x + shot.actionRect.w <= 1280);
  check("viewport recorded", shot.viewport === "1280x800");
} finally {
  await close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
