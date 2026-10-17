import { sql } from "../db.ts";
import { config } from "../config.ts";

export const SESSION_COOKIE = "citrol_session";
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type User = {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
};

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

function hash(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function cookie(name: string, value: string, maxAgeSeconds: number, path = "/"): string {
  const parts = [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax"];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

// Returns the cookie value to send; only its hash is stored.
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await sql`insert into sessions (id, user_id, expires_at) values (${hash(token)}, ${userId}, ${expiresAt})`;
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 24 * 60 * 60);
}

export async function getUser(token: string | null | undefined): Promise<User | null> {
  if (!token) return null;
  const id = hash(token);
  const [row] = await sql`
    select u.id, u.username, u.display_name, u.avatar, s.expires_at
    from sessions s join users u on u.id = s.user_id
    where s.id = ${id} and s.expires_at > now()
  `;
  if (!row) return null;

  // Active users stay logged in: past the halfway point, push the expiry out again.
  if (row.expires_at.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
    await sql`update sessions set expires_at = ${new Date(Date.now() + SESSION_DAYS * DAY_MS)} where id = ${id}`;
  }
  return { id: row.id, username: row.username, display_name: row.display_name, avatar: row.avatar };
}

export async function deleteSession(token: string | null | undefined): Promise<string> {
  if (token) await sql`delete from sessions where id = ${hash(token)}`;
  return cookie(SESSION_COOKIE, "", 0);
}
