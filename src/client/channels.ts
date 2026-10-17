import type { Channel } from "./types.ts";

// "#general" or "@mira".
export function channelLabel(c: Channel): string {
  return c.kind === "dm" ? `@${c.other?.displayName ?? "unknown"}` : `#${c.name ?? ""}`;
}

export function channelLink(c: Channel): string {
  return `${location.origin}/#/channels/${encodeURIComponent(c.id)}`;
}

const byName = (a: Channel, b: Channel) => (a.name ?? "").localeCompare(b.name ?? "");

// Text channels by name, DMs by latest activity (newest first), as the server sends them.
export function createChannelStore() {
  let text: Channel[] = [];
  let dms: Channel[] = [];

  return {
    get text() {
      return text;
    },
    get dms() {
      return dms;
    },

    all: () => [...text, ...dms],

    find: (id: string) => text.find((c) => c.id === id) ?? dms.find((c) => c.id === id),

    set(list: Channel[]) {
      text = list.filter((c) => c.kind !== "dm").sort(byName);
      dms = list.filter((c) => c.kind === "dm");
    },

    // Returns false if we already had it. A new DM is the latest activity, so it goes on top.
    add(c: Channel): boolean {
      if (text.some((x) => x.id === c.id) || dms.some((x) => x.id === c.id)) return false;
      if (c.kind === "dm") dms = [c, ...dms];
      else text = [...text, c].sort(byName);
      return true;
    },

    // A message arrived in this channel.
    touch(c: Channel, messageId: string) {
      c.lastMessageId = messageId;
      if (c.kind === "dm" && dms[0] !== c) dms = [c, ...dms.filter((x) => x !== c)];
    },

    dmUnread: () => dms.reduce((n, c) => n + c.unreadCount, 0),
    textMentions: () => text.reduce((n, c) => n + c.mentionCount, 0),
  };
}

export type ChannelStore = ReturnType<typeof createChannelStore>;
