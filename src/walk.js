import { captureStep } from "./browser.js";
import { installGhost, moveGhost, pulseGhost, removeGhost } from "./cursor.js";
import { startClip } from "./clip.js";

// Pause after an action: give the page time to reach its new state, otherwise we
// take an "in between" frame with a half-applied animation.
const SETTLE_MS = 400;
// How long the cursor travels to its target. Less and the movement does not read;
// more and the clip runs out of frames without having shown anything.
const TRAVEL_MS = 400;
// Upper bound on waiting for network idle after a step. An SPA pulls data over XHR
// AFTER the initial load, and `networkidle` at goto time fires in the "quiet window"
// before the deferred request starts — so we wait for idle once more, after the
// action. This never fails a walkthrough: on timeout we simply move on.
const NETIDLE_MS = 8000;
// DOM stabilisation: the XHR has landed, but React is still repainting. We wait until
// the markup size stops changing across two samples in a row, under an overall cap.
const DOM_SAMPLES = 8;
const DOM_GAP_MS = 150;

export async function walkPlan(page, plan, { capture = captureStep, settle = SETTLE_MS, recordClip = true } = {}) {
  const shots = [];
  for (const step of plan.steps) {
    // `wait` only waits — NO frame is taken (slow pages need a chance to finish
    // loading without a parasitic frame of a spinner). It never enters the walkthrough.
    if (step.action === "wait") {
      await doWait(page, step);
      continue;
    }

    let status = "ok", failure = null, clipFrames = [];
    // The cursor only travels where a human would really point. A navigation
    // (`open`) has no target on screen, and a scroll target is still OFF screen —
    // the cursor would fly into nothing; there the movement is shown by the page itself.
    const withCursor = ["click", "type", "check"].includes(step.action) && Boolean(step.target);
    // The ring reads as a press. On a check (`check`) nobody presses anything, so a
    // ring there would lie: the cursor arrives to show where to look, and no more.
    const withPress = withCursor && step.action !== "check";
    let clip = null;

    // The clip and the cursor are DECORATION, and their failure has no right to
    // spoil a step: if the recording did not start, the step is still shot as a still frame.
    try {
      if (withCursor) await page.evaluate(installGhost);
      // The clip (screencast) is decoration THE VIEWER DOES NOT PLAY: it animates the
      // cursor itself, synthetically, from the coordinates recorded with the step.
      // --no-clip skips it: faster, and no CPU burnt on somebody else's page.
      clip = recordClip ? await startClip(await page.context().newCDPSession(page)) : null;
      if (withCursor) {
        const box = await page.locator(step.target).first().boundingBox().catch(() => null);
        if (box) {
          await page.evaluate(moveGhost, [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), TRAVEL_MS]);
          await page.waitForTimeout(TRAVEL_MS);
          if (withPress) await page.evaluate(pulseGhost);
        }
      }
    } catch {
      clip = null;
    }

    let aborted = false;
    try {
      await perform(page, plan, step);
      await settleAfter(page, settle);
    } catch (e) {
      // A failed step does not bring down the walkthrough: the rest are still shot,
      // and the author sees the reason in the draft and decides. The exception is a
      // window that is gone: the remaining steps would fail the same way, so we stop
      // and give the person one clear reason instead of five identical
      // "page has been closed" lines.
      status = "failed";
      const msg = e instanceof Error ? e.message : String(e);
      if (/has been closed|target (page|closed)|browser has been closed/i.test(msg)) {
        failure = `the target tab/window was closed during the walkthrough — do not close the window the recorder is attached to (${msg})`;
        aborted = true;
      } else {
        failure = msg;
      }
    }

    // The recording and the cursor are torn down ALWAYS, even if the step failed:
    // otherwise the ghost stays in the next step's frame and the screencast keeps
    // burning CPU. The cleanup is wrapped whole: on a closed page the call may throw
    // synchronously, before returning a promise, and then .catch() is useless and the
    // walkthrough dies because of decoration — exactly what must never break anything.
    try {
      if (clip) clipFrames = await clip.stop();
      await page.evaluate(removeGhost);
    } catch {
      // Frames already recorded are kept: if it broke while removing the cursor, the clip is intact.
    }

    const shot = status === "ok"
      ? await capture(page, { actionSelector: step.action === "open" ? null : step.target })
      : { png: null, elementMap: [], actionRect: null, url: page.url(), viewport: null, devicePixelRatio: null };

    shots.push({
      ...shot,
      clipFrames,
      title: step.title,
      action: step.action,
      target: step.target,
      label: step.text ?? step.title,
      status,
      failure,
    });

    if (aborted) break; // the window is gone — there is nothing left to shoot
  }
  return shots;
}

// Wait until the page reaches a steady state after an action: network idle (again —
// after the deferred XHR) + DOM stabilisation + the base pause. Every wait is
// best-effort: if it times out, we move on.
async function settleAfter(page, settle) {
  if (page.waitForLoadState) {
    await page.waitForLoadState("networkidle", { timeout: NETIDLE_MS }).catch(() => {});
  }
  await domStable(page).catch(() => {});
  await page.waitForTimeout(settle);
}

// The DOM has "settled" = the markup size did not change across two samples in a row.
// Cheap and sufficient: it catches the XHR render that lands after networkidle.
async function domStable(page) {
  let prev = null;
  for (let i = 0; i < DOM_SAMPLES; i++) {
    const sig = await page.evaluate(() => document.documentElement.outerHTML.length).catch(() => null);
    if (typeof sig === "number" && sig === prev) return; // two identical in a row — settled
    prev = sig;
    await page.waitForTimeout(DOM_GAP_MS);
  }
}

// `wait <selector>` — wait for an element to appear (no frame taken). `wait <ms>` —
// a blind pause. Best-effort: if it never arrives we do not fail the walkthrough, the
// next step is shot as-is and the author sees from the frame that it was too early.
async function doWait(page, step) {
  const t = String(step.target ?? "").trim();
  if (/^\d+$/.test(t)) {
    await page.waitForTimeout(Number(t));
    return;
  }
  await page.locator(t).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
}

// Always the FIRST match. In strict mode Playwright fails when a selector finds more
// than one element, and on a live page that happens: a "Next" button exists both in
// the tour and in a hidden dialog next to it. Capturing the rect already takes
// first() — same here, otherwise the step would fail on ambiguity.
async function perform(page, plan, step) {
  switch (step.action) {
    case "open":
      return page.goto(absolute(plan.origin, step.target), { waitUntil: "networkidle" });
    case "click":
      return page.locator(step.target).first().click();
    case "type":
      return page.locator(step.target).first().fill(step.text ?? "");
    case "check":
      return page.locator(step.target).first().waitFor({ state: "visible" });
    // A frame is the viewport, not the whole page: anything below the fold does not
    // make it in. Scrolling to an element is the only way to show a long reference
    // page or form in full without cutting it into pieces.
    case "scroll":
      return page.locator(step.target).first().scrollIntoViewIfNeeded();
    default:
      throw new Error(`unknown action "${step.action}"`);
  }
}

function absolute(origin, target) {
  return /^https?:\/\//.test(target) ? target : origin.replace(/\/$/, "") + target;
}
