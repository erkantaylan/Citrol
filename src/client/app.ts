import { api } from "./api.ts";
import { createComposer } from "./composer.ts";
import { h, icon } from "./dom.ts";
import { createMemberList } from "./members.ts";
import { createMessageList } from "./messages.ts";
import { createSidebar } from "./sidebar.ts";
import { connect } from "./socket.ts";
import type { Channel, Me, ServerEvent } from "./types.ts";

const byName = (a: Channel, b: Channel) => a.name.localeCompare(b.name);

export async function startApp(root: HTMLElement, me: Me) {
  let channels: Channel[] = [];
  let current: Channel | null = null;
  const unread = new Set<string>();

  // ---------- layout ----------
  const sidebar = createSidebar({
    me,
    select: (c) => {
      root.classList.remove("show-sidebar");
      location.hash = `#/channels/${encodeURIComponent(c.id)}`;
    },
    create: async (name) => {
      const channel = await api.createChannel(name);
      addChannel(channel);
      return channel;
    },
    logout: async () => {
      socket.close();
      await api.logout();
      location.replace("/");
    },
  });
  const messages = createMessageList(me);
  const composer = createComposer({
    send: async (channelId, content) => messages.add(await api.send(channelId, content)),
    typing: (channelId) => socket.send({ type: "typing", channelId }),
  });
  const members = createMemberList();

  const menuBtn = h("button", { class: "icon-btn menu", title: "Channels", "aria-label": "Show channels" }, icon("menu"));
  menuBtn.addEventListener("click", () => root.classList.toggle("show-sidebar"));
  const headerName = h("span", { class: "name" });
  const headerTopic = h("span", { class: "topic" });
  const header = h("header", { class: "chat-header" }, menuBtn, icon("hash", "hash"), headerName, headerTopic);
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

  function renderSidebar() {
    sidebar.render(channels, current?.id ?? null, unread);
  }

  function renderHeader() {
    headerName.textContent = current?.name ?? "";
    headerTopic.textContent = current?.topic ?? "";
    headerTopic.title = current?.topic ?? "";
    headerTopic.hidden = !current?.topic;
    document.title = current ? `#${current.name} · Citrol` : "Citrol";
  }

  function addChannel(channel: Channel) {
    if (channels.some((c) => c.id === channel.id)) return;
    channels = [...channels, channel].sort(byName);
    renderSidebar();
    if (!current) route();
  }

  // ---------- routing: #/channels/<id> ----------
  function route() {
    const match = location.hash.match(/^#\/channels\/(.+)$/);
    const wanted = match ? decodeURIComponent(match[1]!) : null;
    const channel =
      channels.find((c) => c.id === wanted) ?? channels.find((c) => c.name === "general") ?? channels[0] ?? null;
    if (channel && channel.id !== wanted) {
      history.replaceState(null, "", `#/channels/${encodeURIComponent(channel.id)}`);
    }
    if (channel?.id === current?.id && channel !== null) return;
    current = channel;
    if (channel) unread.delete(channel.id);
    renderSidebar();
    renderHeader();
    composer.setChannel(channel);
    void messages.open(channel);
    composer.focus();
  }

  window.addEventListener("hashchange", route);

  async function loadChannels() {
    channels = (await api.channels()).sort(byName);
    // The open channel may have been renamed; keep our object in step.
    if (current) {
      const fresh = channels.find((c) => c.id === current!.id);
      if (fresh) {
        current = fresh;
        messages.setChannel(fresh);
        renderHeader();
      }
    }
    renderSidebar();
    route();
  }

  async function loadMembers() {
    members.set(await api.members());
  }

  // ---------- live events ----------
  function onEvent(e: ServerEvent) {
    switch (e.type) {
      case "ready":
        members.setOnline(e.online);
        break;
      case "message_created": {
        const m = e.message;
        composer.stopTyping(m.channelId, m.author.id);
        if (m.channelId === current?.id) messages.add(m);
        else if (m.author.id !== me.id && !unread.has(m.channelId)) {
          unread.add(m.channelId);
          renderSidebar();
        }
        break;
      }
      case "message_updated":
        messages.update(e.message);
        break;
      case "message_deleted":
        messages.remove(e.id, e.channelId);
        break;
      case "channel_created":
        addChannel(e.channel);
        break;
      case "presence":
        if (!members.presence(e.userId, e.online, e.member)) void loadMembers().catch(() => {});
        break;
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
