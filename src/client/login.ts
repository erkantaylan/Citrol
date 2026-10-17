import { h } from "./dom.ts";

const errors: Record<string, string> = {
  denied: "Login was cancelled on Discord.",
  state: "Login expired or was started in another tab. Try again.",
  not_member: "Only members of our Discord server can log in.",
};

export function showLogin(root: HTMLElement) {
  const code = new URLSearchParams(location.search).get("error");
  const error = code ? (errors[code] ?? "Login failed. Try again.") : null;
  document.body.className = "login-page";
  root.className = "card";
  root.replaceChildren(
    h("h1", {}, "Citrol"),
    h("p", { class: "muted" }, "Text chat for our class."),
    ...(error ? [h("div", { class: "error" }, error)] : []),
    h("a", { class: "button primary", href: "/auth/discord" }, "Login with Discord"),
  );
}
