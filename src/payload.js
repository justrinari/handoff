// The request body for walkthrough-create. The CLI is responsible for the mechanics,
// so the summary stays EMPTY: the agent writes it looking at its own diff and at the
// recorded frames — and only the agent can honour the rule "every item must reference
// a step".

export const ACTION_MAP = { open: "navigate", click: "click", type: "type", check: "assert", scroll: "scroll" };

export function buildPayload(plan, shots, git = {}) {
  return {
    origin: plan.origin,
    title: plan.title,
    // The walkthrough's identity: the plan file name. The title may be rewritten as
    // often as you like — this is what lets a re-shoot supersede the previous
    // walkthrough recorded from the same plan, instead of piling up beside it.
    planKey: plan.planKey ?? null,
    branch: git.branch ?? null,
    baseSha: git.baseSha ?? null,
    headSha: git.headSha ?? null,
    filesChanged: git.filesChanged ?? null,
    summary: [],
    steps: shots.map((s) => ({
      url: s.url,
      title: s.title,
      note: s.note ?? null,
      screenshotPath: s.screenshotPath ?? null,
      action: {
        type: ACTION_MAP[s.action] ?? "assert",
        // For a navigation the target is a page path, not an element: it has no selector.
        selector: s.action === "open" ? undefined : (s.target ?? undefined),
        label: s.label ?? undefined,
        rect: s.actionRect ?? null,
      },
      elementMap: s.elementMap ?? [],
      clipFrames: s.clipPaths ?? [],
      viewport: s.viewport ?? null,
      devicePixelRatio: s.devicePixelRatio ?? null,
      status: s.status ?? "ok",
      failure: s.failure ?? null,
    })),
  };
}
