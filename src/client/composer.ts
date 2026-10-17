import { channelLabel } from "./channels.ts";
import { autosize, h, icon } from "./dom.ts";
import { createMarkupHelp } from "./markup-help.ts";
import { attachMentionPicker } from "./mention-picker.ts";
import { closeTab, hasEveryone } from "./mentions.ts";
import type { Channel, Member } from "./types.ts";

const TYPING_SEND_EVERY = 3000;
const TYPING_SHOW_FOR = 5000;

type Options = {
  send: (channelId: string, content: string) => Promise<void>;
  typing: (channelId: string) => void;
  // Who can be @mentioned in the open channel.
  candidates: () => Member[];
};

export function createComposer(opts: Options) {
  const box = h("textarea", { rows: "1", placeholder: "Message", "aria-label": "Message" });
  const sendBtn = h("button", { class: "icon-btn", title: "Send", "aria-label": "Send" }, icon("send"));
  const error = h("div", { class: "composer-error", role: "alert" });
  const typingEl = h("div", { class: "typing", "aria-live": "polite" });
  const boxRow = h("div", { class: "composer-box" }, box);
  const help = createMarkupHelp(boxRow);
  boxRow.append(help.button, sendBtn);
  const el = h("div", { class: "composer" }, boxRow, error, typingEl, help.panel);
  // Before our own keydown handler, so Enter picks a name instead of sending.
  const picker = attachMentionPicker(box, { candidates: opts.candidates, anchor: boxRow });

  let channel: Channel | null = null;
  let sending = false;
  let lastTypingSent = 0;
  const drafts = new Map<string, string>();
  // channelId -> userId -> who is typing and when it expires
  const typers = new Map<string, Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>>();

  function setError(text: string) {
    error.textContent = text;
    el.classList.toggle("has-error", text !== "");
  }

  async function submit() {
    if (!channel || sending) return;
    const content = picker.toContent(box.value.trim());
    if (!content) return;
    if (hasEveryone(content)) return closeTab();
    const channelId = channel.id;
    sending = true;
    box.disabled = true;
    sendBtn.disabled = true;
    setError("");
    try {
      await opts.send(channelId, content);
      if (channel?.id === channelId) {
        box.value = "";
        picker.reset();
      }
      drafts.delete(channelId);
      lastTypingSent = 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    } finally {
      sending = false;
      box.disabled = channel === null;
      sendBtn.disabled = channel === null;
      autosize(box);
      box.focus();
    }
  }

  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });

  box.addEventListener("input", () => {
    autosize(box);
    if (error.textContent) setError("");
    const now = Date.now();
    if (channel && box.value.trim() && now - lastTypingSent >= TYPING_SEND_EVERY) {
      lastTypingSent = now;
      opts.typing(channel.id);
    }
  });

  sendBtn.addEventListener("click", () => void submit());

  function renderTyping() {
    const names = channel ? [...(typers.get(channel.id)?.values() ?? [])].map((t) => t.name) : [];
    typingEl.replaceChildren();
    if (names.length === 0) return;
    const text = h("span");
    if (names.length === 1) text.append(h("b", {}, names[0]!), " is typing…");
    else if (names.length === 2) text.append(h("b", {}, names[0]!), " and ", h("b", {}, names[1]!), " are typing…");
    else text.append("Several people are typing…");
    typingEl.append(h("span", { class: "dots" }, h("i"), h("i"), h("i")), text);
  }

  function stopTyping(channelId: string, userId: string) {
    const users = typers.get(channelId);
    const t = users?.get(userId);
    if (!users || !t) return;
    clearTimeout(t.timer);
    users.delete(userId);
    if (channelId === channel?.id) renderTyping();
  }

  return {
    el,

    setChannel(next: Channel | null) {
      if (channel) drafts.set(channel.id, box.value);
      picker.close();
      channel = next;
      box.value = next ? (drafts.get(next.id) ?? "") : "";
      box.placeholder = next ? `Message ${channelLabel(next)}` : "No channel";
      box.setAttribute("aria-label", box.placeholder);
      box.disabled = next === null || sending;
      sendBtn.disabled = box.disabled;
      lastTypingSent = 0;
      setError("");
      renderTyping();
      autosize(box);
    },

    focus() {
      if (!box.disabled) box.focus();
    },

    typing(channelId: string, userId: string, name: string) {
      let users = typers.get(channelId);
      if (!users) typers.set(channelId, (users = new Map()));
      const old = users.get(userId);
      if (old) clearTimeout(old.timer);
      users.set(userId, { name, timer: setTimeout(() => stopTyping(channelId, userId), TYPING_SHOW_FOR) });
      if (channelId === channel?.id) renderTyping();
    },

    // Their message arrived, so they're done typing.
    stopTyping,
  };
}
