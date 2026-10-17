// Mentions: `<@id>` tokens in message content, shown as `@displayName` (see "Mentions" in docs/api.md).
import { h } from "./dom.ts";
import type { Author, Channel, Member, Message } from "./types.ts";

export type Lookup = (id: string) => Author | undefined;

const TOKEN = /<@([^<>@\s]+)>/g;
const UNKNOWN = "@unknown-user";
const WORD = /[\p{L}\p{N}_]/u;

const token = (id: string) => `<@${id}>`;
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);

export function mentionsMe(m: Message, meId: string): boolean {
  // `?.` keeps an older server without `mentions` from breaking the list.
  return m.mentions?.includes(meId) ?? false;
}

// Who can be mentioned in a channel: never yourself, and in a DM only the other person.
export function mentionable(channel: Channel | null, meId: string, members: Member[]): Member[] {
  if (!channel) return [];
  if (channel.kind === "dm") {
    const other = channel.other;
    if (!other || other.id === meId) return [];
    return [members.find((m) => m.id === other.id) ?? { ...other, online: false }];
  }
  return members.filter((m) => m.id !== meId);
}

// Content as text and pills. `decorate` lets the caller attach menus to a known user's pill.
export function renderMentions(content: string, lookup: Lookup, decorate?: (pill: HTMLElement, user: Author) => void): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of content.matchAll(TOKEN)) {
    if (match.index > last) nodes.push(document.createTextNode(content.slice(last, match.index)));
    const user = lookup(match[1]!);
    const pill = h("span", { class: "mention" }, user ? `@${user.displayName}` : UNKNOWN);
    if (user) decorate?.(pill, user);
    nodes.push(pill);
    last = match.index + match[0].length;
  }
  if (last < content.length) nodes.push(document.createTextNode(content.slice(last)));
  return nodes;
}

// Content as people read it, for copying and notifications.
export function plainText(content: string, lookup: Lookup): string {
  return content.replace(TOKEN, (_, id: string) => {
    const user = lookup(id);
    return user ? `@${user.displayName}` : UNKNOWN;
  });
}

// For the edit box: known tokens become `@displayName` (remembered in `picked`), unknown ones stay as typed
// so saving doesn't silently drop them.
export function fromTokens(content: string, lookup: Lookup, picked: Map<string, string>): string {
  return content.replace(TOKEN, (raw, id: string) => {
    const user = lookup(id);
    if (!user) return raw;
    picked.set(user.displayName, id);
    return `@${user.displayName}`;
  });
}

const startsWithAt = (text: string, at: number, name: string, ignoreCase: boolean) => {
  const part = text.slice(at, at + name.length);
  return (ignoreCase ? part.toLowerCase() === name.toLowerCase() : part === name) && !isWord(text[at + name.length]);
};

// Before sending: `@name` becomes `<@id>`. Names picked from the autocomplete win; a typed name counts only
// if it matches exactly one candidate's displayName or username (ignoring case).
export function toTokens(text: string, picked: Map<string, string>, candidates: Author[]): string {
  const allowed = new Set(candidates.map((c) => c.id));
  const pickedByLength = [...picked].filter(([, id]) => allowed.has(id)).sort((a, b) => b[0].length - a[0].length);
  const names = [...new Set(candidates.flatMap((c) => [c.displayName, c.username]))]
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    // Skip e-mail addresses and the like: the @ must start a word.
    if (ch !== "@" || isWord(text[i - 1])) {
      out += ch;
      i++;
      continue;
    }
    const at = i + 1;
    const hit = pickedByLength.find(([label]) => startsWithAt(text, at, label, false));
    if (hit) {
      out += token(hit[1]);
      i = at + hit[0].length;
      continue;
    }
    const name = names.find((n) => startsWithAt(text, at, n, true));
    const lower = name?.toLowerCase();
    const who = name ? candidates.filter((c) => c.displayName.toLowerCase() === lower || c.username.toLowerCase() === lower) : [];
    if (name && who.length === 1) {
      out += token(who[0]!.id);
      i = at + name.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Class joke: `@everyone` is not sent, the tab "closes" instead. Client side only.
export function hasEveryone(text: string): boolean {
  return /(?<![\p{L}\p{N}_])@everyone(?![\p{L}\p{N}_])/iu.test(text);
}

export function closeTab() {
  window.close();
  // Browsers refuse to close a tab the user opened; if we're still here, empty it.
  setTimeout(() => location.replace("about:blank"), 100);
}
