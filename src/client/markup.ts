// Message formatting (see docs/formatting.md). `parse` turns the stored text into a small tree, `renderMarkup`
// builds DOM nodes from it. User text only ever goes in as text nodes; a link's href is set as a property
// after its scheme is checked. The parser is a hand-rolled scanner: one pass for code fences and lines, one
// pass per block for inline markup with a stack of open markers, so bad input costs linear time.
import { h } from "./dom.ts";

export const COLOURS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"] as const;
export type Colour = (typeof COLOURS)[number];

// Openers past this depth stay as text.
export const MAX_DEPTH = 8;

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "spoiler" | "rainbow"; children: Inline[] }
  | { type: "color"; color: Colour; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string }
  | { type: "mention"; id: string };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "quote"; children: Inline[] }
  | { type: "codeblock"; lang: string | null; text: string };

const ESCAPABLE = new Set([..."\\*_~|`[]<>"]);
// Characters that may start markup; everything else is copied as one text run.
const SPECIAL = new Set([..."\\*_~|`[<hH"]);
const COLOUR_SET = new Set<string>(COLOURS);
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
const FENCE = "```";
const LANG = /([\w+#.-]{1,20})\n/y;
const TAG = /\[(\/?)([a-z]{3,7})\]/y;
const MENTION = /<@([^<>@\s]{1,64})>/y;
const LINK_START = /https?:\/\//iy;

// A known colour or effect tag at `i`, or null.
function tagAt(src: string, i: number): RegExpExecArray | null {
  TAG.lastIndex = i;
  const m = TAG.exec(src);
  const name = m?.[2];
  return m && name && (name === "rainbow" || COLOUR_SET.has(name)) ? m : null;
}

const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);
// The ends of the text count as whitespace.
const isSpace = (c: string | undefined) => c === undefined || SPACE.test(c);

// Only http(s) links with a host; returns the normalised href or null.
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

// ---------- blocks ----------

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let start = 0;
  let i = 0;
  // Once a search for a closing fence fails, no later fence can close either.
  let fencesLeft = true;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\\" && ESCAPABLE.has(text[i + 1] ?? "")) {
      i += 2;
      continue;
    }
    if (c !== "`" || !fencesLeft || !text.startsWith(FENCE, i)) {
      i++;
      continue;
    }
    const close = text.indexOf(FENCE, i + 3);
    if (close < 0) {
      fencesLeft = false;
      i += 3;
      continue;
    }
    let body = text.slice(i + 3, close);
    let lang: string | null = null;
    LANG.lastIndex = 0;
    const m = LANG.exec(body);
    if (m) {
      lang = m[1]!;
      body = body.slice(m[0].length);
    } else if (body.startsWith("\n")) {
      body = body.slice(1);
    }
    if (body.endsWith("\n")) body = body.slice(0, -1);
    if (!body && !lang) {
      // "``````" stays as typed.
      i = close + 3;
      continue;
    }
    // The block breaks the line itself, so drop the newline right before and after it.
    const before = text.slice(start, i);
    prose(before.endsWith("\n") ? before.slice(0, -1) : before, blocks);
    blocks.push({ type: "codeblock", lang, text: body });
    i = start = text[close + 3] === "\n" ? close + 4 : close + 3;
  }
  prose(text.slice(start), blocks);
  return blocks;
}

// `> text` at the start of a line is a quote line; runs of quote or plain lines become one block each.
function prose(text: string, blocks: Block[]) {
  if (!text) return;
  let kind: "paragraph" | "quote" | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (kind) blocks.push({ type: kind, children: parseInline(lines.join("\n")) });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const quoted = line.startsWith("> ") ? line.slice(2) : line === ">" ? "" : null;
    const next = quoted === null ? "paragraph" : "quote";
    if (next !== kind) flush();
    kind = next;
    lines.push(quoted ?? line);
  }
  flush();
}

// ---------- inline ----------

type Frame = { marker: string; children: Inline[] };

function addText(f: Frame, text: string) {
  if (!text) return;
  const last = f.children.at(-1);
  if (last?.type === "text") last.text += text;
  else f.children.push({ type: "text", text });
}

function nodeFor(f: Frame): Inline {
  const children = f.children;
  switch (f.marker) {
    case "**": return { type: "bold", children };
    case "*": case "_": return { type: "italic", children };
    case "__": return { type: "underline", children };
    case "~~": return { type: "strike", children };
    case "||": return { type: "spoiler", children };
    case "[rainbow]": return { type: "rainbow", children };
    default: return { type: "color", color: f.marker.slice(1, -1) as Colour, children };
  }
}

