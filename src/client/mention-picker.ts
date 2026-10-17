// The `@name` autocomplete for a textarea (the composer and the edit box).
import { avatar, h } from "./dom.ts";
import { fromTokens, toTokens, type Lookup } from "./mentions.ts";
import type { Member } from "./types.ts";

const MAX = 8;
const GAP = 4;
// `@` at the start of a word, then the name typed so far, up to the caret.
const QUERY = /(?:^|[^\p{L}\p{N}_])@([^\s@]+)$/u;

type Options = {
  // Who may be mentioned right now.
  candidates: () => Member[];
  // The popup sits above this element (defaults to the textarea).
  anchor?: HTMLElement;
};

export function attachMentionPicker(box: HTMLTextAreaElement, opts: Options) {
  // displayName as inserted -> user id, so the text can be turned into tokens on send.
  const picked = new Map<string, string>();
  const popup = h("div", { class: "mention-picker", role: "listbox", "aria-label": "Mention someone" });
  let matches: Member[] = [];
  let active = 0;
  let start = -1;

  function close() {
    if (!popup.isConnected) return;
    popup.remove();
    window.removeEventListener("resize", place);
    matches = [];
    box.removeAttribute("aria-expanded");
  }

  function find(query: string): Member[] {
    const q = query.toLowerCase();
    const score = (m: Member) => {
      const names = [m.displayName.toLowerCase(), m.username.toLowerCase()];
      if (names.some((n) => n.startsWith(q))) return 0;
      if (names.some((n) => n.includes(q))) return 1;
      return -1;
    };
    return opts
      .candidates()
      .map((m) => ({ m, s: score(m) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => Number(b.m.online) - Number(a.m.online) || a.s - b.s || a.m.displayName.localeCompare(b.m.displayName))
      .slice(0, MAX)
      .map((x) => x.m);
  }

  function render() {
    popup.replaceChildren(
      ...matches.map((m, i) => {
        const row = h(
          "div",
          { class: `mention-option${i === active ? " active" : ""}${m.online ? "" : " offline"}`, role: "option", "aria-selected": String(i === active) },
          avatar(m, { size: "xs" }),
          h("b", {}, m.displayName),
          h("small", {}, m.username),
        );
        // Keep focus in the textarea, otherwise its blur closes the popup before the click lands.
        row.addEventListener("mousedown", (e) => e.preventDefault());
        row.addEventListener("click", () => pick(m));
        return row;
      }),
    );
  }

  function place() {
    const rect = (opts.anchor ?? box).getBoundingClientRect();
    popup.style.left = `${Math.max(GAP, rect.left)}px`;
    popup.style.bottom = `${innerHeight - rect.top + GAP}px`;
    popup.style.width = `${Math.min(rect.width, 320)}px`;
  }

  function update() {
    const caret = box.selectionStart;
    const match = box.selectionEnd === caret ? box.value.slice(0, caret).match(QUERY) : null;
    if (!match || box.disabled) return close();
    start = caret - match[1]!.length - 1;
    matches = find(match[1]!);
    if (matches.length === 0) return close();
    active = 0;
    render();
    if (!popup.isConnected) {
      document.body.append(popup);
      window.addEventListener("resize", place);
    }
    box.setAttribute("aria-expanded", "true");
    place();
  }

  function pick(m: Member) {
    const text = `@${m.displayName} `;
    const end = box.selectionStart;
    box.setRangeText(text, start, end, "end");
    picked.set(m.displayName, m.id);
    close();
    box.focus();
    // Let the owner autosize and send "typing" as for any other change.
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }

  box.addEventListener("input", update);
  box.addEventListener("click", update);
  box.addEventListener("blur", close);
  // Registered before the owner's own keydown handler, so Enter and Escape reach us first.
  box.addEventListener("keydown", (e) => {
    if (!popup.isConnected || e.isComposing) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => ((active = (active + 1) % matches.length), render()),
      ArrowUp: () => ((active = (active - 1 + matches.length) % matches.length), render()),
      Enter: () => pick(matches[active]!),
      Tab: () => pick(matches[active]!),
      Escape: close,
    };
    const run = keys[e.key];
    if (!run || e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run();
  });

  return {
    close,

    // The textarea text as it should be sent.
    toContent: (text: string) => toTokens(text, picked, opts.candidates()),

    // Stored content as it should look in the textarea.
    fromContent: (content: string, lookup: Lookup) => fromTokens(content, lookup, picked),

    // After a successful send the remembered names are no longer needed.
    reset() {
      picked.clear();
      close();
    },
  };
}
