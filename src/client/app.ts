import { api } from "./api.ts";
import { channelLabel, channelLink, createChannelStore } from "./channels.ts";
import { createComposer } from "./composer.ts";
import type { MenuItem } from "./context-menu.ts";
import { avatar, h, icon } from "./dom.ts";
import { createMemberList } from "./members.ts";
import { mentionable, mentionsMe, plainText } from "./mentions.ts";
import { createMessageList } from "./messages.ts";
import { createNotifyButton, dismiss, notify } from "./notify.ts";
import { createSidebar } from "./sidebar.ts";
import { connect } from "./socket.ts";
import { copyText, toast } from "./toast.ts";
import type { Author, Channel, Me, Message, ServerEvent } from "./types.ts";

const READ_DEBOUNCE = 500;

export async function startApp(root: HTMLElement, me: Me) {
  const store = createChannelStore();
  let current: Channel | null = null;

  // ---------- menus shared by several parts ----------
  function memberMenu(user: Author): MenuItem[] {
    const items: MenuItem[] = [];
    if (user.id !== me.id) items.push({ label: "Message", action: () => void openDm(user) });
    items.push({ label: "Copy username", action: () => copyText(user.username) });
    return items;
  }

  function channelMenu(c: Channel): MenuItem[] {
    return [
      { label: "Mark as read", disabled: c.unreadCount === 0, action: () => markRead(c) },
      { label: "Copy link", action: () => copyText(channelLink(c)) },
    ];
  }

  // ---------- layout ----------
  const sidebar = createSidebar({
    me,
    select,
    create: async (name) => {
      const channel = await api.createChannel(name);
      addChannel(channel);
      return channel;
    },
    menu: channelMenu,
    logout: async () => {
      socket.close();
      await api.logout();
      location.replace("/");
    },
    tools: [createNotifyButton()],
  });
  // The user behind a mention token; a DM partner counts even before the member list has loaded.
  const person = (id: string): Author | undefined =>
    members.get(id) ?? (id === me.id ? me : store.dms.find((c) => c.other?.id === id)?.other ?? undefined);
  const candidates = () => mentionable(current, me.id, members.list());
  const messages = createMessageList(me, { authorMenu: memberMenu, people: person, candidates });
  const composer = createComposer({
    send: async (channelId, content) => messages.add(await api.send(channelId, content)),
    typing: (channelId) => socket.send({ type: "typing", channelId }),
    candidates,
  });
  const members = createMemberList({ me, open: (m) => void openDm(m), menu: memberMenu });

  const menuBtn = h("button", { class: "icon-btn menu", title: "Channels", "aria-label": "Show channels" }, icon("menu"));
  menuBtn.addEventListener("click", () => root.classList.toggle("show-sidebar"));
  const hash = icon("hash", "hash");
  const headerAvatar = h("span", { class: "header-avatar", hidden: true });
  const headerName = h("span", { class: "name" });
  const headerTopic = h("span", { class: "topic" });
  const header = h("header", { class: "chat-header" }, menuBtn, hash, headerAvatar, headerName, headerTopic);
  const reconnecting = h("div", { class: "reconnecting", role: "status", hidden: true }, "Reconnecting…");
  const scrim = h("div", { class: "scrim" });
  scrim.addEventListener("click", () => root.classList.remove("show-sidebar"));

  document.body.className = "chat-page";
  root.className = "layout";
  root.replaceChildren(
    sidebar.el,
    h("main", { class: "chat" }, reconnecting, header, messages.el, composer.el),
    members.el,
    scrim,
  );

  function renderTitle() {
    const unread = store.dmUnread() + store.textMentions();
    const where = current ? `${channelLabel(current)} · ` : "";
    document.title = `${unread ? `(${unread}) ` : ""}${where}Citrol`;
  }

  function renderSidebar() {
    sidebar.render(store.text, store.dms, current?.id ?? null);
    renderTitle();
  }

  function renderHeader() {
    const dm = current?.kind === "dm" ? current.other : null;
    hash.style.display = dm ? "none" : "";
    headerAvatar.hidden = !dm;
    headerAvatar.replaceChildren(...(dm ? [avatar(dm, { size: "xs" })] : []));
    headerName.textContent = dm ? dm.displayName : (current?.name ?? "");
    const topic = dm ? null : (current?.topic ?? null);
    headerTopic.textContent = topic ?? "";
    headerTopic.title = topic ?? "";
    headerTopic.hidden = !topic;
    renderTitle();
  }

  function select(c: Channel) {
    root.classList.remove("show-sidebar");
    location.hash = `#/channels/${encodeURIComponent(c.id)}`;
  }

  function addChannel(channel: Channel) {
    if (!store.add(channel)) return;
    renderSidebar();
    if (!current) route();
  }

  async function openDm(user: Author) {
    const known = store.dms.find((c) => c.other?.id === user.id);
    if (known) return select(known);
    try {
      const dm = await api.openDm(user.id);
      addChannel(dm);
      select(store.find(dm.id) ?? dm);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not open the conversation.");
    }
  }

  // ---------- read state ----------
  // channelId -> newest message id to report, sent together after a short pause.
  const pendingReads = new Map<string, string>();
  let readTimer: ReturnType<typeof setTimeout> | undefined;

  function markRead(c: Channel) {
    dismiss(c.id);
    if (c.unreadCount !== 0 || c.mentionCount !== 0) {
      c.unreadCount = 0;
      c.mentionCount = 0;
      renderSidebar();
    }
    if (!c.lastMessageId) return;
    pendingReads.set(c.id, c.lastMessageId);
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      for (const [channelId, messageId] of pendingReads) void api.markRead(channelId, messageId).catch(() => {});
      pendingReads.clear();
    }, READ_DEBOUNCE);
  }

  // The open channel counts as read only while someone can see it.
  function readIfLooking() {
    if (current && current.unreadCount > 0 && !document.hidden) markRead(current);
  }

  document.addEventListener("visibilitychange", readIfLooking);

  // ---------- routing: #/channels/<id> ----------
  function route() {
    const match = location.hash.match(/^#\/channels\/(.+)$/);
    const wanted = match ? decodeURIComponent(match[1]!) : null;
    const channel =
      store.find(wanted ?? "") ?? store.text.find((c) => c.name === "general") ?? store.all()[0] ?? null;
    if (channel && channel.id !== wanted) {
      history.replaceState(null, "", `#/channels/${encodeURIComponent(channel.id)}`);
    }
    if (channel?.id === current?.id && channel !== null) return;
    current = channel;
    renderSidebar();
    renderHeader();
    composer.setChannel(channel);
    void messages.open(channel);
    composer.focus();
    readIfLooking();
  }

  window.addEventListener("hashchange", route);

  // Several reloads can overlap (reconnect, unknown channel); only the newest answer counts.
  let channelsRequest = 0;
  async function loadChannels() {
    const request = ++channelsRequest;
    const list = await api.channels();
    if (request !== channelsRequest) return;
    store.set(list);
    // The open channel may have been renamed; keep our object in step.
    if (current) {
      const fresh = store.find(current.id);
      if (fresh) {
        current = fresh;
        messages.setChannel(fresh);
        renderHeader();
      }
    }
    renderSidebar();
    route();
    readIfLooking();
  }

  async function loadMembers() {
    members.set(await api.members());
    messages.refresh();
  }

  // ---------- live events ----------
  // Every DM message, and in text channels the ones that mention me.
  function maybeNotify(c: Channel, m: Message) {
    if (m.author.id === me.id) return;
    if (c.kind !== "dm" && !mentionsMe(m, me.id)) return;
    if (!document.hidden && current?.id === c.id) return;
    notify({
      title: c.kind === "dm" ? m.author.displayName : `#${c.name ?? ""} · ${m.author.displayName}`,
      body: plainText(m.content, person),
      icon: m.author.avatarUrl,
      tag: c.id,
      onClick: () => select(store.find(c.id) ?? c),
    });
  }

  function onMessage(m: Message) {
    composer.stopTyping(m.channelId, m.author.id);
    const c = store.find(m.channelId);
    if (!c) {
      // Most likely the first message of a new DM; the reloaded list already counts it as unread.
      void loadChannels().then(() => {
        const fresh = store.find(m.channelId);
        if (fresh) maybeNotify(fresh, m);
      }, () => {});
      return;
    }
    store.touch(c, m.id);
    if (c.id === current?.id) messages.add(m);
    if (m.author.id !== me.id) {
      c.unreadCount++;
      if (mentionsMe(m, me.id)) c.mentionCount++;
    }
    renderSidebar();
    readIfLooking();
    maybeNotify(c, m);
  }

  function onEvent(e: ServerEvent) {
    switch (e.type) {
      case "ready":
        members.setOnline(e.online);
        break;
      case "message_created":
        onMessage(e.message);
        break;
      case "message_updated":
        messages.update(e.message);
        break;
      case "message_deleted": {
        messages.remove(e.id, e.channelId);
        // An unread or the newest message went away; the server has the right count and newest id.
        const c = store.find(e.channelId);
        if (c && (c.unreadCount > 0 || c.lastMessageId === e.id)) void loadChannels().catch(() => {});
        break;
      }
      case "channel_created":
        addChannel(e.channel);
        break;
      case "read": {
        // Read in another tab (or this one).
        const c = store.find(e.channelId);
        if (!c) break;
        dismiss(c.id);
        if (c.unreadCount === 0) break;
        // Newer messages may have come in since; then only the server knows how many.
        if (e.messageId === c.lastMessageId) {
          c.unreadCount = 0;
          c.mentionCount = 0;
          renderSidebar();
        } else {
          void loadChannels().catch(() => {});
        }
        break;
      }
      case "presence": {
        const isNew = !members.get(e.userId);
        if (!members.presence(e.userId, e.online, e.member)) void loadMembers().catch(() => {});
        // Mentions of someone we just learned about can show their name now.
        else if (isNew) messages.refresh();
        break;
      }
      case "typing":
        if (e.userId !== me.id) composer.typing(e.channelId, e.userId, e.displayName);
        break;
    }
  }

  let failures = 0;
  const socket = connect({
    onEvent,
    onOpen: (again) => {
      failures = 0;
      reconnecting.hidden = true;
      sidebar.setConnected(true);
      if (!again) return;
      // We may have missed events while we were away.
      void loadChannels().catch(() => {});
      void messages.reload();
      void loadMembers().catch(() => {});
    },
    onClose: () => {
      reconnecting.hidden = false;
      sidebar.setConnected(false);
      // A refused upgrade looks the same as a dropped connection; check whether we're still logged in.
      if (++failures % 3 === 0) {
        void fetch("/api/me").then((res) => {
          if (res.status === 401) location.replace("/");
        }, () => {});
      }
    },
  });

  try {
    await Promise.all([loadChannels(), loadMembers()]);
  } catch (err) {
    messages.el.replaceChildren(
      h("div", { class: "empty error-text" }, err instanceof Error ? err.message : "Could not load Citrol."),
    );
  }
}
