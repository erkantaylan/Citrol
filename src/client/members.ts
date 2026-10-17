import { attachMenu, type MenuItem } from "./context-menu.ts";
import { avatar, h } from "./dom.ts";
import type { Me, Member } from "./types.ts";

type Options = {
  me: Me;
  // Click on someone else: open the DM with them.
  open: (member: Member) => void;
  menu: (member: Member) => MenuItem[];
};

export function createMemberList(opts: Options) {
  const el = h("aside", { class: "members", "aria-label": "Members" });
  const members = new Map<string, Member>();

  function row(m: Member): HTMLElement {
    const self = m.id === opts.me.id;
    // You can't message yourself, so your own entry isn't a button.
    const r = h(
      self ? "div" : "button",
      { class: `member${m.online ? "" : " offline"}`, title: self ? undefined : `Message ${m.displayName}` },
      avatar(m, { size: "sm", status: m.online ? "online" : "offline" }),
      h("div", { class: "who" }, h("b", {}, m.displayName)),
    );
    if (!self) r.addEventListener("click", () => opts.open(m));
    attachMenu(r, () => opts.menu(m));
    return r;
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

    get: (id: string) => members.get(id),
    list: () => [...members.values()],

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
