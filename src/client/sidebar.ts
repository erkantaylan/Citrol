import { avatar, h, icon } from "./dom.ts";
import type { Channel, Me } from "./types.ts";

type Options = {
  me: Me;
  select: (channel: Channel) => void;
  create: (name: string) => Promise<Channel>;
  logout: () => void;
};

// Turn what people naturally type ("Bun Questions") into a valid name ("bun-questions").
function toChannelName(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 32);
}

export function createSidebar(opts: Options) {
  const list = h("div", { class: "channel-list" });

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
  const meAvatar = avatar(opts.me, { small: true, status: "online" });
  const logoutBtn = h("button", { class: "icon-btn", title: "Log out", "aria-label": "Log out" }, icon("logout"));
  logoutBtn.addEventListener("click", () => {
    logoutBtn.disabled = true;
    opts.logout();
  });

  const el = h(
    "aside",
    { class: "sidebar" },
    h("header", { class: "server-header" }, "Citrol"),
    h("nav", { class: "channels", "aria-label": "Channels" }, h("div", { class: "category" }, "Text channels", addBtn), form, list),
    h(
      "div",
      { class: "me" },
      meAvatar,
      h("div", { class: "who" }, h("b", {}, opts.me.displayName), status),
      logoutBtn,
    ),
  );

  return {
    el,

    render(channels: Channel[], currentId: string | null, unread: Set<string>) {
      list.replaceChildren(
        ...channels.map((c) => {
          const active = c.id === currentId;
          const btn = h(
            "button",
            {
              class: `channel${active ? " active" : unread.has(c.id) ? " unread" : ""}`,
              "aria-current": active ? "page" : undefined,
            },
            icon("hash"),
            h("span", {}, c.name),
          );
          if (c.topic) btn.title = c.topic;
          btn.addEventListener("click", () => opts.select(c));
          return btn;
        }),
      );
    },

    setConnected(connected: boolean) {
      status.textContent = connected ? "Online" : "Reconnecting…";
      meAvatar.querySelector(".status")?.classList.toggle("online", connected);
    },
  };
}
