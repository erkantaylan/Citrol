type Me = { id: string; username: string; displayName: string; avatarUrl: string };

const app = document.getElementById("app")!;

const errors: Record<string, string> = {
  denied: "Login was cancelled on Discord.",
  state: "Login expired or was started in another tab. Try again.",
  not_member: "Only members of our Discord server can log in.",
};

// Everything put into innerHTML goes through this, including attribute values.
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showLogin() {
  const code = new URLSearchParams(location.search).get("error");
  const error = code ? (errors[code] ?? "Login failed. Try again.") : null;
  app.innerHTML = `
    <h1>Citrol</h1>
    <p class="muted">Text chat for our class.</p>
    ${error ? `<div class="error">${escape(error)}</div>` : ""}
    <a class="button primary" href="/auth/discord">Login with Discord</a>
  `;
}

function showMe(me: Me) {
  app.innerHTML = `
    <img class="avatar" src="${escape(me.avatarUrl)}" alt="">
    <h1>${escape(me.displayName)}</h1>
    <p class="muted">You're logged in. Channels are coming soon.</p>
    <button class="secondary" id="logout">Log out</button>
  `;
  document.getElementById("logout")!.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    location.replace("/");
  });
}

const res = await fetch("/api/me");
if (res.ok) {
  history.replaceState(null, "", "/");
  showMe(await res.json());
} else {
  showLogin();
}
