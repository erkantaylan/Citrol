import type { User } from "../auth/session.ts";
import { sql } from "../db.ts";
import { type ChannelAccess, findChannel } from "./access.ts";
import { publishToChannel } from "./gateway.ts";
import { type Author, authed, fail, isId, readBody, toAuthor } from "./http.ts";
import { inContentOrder, saveMentions } from "./mentions.ts";

export type Message = {
  id: string;
  channelId: string;
  author: Author;
  content: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
};

type MessageRow = { id: string; channel_id: string; content: string; created_at: Date; edited_at: Date | null };
type AuthorRow = Pick<User, "id" | "username" | "display_name" | "avatar">;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CONTENT = 2000;

function toMessage(row: MessageRow, author: AuthorRow, mentions: string[]): Message {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    author: toAuthor(author),
    content: row.content,
    mentions,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
  };
}

// Returns the trimmed content, or an error response.
async function readContent(req: Request): Promise<string | Response> {
  const body = await readBody(req);
  if (!body) return fail(400, "expected a JSON object");
  if (typeof body.content !== "string") return fail(400, "content must be a string");
  const content = body.content.trim();
  if (content.length < 1 || content.length > MAX_CONTENT) return fail(400, `content must be 1-${MAX_CONTENT} characters`);
  return content;
}

// GET /api/channels/:id/messages?before=<messageId>&limit=<n>
export const list = authed<"/api/channels/:id/messages">(async (req, user) => {
  const channel = await findChannel(req.params.id, user.id);
  if (!channel) return fail(404, "channel not found");

  const params = new URL(req.url).searchParams;
  const before = params.get("before");
  if (before !== null && !isId(before)) return fail(400, "before must be a message id");
  const limitParam = params.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1) return fail(400, "limit must be a positive whole number");

  const rows: (MessageRow & AuthorRow & { author_id: string; mentions: string[] })[] = await sql`
    select m.id, m.channel_id, m.content, m.created_at, m.edited_at,
           u.id as author_id, u.username, u.display_name, u.avatar,
           coalesce((select array_agg(mm.user_id) from message_mentions mm where mm.message_id = m.id), '{}'::text[]) as mentions
    from messages m join users u on u.id = m.author_id
    where m.channel_id = ${channel.id} and (${before}::bigint is null or m.id < ${before}::bigint)
    order by m.id desc
    limit ${Math.min(limit, MAX_LIMIT)}
  `;
  // Fetched newest-first so the limit keeps the latest ones; the client wants oldest first.
  const messages = rows
    .reverse()
    .map((row) => toMessage(row, { ...row, id: row.author_id }, inContentOrder(row.content, row.mentions)));
  return Response.json(messages);
});

// POST /api/channels/:id/messages
export const send = authed<"/api/channels/:id/messages">(async (req, user) => {
  const channel = await findChannel(req.params.id, user.id);
  if (!channel) return fail(404, "channel not found");
  const content = await readContent(req);
  if (content instanceof Response) return content;

  const message = await sql.begin(async (tx) => {
    const [row]: MessageRow[] = await tx`
      insert into messages (channel_id, author_id, content) values (${channel.id}, ${user.id}, ${content})
      returning id, channel_id, content, created_at, edited_at
    `;
    return toMessage(row!, user, await saveMentions(tx, row!, user.id, channel));
  });
  publishToChannel(channel, { type: "message_created", message });
  return Response.json(message, { status: 201 });
});

// Loads a message and checks the user wrote it; returns its channel or an error response.
// A message in a DM the user isn't in is "not found", not "forbidden".
async function ownMessage(id: string, user: User): Promise<ChannelAccess | Response> {
  if (!isId(id)) return fail(404, "message not found");
  const [row] = await sql`select channel_id, author_id from messages where id = ${id}`;
  const channel = row && (await findChannel(String(row.channel_id), user.id));
  if (!channel) return fail(404, "message not found");
  if (row.author_id !== user.id) return fail(403, "only the author can change this message");
  return channel;
}

// PATCH /api/messages/:id
export const edit = authed<"/api/messages/:id">(async (req, user) => {
  const owned = await ownMessage(req.params.id, user);
  if (owned instanceof Response) return owned;
  const content = await readContent(req);
  if (content instanceof Response) return content;

  // The update locks the message row, so two edits at once replace the mentions one after the other.
  const message = await sql.begin(async (tx) => {
    const [row]: MessageRow[] = await tx`
      update messages set content = ${content}, edited_at = now()
      where id = ${req.params.id} and author_id = ${user.id}
      returning id, channel_id, content, created_at, edited_at
    `;
    if (!row) return null;
    return toMessage(row, user, await saveMentions(tx, row, user.id, owned));
  });
  // Deleted between the check and the update.
  if (!message) return fail(404, "message not found");
  publishToChannel(owned, { type: "message_updated", message });
  return Response.json(message);
});

// DELETE /api/messages/:id
export const remove = authed<"/api/messages/:id">(async (req, user) => {
  const owned = await ownMessage(req.params.id, user);
  if (owned instanceof Response) return owned;

  const [row] = await sql`delete from messages where id = ${req.params.id} and author_id = ${user.id} returning id`;
  if (!row) return fail(404, "message not found");
  publishToChannel(owned, { type: "message_deleted", id: req.params.id, channelId: owned.id });
  return new Response(null, { status: 204 });
});
