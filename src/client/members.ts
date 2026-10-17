import { avatar, h } from "./dom.ts";
import type { Member } from "./types.ts";

export function createMemberList() {
  const el = h("aside", { class: "members", "aria-label": "Members" });
  const members = new Map<string, Member>();

  function row(m: Member): HTMLElement {
    return h(
      "div",
      { class: `member${m.online ? "" : " offline"}` },
      avatar(m, { small: true, status: m.online ? "online" : "offline" }),
      h("div", { class: "who" }, h("b", {}, m.displayName)),
    );
  }

  function render() {
    const all = [...members.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
    const online = all.filter((m) => m.online);
    const offline = all.filter((m) => !m.online);
    el.replaceChildren(
      h("h3", {}, `Online — ${online.length}`),
      ...online.map(row),
      ...(offline.length ? [h("h3", {}, `Offline — ${offline.length}`), ...offline.map(row)] : []),
    );
  }

  return {
    el,

    set(list: Member[]) {
      members.clear();
      for (const m of list) members.set(m.id, m);
      render();
    },

    // From the socket's `ready` event.
    setOnline(ids: string[]) {
      const online = new Set(ids);
      for (const m of members.values()) m.online = online.has(m.id);
      render();
    },

    // Returns false if we don't know this user yet and got no details, so the caller can refetch.
    presence(userId: string, online: boolean, member?: Member): boolean {
      const known = members.get(userId);
      if (known) known.online = online;
      else if (member) members.set(userId, { ...member, online });
      else return false;
      render();
      return true;
    },
  };
}
