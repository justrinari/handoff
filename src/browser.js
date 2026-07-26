import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectElements } from "./collect.js";

// By default we use a SEPARATE persistent profile: the agent stays out of the window
// a human is working in, and sessions (logins on a staging site) survive between
// runs. --attach connects to an already running browser with a debug port.
export const PROFILE_DIR = join(homedir(), ".handoff", "browser");
export const VIEWPORT = { width: 1280, height: 800 };

export async function openBrowser({ attach = null, headless = false } = {}) {
  if (attach) {
    const browser = await chromium.connectOverCDP(attach);
    const ctx = browser.contexts()[0] ?? (await browser.newContext({ viewport: VIEWPORT }));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize(VIEWPORT);
    return { page, close: () => browser.close() };
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",             // playwright-core ships no browser — we take the system Chrome
    headless,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,          // the rects and the frame pixels must match one to one
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { page, close: () => ctx.close() };
}

// A step snapshot: a clean frame + a geometry map + the action rect.
// Labels are NOT baked into the picture — the page draws them on top by these coordinates.
export async function captureStep(page, { actionSelector = null } = {}) {
  const png = await page.screenshot();
  // collectElements is self-contained, so it travels to the browser as it is.
  const elementMap = await page.evaluate(collectElements);
  let actionRect = null;
  if (actionSelector) {
    const box = await page.locator(actionSelector).first().boundingBox().catch(() => null);
    if (box) actionRect = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
  }
  return {
    png,
    elementMap,
    actionRect,
    url: page.url(),
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    devicePixelRatio: 1,
  };
}