// Flanking rules: `*` needs a non-space on the inside, `_` and `__` must not sit inside a word (snake_case).
function canOpen(marker: string, before: string | undefined, after: string | undefined): boolean {
  if (marker === "*") return !isSpace(after);
  if (marker === "_") return !isSpace(after) && !isWord(before);
  if (marker === "__") return !isWord(before);
  return true;
}

function canClose(marker: string, before: string | undefined, after: string | undefined): boolean {
  if (marker === "*") return !isSpace(before);
  if (marker === "_") return !isSpace(before) && !isWord(after);
  if (marker === "__") return !isWord(after);
  return true;
}

export function parseInline(src: string): Inline[] {
  const root: Frame = { marker: "", children: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1]!;
  const n = src.length;
  // By backtick run length: true once a search for a closing run failed.
  const noCodeCloser = [false, false, false];

  // Unclosed: the marker and everything inside go back to the frame below as they were.
  const flattenTop = () => {
    const f = stack.pop()!;
    const parent = top();
    addText(parent, f.marker);
    for (const child of f.children) {
      if (child.type === "text") addText(parent, child.text);
      else parent.children.push(child);
    }
  };
  const closeAt = (k: number) => {
    while (stack.length - 1 > k) flattenTop();
    const f = stack.pop()!;
    top().children.push(nodeFor(f));
  };
  const open = (marker: string) => {
    if (stack.length - 1 >= MAX_DEPTH) addText(top(), marker);
    else stack.push({ marker, children: [] });
  };
  // The topmost open frame with this marker and some content, or -1.
  const findOpen = (test: (marker: string) => boolean) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const f = stack[k]!;
      if (f.children.length > 0 && test(f.marker)) return k;
    }
    return -1;
  };

  // A run of `*`, `_`, `~` or `|`. Closing comes first (an exact-length marker wins), then opening.
  const run = (c: string, i: number): number => {
    let j = i;
    while (j < n && src[j] === c) j++;
    const before = src[i - 1];
    const after = src[j];
    const single = c === "*" || c === "_";
    let rem = j - i;
    while (rem > 0) {
      const fits = (m: string) => m[0] === c && m.length <= rem && canClose(m, before, after);
      let k = rem <= 2 ? findOpen((m) => fits(m) && m.length === rem) : -1;
      if (k < 0) k = findOpen(fits);
      if (k < 0) break;
      rem -= stack[k]!.marker.length;
      closeAt(k);
    }
    // Openers: the innermost marker comes last, so `***x***` is bold around italic.
    const want = single ? Math.min(rem, 3) : rem >= 2 ? 2 : 0;
    addText(top(), c.repeat(rem - want));
    const markers = want === 3 ? [c + c, c] : want === 2 ? [c + c] : want === 1 && single ? [c] : [];
    for (const m of markers) {
      if (canOpen(m, before, after)) open(m);
      else addText(top(), m);
    }
    return j;
  };

  // `code` or ``code``: the same number of backticks closes it, and nothing inside is parsed.
  const code = (i: number): number => {
    let j = i;
    while (j < n && src[j] === "`") j++;
    const len = j - i;
    if (len > 2 || noCodeCloser[len]) {
      addText(top(), src.slice(i, j));
      return j;
    }
    let k = j;
    while (k < n) {
      if (src[k] !== "`") {
        k++;
        continue;
      }
      let e = k;
      while (e < n && src[e] === "`") e++;
      if (e - k === len) {
        top().children.push({ type: "code", text: src.slice(j, k) });
        return e;
      }
      k = e;
    }
    noCodeCloser[len] = true;
    addText(top(), src.slice(i, j));
    return j;
  };

  // `[red]`, `[/red]`, `[rainbow]`, `[/rainbow]`; anything else is text.
  const tag = (i: number): number => {
    const m = tagAt(src, i);
    if (!m) {
      addText(top(), "[");
      return i + 1;
    }
    const marker = `[${m[2]}]`;
    if (!m[1]) {
      open(marker);
    } else {
      const k = findOpen((x) => x === marker);
      if (k < 0) addText(top(), m[0]);
      else closeAt(k);
    }
    return i + m[0].length;
  };

  const mention = (i: number): number => {
    MENTION.lastIndex = i;
    const m = MENTION.exec(src);
    if (!m) {
      addText(top(), "<");
      return i + 1;
    }
    top().children.push({ type: "mention", id: m[1]! });
    return i + m[0].length;
  };

  // A bare http(s) URL. Trailing punctuation and unbalanced brackets stay outside the link.
  const link = (i: number): number => {
    LINK_START.lastIndex = i;
    if (isWord(src[i - 1]) || !LINK_START.test(src)) return -1;
    let j = LINK_START.lastIndex;
    while (j < n) {
      const ch = src[j]!;
      if (isSpace(ch) || ch === "<" || ch === ">" || ch === '"' || ch === "`") break;
      if (ch === "[" && tagAt(src, j)) break;
      j++;
    }
    let url = src.slice(i, j);
    for (;;) {
      const last = url.at(-1);
      if (last && ".,:;!?'*_~|".includes(last)) url = url.slice(0, -1);
      else if (last === ")" && count(url, "(") < count(url, ")")) url = url.slice(0, -1);
      else if (last === "]" && count(url, "[") < count(url, "]")) url = url.slice(0, -1);
      else break;
    }
    if (!safeHref(url)) return -1;
    top().children.push({ type: "link", url });
    return i + url.length;
  };

  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (c === "\\") {
      const next = src[i + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        addText(top(), next);
        i += 2;
      } else {
        addText(top(), c);
        i++;
      }
    } else if (c === "*" || c === "_" || c === "~" || c === "|") {
      i = run(c, i);
    } else if (c === "`") {
      i = code(i);
    } else if (c === "[") {
      i = tag(i);
    } else if (c === "<") {
      i = mention(i);
    } else {
      const end = c === "h" || c === "H" ? link(i) : -1;
      if (end >= 0) {
        i = end;
        continue;
      }
      let j = i + 1;
      while (j < n && !SPECIAL.has(src[j]!)) j++;
      addText(top(), src.slice(i, j));
      i = j;
    }
  }
  while (stack.length > 1) flattenTop();
  return root.children;
}

