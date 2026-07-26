// The ghost cursor: it is visible in the clip because it lives on the page being
// recorded, rather than being drawn over the picture afterwards.
//
// IMPORTANT: every function here must be SELF-CONTAINED — Playwright serialises its
// source and runs it in the browser, where there are no imports and no module
// constants. So the host identifier is duplicated as a string inside each function,
// and the shared state lives in the DOM itself.
//
// Rules for working on top of somebody else's page (memory overlay-on-hostile-page-rules):
// our own shadow root, pointer-events:none, animate transform/opacity only.
export const GHOST_HOST_ID = "__ft_ghost_cursor__";

export function installGhost() {
  const ID = "__ft_ghost_cursor__";
  if (document.getElementById(ID)) return;
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .dot{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;
        border-radius:50%;background:rgba(15,27,51,.92);border:2px solid #fff;
        box-shadow:0 2px 8px rgba(15,27,51,.4);opacity:0;
        transition:transform 400ms cubic-bezier(.22,.61,.36,1), opacity 160ms linear}
      .ring{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;
        border-radius:50%;border:2px solid #F5A524;opacity:0;
        transition:transform 420ms ease-out, opacity 420ms ease-out}
    </style>
    <div class="ring"></div><div class="dot"></div>`;
  document.documentElement.appendChild(host);
}

// The arguments arrive as ONE array: page.evaluate passes exactly one argument into
// the browser, and it has to be unpacked here, not on the calling side.
export function moveGhost([x, y, ms]) {
  const host = document.getElementById("__ft_ghost_cursor__");
  if (!host) return;
  for (const el of host.shadowRoot.querySelectorAll(".dot,.ring")) {
    // We set the whole transition, not just its duration: a lone `transitionDuration`
    // would stretch the fade-in to the same length, and the cursor would spend half
    // the clip as a translucent smudge. The fade-in is quick, the travel is long.
    el.style.transition = `transform ${ms}ms cubic-bezier(.22,.61,.36,1), opacity 120ms linear`;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  host.shadowRoot.querySelector(".dot").style.opacity = "1";
}

export function pulseGhost() {
  const host = document.getElementById("__ft_ghost_cursor__");
  if (!host) return;
  const dot = host.shadowRoot.querySelector(".dot");
  const ring = host.shadowRoot.querySelector(".ring");
  // The ring expands from the very point the cursor stands on: we take its transform
  // and add a scale to it.
  const at = dot.style.transform;
  ring.style.transitionDuration = "0ms";
  ring.style.transform = at;
  ring.style.opacity = "1";
  // jsdom (the test environment) does not always provide requestAnimationFrame — the
  // timeout fallback does not change the meaning: what matters is that the transition
  // to the next frame happens AFTER the ring's starting state has been applied.
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
  raf(() => {
    ring.style.transitionDuration = "420ms";
    ring.style.transform = `${at} scale(2.6)`;
    ring.style.opacity = "0";
  });
}

export function removeGhost() {
  const host = document.getElementById("__ft_ghost_cursor__");
  if (host) host.remove();
}
