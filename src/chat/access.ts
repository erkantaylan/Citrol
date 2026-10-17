import { sql } from "../db.ts";
import { isId } from "./http.ts";

// Who may see a channel: every text channel, and only the DMs you're in.
// The one place this rule lives; queries use it on a channels table aliased `c`.
export function visibleTo(userId: string) {
  return sql`(c.kind = 'text' or ${userId} in (c.dm_user_a, c.dm_user_b))`;
}

// Enough about a channel to check access and to route its events.
export type ChannelAccess = { id: string; kind: "text" | "dm"; members: [string, string] | null };

// The channel if this user may see it; null for a bad id, a missing channel, or someone else's DM,
// so callers answer 404 the same way in all three cases.
export async function findChannel(id: unknown, userId: string): Promise<ChannelAccess | null> {
  if (!isId(id)) return null;
  const [row] = await sql`
    select c.id, c.kind, c.dm_user_a, c.dm_user_b from channels c
    where c.id = ${id} and ${visibleTo(userId)}
  `;
  if (!row) return null;
  return { id: String(row.id), kind: row.kind, members: row.kind === "dm" ? [row.dm_user_a, row.dm_user_b] : null };
}