function count(text: string, ch: string): number {
  let k = 0;
  for (const c of text) if (c === ch) k++;
  return k;
}

// ---------- rendering ----------

export type RenderOptions = {
  // The node for a `<@id>` token (mentions.ts makes the pill).
  mention: (id: string) => Node;
  // Remembers revealed spoilers across re-renders, by their order in the message.
  spoilers?: { isRevealed: (index: number) => boolean; reveal: (index: number) => void };
};

const TAGS = { bold: "strong", italic: "em", underline: "u", strike: "s" } as const;

export function renderMarkup(text: string, opts: RenderOptions): HTMLDivElement {
  let spoilerIndex = 0;

  const inline = (nodes: Inline[], parent: HTMLElement) => {
    for (const node of nodes) parent.append(renderInline(node));
    return parent;
  };

  const renderInline = (node: Inline): Node => {
    switch (node.type) {
      case "text": return document.createTextNode(node.text);
      case "code": return h("code", { class: "md-code" }, node.text);
      case "mention": return opts.mention(node.id);
      case "link": {
        const href = safeHref(node.url);
        if (!href) return document.createTextNode(node.url);
        const a = h("a", { class: "md-link", target: "_blank", rel: "noopener noreferrer" }, node.url);
        a.href = href;
        return a;
      }
      case "bold": case "italic": case "underline": case "strike":
        return inline(node.children, h(TAGS[node.type]));
      case "color": return inline(node.children, h("span", { class: `md-color md-${node.color}` }));
      case "rainbow": return inline(node.children, h("span", { class: "md-rainbow" }));
      case "spoiler": return spoiler(node.children);
    }
  };

  const spoiler = (children: Inline[]): HTMLElement => {
    const index = spoilerIndex++;
    const content = inline(children, h("span", { class: "md-spoiler-content" }));
    const el = h("span", { class: "md-spoiler" }, content);
    if (opts.spoilers?.isRevealed(index)) {
      el.classList.add("revealed");
      return el;
    }
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "Spoiler, press to reveal");
    content.setAttribute("aria-hidden", "true");
    const reveal = (e: Event) => {
      if (el.classList.contains("revealed")) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("revealed");
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
      el.removeAttribute("tabindex");
      content.removeAttribute("aria-hidden");
      opts.spoilers?.reveal(index);
    };
    el.addEventListener("click", reveal);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") reveal(e);
    });
    return el;
  };

  const root = h("div", { class: "markup" });
  for (const block of parse(text)) {
    if (block.type === "codeblock") {
      root.append(
        h(
          "div",
          { class: "md-codeblock" },
          block.lang ? h("div", { class: "md-lang" }, block.lang) : null,
          h("pre", {}, h("code", {}, block.text)),
        ),
      );
    } else {
      root.append(inline(block.children, h(block.type === "quote" ? "blockquote" : "p")));
    }
  }
  return root;
}
