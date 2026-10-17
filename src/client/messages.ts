import { api, PAGE_SIZE } from "./api.ts";
import { attachMenu, openMenu, type MenuItem } from "./context-menu.ts";
import { autosize, avatar, h, icon } from "./dom.ts";
import { clock, day, dayKey, full, stamp } from "./format.ts";
import { attachMentionPicker } from "./mention-picker.ts";
import { renderMarkup } from "./markup.ts";
import { closeTab, hasEveryone, mentionPill, mentionsMe, plainText, type Lookup } from "./mentions.ts";
import { copyText } from "./toast.ts";
import type { Author, Channel, Me, Member, Message } from "./types.ts";

const GROUP_WINDOW = 5 * 60 * 1000;
const NEAR_BOTTOM = 80;
const LOAD_OLDER_AT = 200;
const CONFIRM_TIMEOUT = 4000;

type ScrollMode = "bottom" | "auto" | "keep" | "prepend";

type Options = {
  // The menu for an author's avatar or name.
  authorMenu: (author: Author) => MenuItem[];
  // Finds the user behind a mention token.
  people: Lookup;
  // Who can be @mentioned while editing.
  candidates: () => Member[];
};

export function createMessageList(me: Me, opts: Options) {
  const el = h("section", { class: "messages", "aria-live": "polite" });

  let channel: Channel | null = null;
  let messages: Message[] = [];
  let hasMore = false;
  let loading = false;
  let loadError: string | null = null;
  let loadingOlder = false;
  // Bumped on every channel switch or reload, so late answers for an old request are dropped.
  let generation = 0;
  // Messages that arrived over the socket while a page was being fetched.
  let arrivedDuringLoad: Message[] | null = null;

  let editing: { id: string; box: HTMLTextAreaElement; picker: ReturnType<typeof attachMentionPicker>; saving: boolean } | null = null;
  let confirmDelete: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let rowError: { id: string; text: string } | null = null;
  // Spoilers someone revealed stay revealed through re-renders, until the message's text changes.
  const revealed = new Map<string, { content: string; spoilers: Set<number> }>();

  const time = (m: Message) => new Date(m.createdAt).getTime();
  const isNearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;

  function insert(m: Message) {
    const i = messages.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      messages[i] = m;
      return;
    }
    // Usually the newest; walk back in case events arrive out of order.
    let at = messages.length;
    while (at > 0 && time(messages[at - 1]!) > time(m)) at--;
    messages.splice(at, 0, m);
  }

  async function loadLatest(gen: number) {
    arrivedDuringLoad = [];
    try {
      const page = await api.messages(channel!.id);
      if (gen !== generation) return;
      const ids = new Set(page.map((m) => m.id));
      const last = page.at(-1);
      const extra = arrivedDuringLoad.filter((m) => !ids.has(m.id) && (!last || time(m) >= time(last)));
      messages = page;
      for (const m of extra) insert(m);
      hasMore = page.length === PAGE_SIZE;
      loadError = null;
    } catch (err) {
      if (gen !== generation) return;
      loadError = err instanceof Error ? err.message : "Could not load messages.";
    } finally {
      if (gen === generation) {
        arrivedDuringLoad = null;
        loading = false;
      }
    }
  }

  async function loadOlder() {
    if (!channel || !hasMore || loadingOlder || loading) return;
    const first = messages[0];
    if (!first) return;
    loadingOlder = true;
    const gen = generation;
    try {
      const page = await api.messages(channel.id, first.id);
      if (gen !== generation) return;
      const ids = new Set(messages.map((m) => m.id));
      messages = [...page.filter((m) => !ids.has(m.id)), ...messages];
      hasMore = page.length === PAGE_SIZE;
      render("prepend");
    } catch {
      // Leave hasMore as is; the next scroll to the top tries again.
    } finally {
      if (gen === generation) loadingOlder = false;
    }
    fillScreen();
  }

  // If the first page doesn't fill the screen there's no scrollbar to trigger loading more.
  function fillScreen() {
    if (hasMore && !loadingOlder && el.scrollHeight <= el.clientHeight) void loadOlder();
  }

  el.addEventListener("scroll", () => {
    if (el.scrollTop < LOAD_OLDER_AT) void loadOlder();
  });

  // ---------- edit and delete ----------

  function startEdit(m: Message) {
    const box = h("textarea", { class: "edit-box", rows: "1", "aria-label": "Edit message" });
    // Before our own keydown handler, so Enter and Escape go to the picker while it's open.
    const picker = attachMentionPicker(box, { candidates: opts.candidates });
    box.value = picker.fromContent(m.content, opts.people);
    editing?.picker.close();
    editing = { id: m.id, box, picker, saving: false };
    rowError = null;
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopEdit();
      } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void saveEdit();
      }
    });
    box.addEventListener("input", () => autosize(box));
    render("keep");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    autosize(box);
  }

  function stopEdit() {
    if (!editing) return;
    editing.picker.close();
    editing = null;
    rowError = null;
    render("keep");
  }

  async function saveEdit() {
    if (!editing || editing.saving) return;
    const current = editing;
    const original = messages.find((m) => m.id === current.id);
    const content = current.picker.toContent(current.box.value.trim());
    if (original && content === original.content) return stopEdit();
    if (hasEveryone(content)) return closeTab();
    current.saving = true;
    current.box.disabled = true;
    try {
      const updated = await api.edit(current.id, content);
      if (editing !== current) return;
      insert(updated);
      stopEdit();
    } catch (err) {
      if (editing !== current) return;
      current.saving = false;
      current.box.disabled = false;
      rowError = { id: current.id, text: err instanceof Error ? err.message : "Could not save." };
      render("keep");
      current.box.focus();
    }
  }

  function clearConfirm() {
    if (!confirmDelete) return;
    clearTimeout(confirmDelete.timer);
    confirmDelete = null;
  }

  async function onDelete(m: Message) {
    if (confirmDelete?.id !== m.id) {
      clearConfirm();
      confirmDelete = {
        id: m.id,
        timer: setTimeout(() => {
          confirmDelete = null;
          render("keep");
        }, CONFIRM_TIMEOUT),
      };
      render("keep");
      // Opened from the context menu: Enter or a click on "Delete?" confirms.
      el.querySelector<HTMLElement>(".confirm-delete")?.focus({ preventScroll: true });
      return;
    }
    clearConfirm();
    try {
      await api.remove(m.id);
      remove(m.id);
    } catch (err) {
      rowError = { id: m.id, text: err instanceof Error ? err.message : "Could not delete." };
      render("keep");
    }
  }

  // ---------- rendering ----------

  function renderTools(m: Message): HTMLElement {
    const confirming = confirmDelete?.id === m.id;
    const edit = h("button", { class: "icon-btn", title: "Edit", "aria-label": "Edit message" }, icon("edit"));
    edit.addEventListener("click", () => startEdit(m));
    const del = confirming
      ? h("button", { class: "confirm-delete", title: "Click again to delete" }, "Delete?")
      : h("button", { class: "icon-btn danger", title: "Delete", "aria-label": "Delete message" }, icon("trash"));
    del.addEventListener("click", () => void onDelete(m));
    return h("div", { class: "msg-tools" }, edit, del);
  }

  function renderContent(m: Message): Node[] {
    const nodes: Node[] = [];
    if (editing?.id === m.id) {
      nodes.push(editing.box, h("div", { class: "edit-hint" }, "Escape to cancel, Enter to save"));
    } else {
      const body = renderMarkup(m.content, {
        mention: (id) => mentionPill(id, opts.people, (pill, user) => mentionMenu(pill, user)),
        spoilers: spoilersOf(m),
      });
      if (m.editedAt) {
        const edited = h("span", { class: "edited", title: full(new Date(m.editedAt)) }, "(edited)");
        // On the last line of text, or on its own line after a code block.
        const last = body.lastElementChild;
        if (last instanceof HTMLParagraphElement || last instanceof HTMLQuoteElement) last.append(" ", edited);
        else body.append(h("p", {}, edited));
      }
      nodes.push(body);
    }
    if (rowError?.id === m.id) nodes.push(h("div", { class: "row-error" }, rowError.text));
    return nodes;
  }

  function spoilersOf(m: Message) {
    const seen = () => {
      const entry = revealed.get(m.id);
      return entry?.content === m.content ? entry.spoilers : null;
    };
    return {
      isRevealed: (index: number) => seen()?.has(index) ?? false,
      reveal: (index: number) => {
        let spoilers = seen();
        if (!spoilers) revealed.set(m.id, { content: m.content, spoilers: (spoilers = new Set()) });
        spoilers.add(index);
      },
    };
  }

  // A mention pill opens the same menu as the person's name: on right click, on click, or with Enter.
  function mentionMenu(pill: HTMLElement, user: Author) {
    pill.tabIndex = 0;
    pill.setAttribute("role", "button");
    attachMenu(pill, () => opts.authorMenu(user));
    pill.addEventListener("click", (e) => openMenu(e.clientX, e.clientY, opts.authorMenu(user)));
    pill.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const r = pill.getBoundingClientRect();
      openMenu(r.left, r.bottom, opts.authorMenu(user), true);
    });
  }

  function messageMenu(m: Message): MenuItem[] {
    const items: MenuItem[] = [{ label: "Copy text", action: () => copyText(plainText(m.content, opts.people)) }];
    if (m.author.id === me.id) {
      // The row may have been re-rendered or removed since the menu opened.
      const live = () => messages.find((x) => x.id === m.id);
      items.push(
        { label: "Edit", action: () => live() && startEdit(live()!) },
        { label: "Delete", danger: true, action: () => live() && void onDelete(live()!) },
      );
    }
    return items;
  }

  function renderMessage(m: Message, cont: boolean): HTMLElement {
    const date = new Date(m.createdAt);
    const mine = m.author.id === me.id;
    const row = h("div", {
      class: `msg${cont ? " cont" : ""}${confirmDelete?.id === m.id ? " confirming" : ""}${editing?.id === m.id ? " editing" : ""}${mentionsMe(m, me.id) ? " mentioned" : ""}`,
    });
    const timeEl = h("time", { datetime: m.createdAt, title: full(date) }, cont ? clock(date) : stamp(date));
    if (cont) {
      row.append(timeEl, h("div", { class: "body" }, ...renderContent(m)));
    } else {
      const name = h("span", { class: "author" }, m.author.displayName);
      const pic = avatar(m.author);
      for (const target of [name, pic]) attachMenu(target, () => opts.authorMenu(m.author));
      const head = h("div", { class: "head" }, name, timeEl);
      row.append(pic, h("div", { class: "body" }, head, ...renderContent(m)));
    }
    if (mine && editing?.id !== m.id) row.append(renderTools(m));
    if (editing?.id !== m.id) attachMenu(row, () => messageMenu(m));
    return row;
  }

  function renderWelcome(): HTMLElement {
    const other = channel!.other;
    if (channel!.kind === "dm" && other) {
      return h(
        "div",
        { class: "welcome" },
        avatar(other, { size: "lg" }),
        h("h1", {}, other.displayName),
        h("p", {}, `This is the beginning of your direct messages with ${other.displayName}.`),
      );
    }
    const name = channel!.name ?? "";
    return h(
      "div",
      { class: "welcome" },
      h("div", { class: "big-hash" }, icon("hash")),
      h("h1", {}, `Welcome to #${name}!`),
      h("p", {}, channel!.topic ?? `This is the start of the #${name} channel.`),
    );
  }

  function render(mode: ScrollMode) {
    const oldTop = el.scrollTop;
    const oldHeight = el.scrollHeight;
    const stick = mode === "bottom" || (mode === "auto" && isNearBottom());
    const editFocused = editing !== null && document.activeElement === editing.box;
    const selection = editing ? ([editing.box.selectionStart, editing.box.selectionEnd] as const) : null;

    const frag = document.createDocumentFragment();
    if (!channel) {
      frag.append(h("div", { class: "empty" }, "No channels yet. Create one with the + in the sidebar."));
    } else if (loading && messages.length === 0) {
      frag.append(h("div", { class: "empty" }, "Loading messages…"));
    } else if (loadError && messages.length === 0) {
      frag.append(h("div", { class: "empty error-text" }, loadError));
    } else {
      if (!hasMore) frag.append(renderWelcome());
      let prev: Message | undefined;
      for (const m of messages) {
        const date = new Date(m.createdAt);
        const newDay = !prev || dayKey(new Date(prev.createdAt)) !== dayKey(date);
        if (newDay) frag.append(h("div", { class: "divider", role: "separator" }, day(date)));
        const cont = !newDay && prev!.author.id === m.author.id && time(m) - time(prev!) < GROUP_WINDOW;
        frag.append(renderMessage(m, cont));
        prev = m;
      }
    }
    el.replaceChildren(frag);

    if (stick) el.scrollTop = el.scrollHeight;
    else if (mode === "prepend") el.scrollTop = oldTop + (el.scrollHeight - oldHeight);
    else el.scrollTop = oldTop;

    // Re-attaching the edit box blurs it.
    if (editing && editFocused) {
      editing.box.focus();
      if (selection) editing.box.setSelectionRange(selection[0], selection[1]);
    }
  }

  function remove(id: string) {
    const before = messages.length;
    messages = messages.filter((m) => m.id !== id);
    if (messages.length === before) return;
    if (editing?.id === id) {
      editing.picker.close();
      editing = null;
    }
    if (confirmDelete?.id === id) clearConfirm();
    if (rowError?.id === id) rowError = null;
    render("auto");
  }

  return {
    el,

    async open(next: Channel | null) {
      const gen = ++generation;
      channel = next;
      messages = [];
      revealed.clear();
      hasMore = false;
      loadError = null;
      loadingOlder = false;
      editing?.picker.close();
      editing = null;
      rowError = null;
      clearConfirm();
      loading = next !== null;
      render("bottom");
      if (!next) return;
      await loadLatest(gen);
      if (gen !== generation) return;
      render("bottom");
      fillScreen();
    },

    // After a reconnect: the latest page replaces what we have, since we may have missed events.
    async reload() {
      if (!channel) return;
      const gen = ++generation;
      loadingOlder = false;
      loading = true;
      await loadLatest(gen);
      if (gen !== generation) return;
      if (editing && !messages.some((m) => m.id === editing!.id)) {
        editing.picker.close();
        editing = null;
      }
      render("auto");
      fillScreen();
    },

    // Members loaded or changed, so mention names may read differently now.
    refresh() {
      render("auto");
    },

    // Channel name or topic changed.
    setChannel(next: Channel) {
      if (channel?.id !== next.id) return;
      channel = next;
      render("keep");
    },

    add(m: Message) {
      if (!channel || m.channelId !== channel.id) return;
      arrivedDuringLoad?.push(m);
      if (loading && messages.length === 0) return;
      insert(m);
      // Your own message always scrolls into view.
      render(m.author.id === me.id ? "bottom" : "auto");
    },

    update(m: Message) {
      if (!channel || m.channelId !== channel.id) return;
      const i = messages.findIndex((x) => x.id === m.id);
      if (i < 0) return;
      messages[i] = m;
      render("auto");
    },

    remove(id: string, channelId: string) {
      if (channel?.id === channelId) remove(id);
    },
  };
}
