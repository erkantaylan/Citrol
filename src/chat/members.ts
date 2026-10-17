import type { User } from "../auth/session.ts";
import { sql } from "../db.ts";
import { isOnline } from "./gateway.ts";
import { type Author, authed, toAuthor } from "./http.ts";

export type Member = Author & { online: boolean };

// GET /api/members: everyone who has ever logged in, online first, then by name.
export const list = authed(async () => {
  const rows: User[] = await sql`select id, username, display_name, avatar from users`;
  const members: Member[] = rows.map((row) => ({ ...toAuthor(row), online: isOnline(row.id) }));
  members.sort(
    (a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
  return Response.json(members);
});
