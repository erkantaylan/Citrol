import { attachMenu, type MenuItem } from "./context-menu.ts";
import { avatar, h, icon } from "./dom.ts";
import { createMascot } from "./mascot.ts";
import type { Channel, Me } from "./types.ts";

type Options = {
  me: Me;
  select: (channel: Channel) => void;
  create: (name: string) => Promise<Channel>;
  menu: (channel: Channel) => MenuItem[];
  logout: () => void;
  // Extra buttons in the user panel, left of "Log out".
  tools?: Node[];
};

const BADGE_MAX = 99;

// Turn what people naturally type ("Bun Questions") into a valid name ("bun-questions").
function toChannelName(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 32);
}

export function createSidebar(opts: Options) {
  const list = h("div", { class: "channel-list" });
  const dmList = h("div", { class: "channel-list" });

  // ---------- create channel (inline) ----------
  const input = h("input", {
    type: "text",
    placeholder: "new-channel",
    maxlength: "32",
    "aria-label": "New channel name",
    autocomplete: "off",
    spellcheck: "false",
  });
  const createError = h("div", { class: "row-error" });
  const form = h("div", { class: "new-channel", hidden: true }, h("div", { class: "new-channel-box" }, icon("hash"), input), createError);
  const addBtn = h("button", { type: "button", title: "Create channel", "aria-label": "Create channel" }, icon("plus"));
  let creating = false;

  function openForm() {
    form.hidden = false;
    input.value = "";
    createError.textContent = "";
    input.focus();
  }

  function closeForm() {
    form.hidden = true;
    input.value = "";
    createError.textContent = "";
  }

  // Keep focus in the input, otherwise its blur closes the form before this click toggles it.
  addBtn.addEventListener("mousedown", (e) => e.preventDefault());
  addBtn.addEventListener("click", () => (form.hidden ? openForm() : closeForm()));
  input.addEventListener("input", () => {
    const clean = toChannelName(input.value);
    if (clean !== input.value) input.value = clean;
    createError.textContent = "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeForm();
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });
  input.addEventListener("blur", () => {
    if (!input.value && !creating) closeForm();
  });
  async function submit() {
    const name = input.value.replace(/^-+|-+$/g, "");
    if (!name || creating) return;
    creating = true;
    input.disabled = true;
    try {
      const channel = await opts.create(name);
      closeForm();
      opts.select(channel);
    } catch (err) {
      createError.textContent = err instanceof Error ? err.message : "Could not create the channel.";
    } finally {
      creating = false;
      input.disabled = false;
      if (!form.hidden) input.focus();
    }
  }

  // ---------- current user ----------
  const status = h("small", {}, "Online");
  const meAvatar = avatar(opts.me, { size: "sm", status: "online" });
  const logoutBtn = h("button", { class: "icon-btn", title: "Log out", "aria-label": "Log out" }, icon("logout"));
  logoutBtn.addEventListener("click", () => {
    logoutBtn.disabled = true;
    opts.logout();
  });

  const el = h(
    "aside",
    { class: "sidebar" },
    h("header", { class: "server-header" }, "Citrol"),
    h(
      "nav",
      { class: "channels", "aria-label": "Channels" },
      h("div", { class: "category" }, "Text channels", addBtn),
      form,
      list,
      h("div", { class: "category" }, "Direct messages"),
      dmList,
    ),
    createMascot(),
    h(
      "div",
      { class: "me" },
      meAvatar,
      h("div", { class: "who" }, h("b", {}, opts.me.displayName), status),
      ...(opts.tools ?? []),
      logoutBtn,
    ),
  );

  function row(c: Channel, active: boolean): HTMLButtonElement {
    const unread = c.unreadCount > 0;
    const dm = c.kind === "dm";
    const btn = h("button", {
      class: `channel${dm ? " dm" : ""}${active ? " active" : unread ? " unread" : ""}`,
      "aria-current": active ? "page" : undefined,
    });
    if (dm && c.other) btn.append(avatar(c.other, { size: "xs" }), h("span", {}, c.other.displayName));
    else btn.append(icon("hash"), h("span", {}, c.name ?? ""));
    if (dm && unread) {
      const count = c.unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : String(c.unreadCount);
      btn.append(h("i", { class: "badge", "aria-label": `${c.unreadCount} unread` }, count));
    }
    if (!dm && c.mentionCount > 0) {
      const count = c.mentionCount > BADGE_MAX ? `${BADGE_MAX}+` : String(c.mentionCount);
      btn.append(h("i", { class: "badge", "aria-label": `${c.mentionCount} mentions` }, `@${count}`));
    }
    if (c.topic) btn.title = c.topic;
    btn.addEventListener("click", () => opts.select(c));
    attachMenu(btn, () => opts.menu(c));
    return btn;
  }

  return {
    el,

    render(text: Channel[], dms: Channel[], currentId: string | null) {
      list.replaceChildren(...text.map((c) => row(c, c.id === currentId)));
      dmList.replaceChildren(
        ...(dms.length ? dms.map((c) => row(c, c.id === currentId)) : [h("div", { class: "hint" }, "No direct messages yet.")]),
      );
    },

    setConnected(connected: boolean) {
      status.textContent = connected ? "Online" : "Reconnecting…";
      meAvatar.querySelector(".status")?.classList.toggle("online", connected);
    },
  };
}
