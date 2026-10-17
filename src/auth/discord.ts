import type { BunRequest } from "bun";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { cookie, createSession, randomToken } from "./session.ts";

const API = "https://discord.com/api/v10";
const STATE_COOKIE = "oauth_state";
const VERIFIER_COOKIE = "oauth_verifier";
const COOKIE_PATH = "/auth/discord";

type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null };

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function fail(reason: string): Response {
  console.log(`login failed: ${reason}`);
  return redirect(`/?error=${reason}`, [cookie(STATE_COOKIE, "", 0, COOKIE_PATH), cookie(VERIFIER_COOKIE, "", 0, COOKIE_PATH)]);
}

// GET /auth/discord: send the browser to Discord's consent screen.
export function startLogin(): Response {
  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");

  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    scope: config.discord.guildId ? "identify guilds.members.read" : "identify",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  return redirect(url.toString(), [
    cookie(STATE_COOKIE, state, 600, COOKIE_PATH),
    cookie(VERIFIER_COOKIE, verifier, 600, COOKIE_PATH),
  ]);
}

// GET /auth/discord/callback: Discord sends the browser back here with a code.
export async function callback(req: BunRequest): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return fail("denied");

  const state = req.cookies.get(STATE_COOKIE);
  const verifier = req.cookies.get(VERIFIER_COOKIE);
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return fail("state");

  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${config.discord.clientId}:${config.discord.clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.discord.redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail(`token_${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${access_token}` };

  const meRes = await fetch(`${API}/users/@me`, { headers: auth });
  if (!meRes.ok) return fail(`user_${meRes.status}`);
  const me = (await meRes.json()) as DiscordUser;

  if (config.discord.guildId) {
    const memberRes = await fetch(`${API}/users/@me/guilds/${config.discord.guildId}/member`, { headers: auth });
    if (!memberRes.ok) return fail("not_member");
  }

  // Name and avatar can change on Discord, so refresh them on every login.
  await sql`
    insert into users (id, username, display_name, avatar)
    values (${me.id}, ${me.username}, ${me.global_name}, ${me.avatar})
    on conflict (id) do update set
      username = excluded.username,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      last_login_at = now()
  `;

  return redirect("/", [
    await createSession(me.id),
    cookie(STATE_COOKIE, "", 0, COOKIE_PATH),
    cookie(VERIFIER_COOKIE, "", 0, COOKIE_PATH),
  ]);
}

export function avatarUrl(user: { id: string; avatar: string | null }): string {
  if (!user.avatar) return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}
