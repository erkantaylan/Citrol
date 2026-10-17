import type { SQL } from "bun";
import { sql } from "../db.ts";
import type { ChannelAccess } from "./access.ts";

// A mention is the token <@USER_ID> in a message's content (docs/api.md, "Mentions").
// The migration backfill uses the same pattern.
const TOKEN = /<@([0-9]+)>/g;

// The ids in the mention tokens, each once, in order of first appearance.
export function mentionTokens(content: string): string[] {
  return [...new Set(Array.from(content.matchAll(TOKEN), (match) => match[1]!))];
}

// The stored mentions of a message, in the order they appear in its content.
export function inContentOrder(content: string, mentions: string[]): string[] {
  return mentionTokens(content).filter((id) => mentions.includes(id));
}

// Replaces the stored mentions of a message with the ones in its content, and returns them.
// Only users that exist count, never the author, and in a DM only the other member.
// Runs inside the transaction that wrote the message.
export async function saveMentions(
  tx: SQL,
  message: { id: string; content: string },
  authorId: string,
  channel: ChannelAccess,
): Promise<string[]> {
  const candidates = mentionTokens(message.content).filter(
    (id) => id !== authorId && (!channel.members || channel.members.includes(id)),
  );
  await tx`delete from message_mentions where message_id = ${message.id}`;
  if (candidates.length === 0) return [];

  const rows: { user_id: string }[] = await tx`
    insert into message_mentions (message_id, channel_id, user_id)
    select ${message.id}::bigint, ${channel.id}::bigint, u.id from users u
    where u.id = any(${sql.array(candidates, "text")})
    returning user_id
  `;
  return inContentOrder(message.content, rows.map((row) => row.user_id));
}
