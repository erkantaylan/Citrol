import { h } from "./dom.ts";

export type MenuItem = { label: string; action: () => void; disabled?: boolean; danger?: boolean };

const LONG_PRESS = 500;
const MOVE_TOLERANCE = 10;
const EDGE = 4;

let menu: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;
// Nested targets (an author inside a message) see the same event; the innermost one claims it.
const claimed = new WeakSet<Event>();
let press: { x: number; y: number; timer: ReturnType<typeof setTimeout>; fired: boolean } | null = null;
let listening = false;

function items(): HTMLButtonElement[] {
  return menu ? [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : [];
}

export function closeMenu(restoreFocus = false) {
  if (!menu) return;
  menu.remove();
  menu = null;
  if (restoreFocus) returnFocus?.focus({ preventScroll: true });
  returnFocus = null;
}

function move(step: number | "first" | "last") {
  const list = items();
  if (list.length === 0) return;
  const at = list.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    step === "first" ? 0 : step === "last" ? list.length - 1 : at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
  list[next]!.focus({ preventScroll: true });
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("pointerdown", (e) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  }, true);
  document.addEventListener("scroll", () => closeMenu(), true);
  window.addEventListener("resize", () => closeMenu());
  window.addEventListener("blur", () => closeMenu());
  document.addEventListener("keydown", (e) => {
    if (!menu) return;
    const keys: Record<string, () => void> = {
      Escape: () => closeMenu(true),
      Tab: () => closeMenu(true),
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => move("first"),
      End: () => move("last"),
      Enter: () => (menu?.contains(document.activeElement) ? (document.activeElement as HTMLElement).click() : undefined),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }, true);

  // Long press on touch screens.
  document.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (press && !press.fired && t && Math.hypot(t.clientX - press.x, t.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    // The menu is open: don't let the lifted finger also click what's underneath.
    if (press?.fired && e.cancelable) e.preventDefault();
    cancelPress();
  }, { passive: false });
  document.addEventListener("touchcancel", () => cancelPress());
}

function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

export function openMenu(x: number, y: number, list: MenuItem[], focusFirst = false) {
  closeMenu();
  if (list.length === 0) return;
  listen();
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  menu = h("div", { class: "context-menu", role: "menu", tabindex: "-1" });
  for (const item of list) {
    const btn = h(
      "button",
      { type: "button", role: "menuitem", class: item.danger ? "danger" : undefined, disabled: item.disabled },
      item.label,
    );
    btn.addEventListener("click", () => {
      closeMenu();
      item.action();
    });
    // Hover and keyboard share one highlight.
    btn.addEventListener("pointermove", () => {
      if (document.activeElement !== btn) btn.focus({ preventScroll: true });
    });
    menu.append(btn);
  }
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.append(menu);

  // Open toward the free side so the menu stays inside the viewport.
  const { width, height } = menu.getBoundingClientRect();
  const left = x + width > innerWidth - EDGE ? x - width : x;
  const top = y + height > innerHeight - EDGE ? y - height : y;
  menu.style.left = `${Math.max(EDGE, Math.min(left, innerWidth - width - EDGE))}px`;
  menu.style.top = `${Math.max(EDGE, Math.min(top, innerHeight - height - EDGE))}px`;

  if (focusFirst) move("first");
  else menu.focus({ preventScroll: true });
}

// Right click, the context-menu key, or a long press on `target` opens the menu built by `build`.
export function attachMenu(target: HTMLElement, build: () => MenuItem[]) {
  target.addEventListener("contextmenu", (e) => {
    if (claimed.has(e)) return;
    claimed.add(e);
    e.preventDefault();
    // Android fires contextmenu on a long press too; open only once.
    if (press?.fired) return;
    if (press) {
      clearTimeout(press.timer);
      press.fired = true;
    }
    // From the keyboard there's no pointer position: open next to the element.
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    const rect = target.getBoundingClientRect();
    openMenu(fromKeyboard ? rect.left + 16 : e.clientX, fromKeyboard ? rect.top + rect.height / 2 : e.clientY, build(), fromKeyboard);
  });

  target.addEventListener("touchstart", (e) => {
    if (claimed.has(e)) return;
    claimed.add(e);
    cancelPress();
    const t = e.touches[0];
    if (!t || e.touches.length !== 1) return;
    listen();
    const p = {
      x: t.clientX,
      y: t.clientY,
      fired: false,
      timer: setTimeout(() => {
        p.fired = true;
        openMenu(p.x, p.y, build());
      }, LONG_PRESS),
    };
    press = p;
  }, { passive: true });
}
