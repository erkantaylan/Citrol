import { api, PAGE_SIZE } from "./api.ts";
import { autosize, avatar, h, icon } from "./dom.ts";
import { clock, day, dayKey, full, stamp } from "./format.ts";
import type { Channel, Me, Message } from "./types.ts";

const GROUP_WINDOW = 5 * 60 * 1000;
const NEAR_BOTTOM = 80;
const LOAD_OLDER_AT = 200;
const CONFIRM_TIMEOUT = 4000;

type ScrollMode = "bottom" | "auto" | "keep" | "prepend";

export function createMessageList(me: Me) {
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

  let editing: { id: string; box: HTMLTextAreaElement; saving: boolean } | null = null;
  let confirmDelete: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let rowError: { id: string; text: string } | null = null;

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
    box.value = m.content;
    editing = { id: m.id, box, saving: false };
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
    editing = null;
    rowError = null;
    render("keep");
  }

  async function saveEdit() {
    if (!editing || editing.saving) return;
    const current = editing;
    const original = messages.find((m) => m.id === current.id);
    const content = current.box.value.trim();
    if (original && content === original.content) return stopEdit();
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
      const p = h("p", {}, m.content);
      if (m.editedAt) {
        p.append(" ", h("span", { class: "edited", title: full(new Date(m.editedAt)) }, "(edited)"));
      }
      nodes.push(p);
    }
    if (rowError?.id === m.id) nodes.push(h("div", { class: "row-error" }, rowError.text));
    return nodes;
  }

  function renderMessage(m: Message, cont: boolean): HTMLElement {
    const date = new Date(m.createdAt);
    const mine = m.author.id === me.id;
    const row = h("div", {
      class: `msg${cont ? " cont" : ""}${confirmDelete?.id === m.id ? " confirming" : ""}${editing?.id === m.id ? " editing" : ""}`,
    });
    const timeEl = h("time", { datetime: m.createdAt, title: full(date) }, cont ? clock(date) : stamp(date));
    if (cont) {
      row.append(timeEl, h("div", { class: "body" }, ...renderContent(m)));
    } else {
      const head = h("div", { class: "head" }, h("span", { class: "author" }, m.author.displayName), timeEl);
      row.append(avatar(m.author), h("div", { class: "body" }, head, ...renderContent(m)));
    }
    if (mine && editing?.id !== m.id) row.append(renderTools(m));
    return row;
  }

  function renderWelcome(): HTMLElement {
    const name = channel!.name;
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
    if (editing?.id === id) editing = null;
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
      hasMore = false;
      loadError = null;
      loadingOlder = false;
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
      if (editing && !messages.some((m) => m.id === editing!.id)) editing = null;
      render("auto");
      fillScreen();
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
