/**
 * Themed hover/focus tooltips for every element with a `title` attribute.
 *
 * Native `title` tooltips take ~1 s to appear, ignore the app theme and font,
 * and never show for keyboard focus. Instead of rewriting a hundred call sites,
 * one delegated listener picks up any `[title]` element and shows a styled
 * tooltip (`.lx-tooltip` in styles.css) after a short delay; once one tooltip
 * has been seen, neighbours appear instantly ("warm" mode, like macOS/VS Code).
 *
 * While the custom tooltip is visible the element's `title` is parked in
 * `data-lx-title` so the native one doesn't double up; it is put back as soon
 * as the pointer leaves, the element is pressed, or the page scrolls. The
 * attribute is therefore present whenever nobody is looking at a tooltip,
 * which keeps `getByTitle` / `[title=…]` selectors and React's own updates of
 * the attribute working.
 *
 * Placement: below the target by default, flipped above when there is no room;
 * elements inside the vertical nav rail get it on the right. Any ancestor can
 * override with `data-tip-side="top" | "bottom" | "right"`. Always clamped to
 * the viewport. Elements marked `data-native-title` keep the browser popup.
 */

export type TooltipSide = "bottom" | "top" | "right";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP = 6;
const MARGIN = 6;

/** Pure placement maths (unit-tested): where to put a `tip`-sized box next to `target`. */
export function placeTooltip(
  target: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: TooltipSide = "bottom",
): { left: number; top: number; side: TooltipSide } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  if (preferred === "right") {
    const left = target.left + target.width + GAP;
    if (left + tip.width + MARGIN <= viewport.width) {
      const top = clamp(target.top + target.height / 2 - tip.height / 2, MARGIN, viewport.height - tip.height - MARGIN);
      return { left, top, side: "right" };
    }
    // No room on the right: fall through to below/above.
  }
  const left = clamp(target.left + target.width / 2 - tip.width / 2, MARGIN, viewport.width - tip.width - MARGIN);
  const below = target.top + target.height + GAP;
  const above = target.top - GAP - tip.height;
  const fitsBelow = below + tip.height + MARGIN <= viewport.height;
  const fitsAbove = above >= MARGIN;
  const side: TooltipSide = preferred === "top" ? (fitsAbove || !fitsBelow ? "top" : "bottom") : fitsBelow || !fitsAbove ? "bottom" : "top";
  const top = clamp(side === "bottom" ? below : above, MARGIN, viewport.height - tip.height - MARGIN);
  return { left, top, side };
}

const SHOW_DELAY_MS = 450;
const WARM_WINDOW_MS = 700;
const TIP_ID = "lx-tooltip";

/** Install the delegated tooltip handlers on `doc`. Returns an uninstaller. */
export function installTooltips(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};

  let tipEl: HTMLDivElement | null = null;
  let target: HTMLElement | null = null; // element under the pointer/focus
  let shown: HTMLElement | null = null; // element whose title is parked
  let timer: number | null = null;
  let lastHiddenAt = 0;
  let pressed: HTMLElement | null = null; // no tooltip again until the pointer leaves it

  const ensureTip = () => {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = doc.createElement("div");
    tipEl.id = TIP_ID;
    tipEl.className = "lx-tooltip";
    tipEl.setAttribute("role", "tooltip");
    doc.body.appendChild(tipEl);
    return tipEl;
  };

  const clearTimer = () => {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  };

  const restoreTitle = (el: HTMLElement) => {
    const parked = el.getAttribute("data-lx-title");
    el.removeAttribute("data-lx-title");
    if (el.getAttribute("aria-describedby") === TIP_ID) el.removeAttribute("aria-describedby");
    // React may have set a fresh title meanwhile; never clobber it.
    if (parked !== null && !el.hasAttribute("title")) el.setAttribute("title", parked);
  };

  const hide = () => {
    clearTimer();
    if (shown) {
      restoreTitle(shown);
      shown = null;
      lastHiddenAt = Date.now();
    }
    if (tipEl) tipEl.removeAttribute("data-open");
  };

  const show = (el: HTMLElement) => {
    timer = null;
    if (!el.isConnected || el !== target) return;
    const text = (el.getAttribute("title") ?? "").trim();
    if (!text) return;
    const tip = ensureTip();
    tip.textContent = text;
    el.setAttribute("data-lx-title", el.getAttribute("title") ?? "");
    el.removeAttribute("title");
    if (!el.hasAttribute("aria-describedby")) el.setAttribute("aria-describedby", TIP_ID);
    shown = el;

    const preferred: TooltipSide =
      (el.closest("[data-tip-side]")?.getAttribute("data-tip-side") as TooltipSide | null) ??
      (el.closest(".lx-nav-rail") ? "right" : "bottom");
    tip.setAttribute("data-open", "");
    tip.style.left = "0px";
    tip.style.top = "0px";
    const r = el.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const pos = placeTooltip(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: box.width, height: box.height },
      { width: win.innerWidth, height: win.innerHeight },
      preferred,
    );
    tip.style.left = `${Math.round(pos.left)}px`;
    tip.style.top = `${Math.round(pos.top)}px`;
    tip.setAttribute("data-side", pos.side);
  };

  const schedule = (el: HTMLElement) => {
    clearTimer();
    target = el;
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS;
    if (warm) show(el);
    else timer = win.setTimeout(() => show(el), SHOW_DELAY_MS);
  };

  const titled = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof win.HTMLElement)) return null;
    const el = node.closest<HTMLElement>("[title], [data-lx-title]");
    // `data-native-title`: a broad area hint (e.g. the whole status bar) that
    // should keep the unobtrusive native popup instead of a themed one.
    if (!el || el.hasAttribute("data-native-title") || el.closest(".xterm, .cm-editor")) return null;
    return el;
  };

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = titled(e.target);
    if (el === target) return;
    if (shown && shown !== el) hide();
    target = el;
    if (!el) {
      clearTimer();
      return;
    }
    if (el === pressed) return;
    pressed = null;
    schedule(el);
  };

  const onOut = (e: PointerEvent) => {
    const to = titled(e.relatedTarget);
    if (target && to === target) return;
    if (pressed && to !== pressed) pressed = null;
    target = null;
    hide();
  };

  const onDown = (e: Event) => {
    pressed = titled(e.target);
    target = null;
    hide();
  };

  const onFocusIn = (e: FocusEvent) => {
    const el = titled(e.target);
    if (!el || el !== e.target) return;
    // Only keyboard focus: mouse clicks also focus buttons.
    let keyboard = false;
    try {
      keyboard = el.matches(":focus-visible");
    } catch {
      keyboard = false;
    }
    if (keyboard) schedule(el);
  };

  const onFocusOut = (e: FocusEvent) => {
    // Only a keyboard-focus tooltip ends with focus; hover ones end on leave.
    if (e.target !== target && e.target !== shown) return;
    target = null;
    hide();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && shown) hide();
  };

  const onScroll = () => {
    if (shown || timer !== null) {
      target = null;
      hide();
    }
  };

  doc.addEventListener("pointerover", onOver, true);
  doc.addEventListener("pointerout", onOut, true);
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("keydown", onKey, true);
  win.addEventListener("scroll", onScroll, true);
  win.addEventListener("blur", hide);

  return () => {
    hide();
    doc.removeEventListener("pointerover", onOver, true);
    doc.removeEventListener("pointerout", onOut, true);
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("focusout", onFocusOut, true);
    doc.removeEventListener("keydown", onKey, true);
    win.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("blur", hide);
    tipEl?.remove();
    tipEl = null;
  };
}
