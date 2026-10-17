import type { BunRequest } from "bun";
import { avatarUrl } from "../auth/discord.ts";
import { SESSION_COOKIE, getUser, type User } from "../auth/session.ts";

export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// Wraps a handler so it only runs with a logged-in user; everyone else gets 401.
export function authed<T extends string>(handler: (req: BunRequest<T>, user: User) => Promise<Response>) {
  return async (req: BunRequest<T>): Promise<Response> => {
    const user = await getUser(req.cookies.get(SESSION_COOKIE));
    if (!user) return fail(401, "not logged in");
    return handler(req, user);
  };
}

// Parses a JSON object body, or returns null if it isn't one.
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// Ids are Postgres bigints; anything else can't exist, and a 19+ digit string could overflow.
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,18}$/.test(value);
}

export type Author = { id: string; displayName: string; avatarUrl: string };

export function toAuthor(user: Pick<User, "id" | "username" | "display_name" | "avatar">): Author {
  return { id: user.id, displayName: user.display_name ?? user.username, avatarUrl: avatarUrl(user) };
}
