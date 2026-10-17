import { api } from "./api.ts";
import { startApp } from "./app.ts";
import { showLogin } from "./login.ts";

const root = document.getElementById("app")!;
const me = await api.me().catch(() => null);

if (me) {
  // Drop ?error= from a previous failed login, keep the channel in the hash.
  history.replaceState(null, "", `/${location.hash}`);
  await startApp(root, me);
} else {
  showLogin(root);
}
