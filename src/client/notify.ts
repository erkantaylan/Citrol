import { h, icon } from "./dom.ts";

const BODY_MAX = 100;

const supported = typeof Notification !== "undefined";
// One per channel, so reading the channel can take its notification away.
const shown = new Map<string, Notification>();

// The bell in the user panel. It's only there while the browser hasn't been asked yet.
export function createNotifyButton(): HTMLButtonElement {
  const btn = h(
    "button",
    { class: "icon-btn", title: "Enable notifications", "aria-label": "Enable notifications" },
    icon("bell"),
  );
  const update = () => (btn.hidden = !supported || Notification.permission !== "default");
  btn.addEventListener("click", () => {
    void Notification.requestPermission().then(update, update);
  });
  // The permission can also change in the browser's site settings.
  window.addEventListener("focus", update);
  update();
  return btn;
}

function truncate(text: string): string {
  const chars = [...text];
  return chars.length > BODY_MAX ? `${chars.slice(0, BODY_MAX - 1).join("")}…` : text;
}

export function notify(opts: { title: string; body: string; icon: string; tag: string; onClick: () => void }) {
  if (!supported || Notification.permission !== "granted") return;
  try {
    const n = new Notification(opts.title, { body: truncate(opts.body), icon: opts.icon, tag: opts.tag });
    n.onclick = () => {
      window.focus();
      opts.onClick();
      n.close();
    };
    n.onclose = () => {
      if (shown.get(opts.tag) === n) shown.delete(opts.tag);
    };
    shown.set(opts.tag, n);
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

export function dismiss(tag: string) {
  shown.get(tag)?.close();
  shown.delete(tag);
}
