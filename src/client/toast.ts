import { h } from "./dom.ts";

const SHOW_FOR = 1500;

let el: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

// A short message near the bottom of the screen that fades out by itself.
export function toast(text: string) {
  if (!el) {
    el = h("div", { class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => el?.classList.remove("show"), SHOW_FOR);
}

export function copyText(text: string) {
  // navigator.clipboard is missing on plain http (other than localhost).
  const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"));
  write.then(
    () => toast("Copied"),
    () => toast("Could not copy"),
  );
}
