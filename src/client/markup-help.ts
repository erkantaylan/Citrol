// The "Aa" button next to the composer and its cheat sheet. The examples go through the real renderer,
// so the sheet doubles as a demo. A native popover: Escape and clicking elsewhere close it.
import { h } from "./dom.ts";
import { COLOURS, renderMarkup } from "./markup.ts";

const EXAMPLES = [
  "**bold**",
  "*italic* or _italic_",
  "__underline__",
  "~~strike~~",
  "`code`",
  "```js\nconst x = 1;\n```",
  "||spoiler||",
  "> quote",
  "https://example.com",
  "[cyan]colour[/cyan]",
  "[rainbow]rainbow[/rainbow]",
  "**[pink]bold pink[/pink]**",
  "\\*not italic\\*",
];

function sheet(): Node[] {
  // The examples mention nobody, so the fallback is never shown.
  const render = (src: string) => renderMarkup(src, { mention: () => document.createTextNode("@someone") });
  const list = h("dl");
  for (const src of EXAMPLES) list.append(h("dt", {}, src), h("dd", {}, render(src)));
  const palette = render(COLOURS.map((c) => `[${c}]${c}[/${c}]`).join(" "));
  return [
    h("h2", {}, "Formatting"),
    list,
    h("div", { class: "note" }, "Colours: ", palette),
    h("p", { class: "note" }, "Mentions with @ work inside all of these except code. A backslash shows a markup character as itself."),
  ];
}

// `anchor` is the composer box: the sheet opens above its right edge.
export function createMarkupHelp(anchor: HTMLElement) {
  const panel = h("div", { class: "markup-help", popover: "auto", role: "dialog", "aria-label": "Formatting help" });
  const button = h("button", { class: "icon-btn markup-help-btn", type: "button", title: "Formatting help", "aria-label": "Formatting help" }, "Aa");
  button.popoverTargetElement = panel;

  const place = () => {
    const r = anchor.getBoundingClientRect();
    panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
  };
  panel.addEventListener("beforetoggle", (e) => {
    if ((e as ToggleEvent).newState !== "open") return;
    if (!panel.firstChild) panel.append(...sheet());
    place();
  });
  window.addEventListener("resize", () => {
    if (panel.matches(":popover-open")) place();
  });

  return { button, panel };
}
