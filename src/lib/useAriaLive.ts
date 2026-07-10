/**
 * Screen reader announcement utility.
 *
 * Creates a polite aria-live region that screen readers will announce.
 * Use `announce()` to push a message; duplicate messages within 1s are
 * suppressed to avoid stuttering.
 *
 * The region is created once and appended to <body>. It is visually hidden
 * but readable by assistive technology.
 */

let region: HTMLElement | null = null;
let lastMessage = "";
let lastTime = 0;

function ensureRegion(): HTMLElement {
  if (region && document.body.contains(region)) return region;
  const el = document.createElement("div");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
  document.body.appendChild(el);
  region = el;
  return el;
}

export function announce(message: string): void {
  if (typeof document === "undefined") return;
  const now = Date.now();
  if (message === lastMessage && now - lastTime < 1000) return;
  lastMessage = message;
  lastTime = now;
  const el = ensureRegion();
  // Toggle text to force re-announcement of identical strings.
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}

export function announceAssertive(message: string): void {
  if (typeof document === "undefined") return;
  const now = Date.now();
  if (message === lastMessage && now - lastTime < 1000) return;
  lastMessage = message;
  lastTime = now;
  const el = ensureRegion();
  el.setAttribute("aria-live", "assertive");
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = message;
    // Revert to polite after the assertive announcement.
    setTimeout(() => el.setAttribute("aria-live", "polite"), 100);
  });
}