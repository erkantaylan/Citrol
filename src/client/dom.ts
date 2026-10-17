// Small DOM helpers. User content only ever goes in as text nodes or properties, never as HTML.

type Props = Record<string, string | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Icons are <symbol>s in index.html.
export function icon(name: string, cls?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  if (cls) svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function colorClass(id: string): string {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `c${(n % 6) + 1}`;
}

// Avatar image with an initial as fallback if the image fails to load.
export function avatar(
  user: { id: string; displayName: string; avatarUrl: string },
  opts: { size?: "xs" | "sm" | "lg"; status?: "online" | "offline" } = {},
): HTMLDivElement {
  const el = h("div", { class: `avatar ${colorClass(user.id)}${opts.size ? ` ${opts.size}` : ""}` });
  const img = h("img", { alt: "" });
  img.src = user.avatarUrl;
  img.addEventListener("error", () => img.replaceWith(user.displayName.slice(0, 1).toUpperCase()), { once: true });
  el.append(img);
  if (opts.status) el.append(h("i", { class: `status${opts.status === "online" ? " online" : ""}` }));
  return el;
}

// Grow a textarea with its content (the CSS max-height caps it).
export function autosize(box: HTMLTextAreaElement) {
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight}px`;
}
