import type { User } from "../auth/session.ts";
import { sql } from "../db.ts";
import { publish } from "./gateway.ts";
import { type Author, authed, fail, isId, readBody, toAuthor } from "./http.ts";

export type Message = {
  id: string;
  channelId: string;
  author: Author;
  content: string;
  createdAt: string;
  editedAt: string | null;
};

type MessageRow = { id: string; channel_id: string; content: string; created_at: Date; edited_at: Date | null };
type AuthorRow = Pick<User, "id" | "username" | "display_name" | "avatar">;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CONTENT = 2000;

function toMessage(row: MessageRow, author: AuthorRow): Message {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    author: toAuthor(author),
    content: row.content,
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

async function channelExists(id: string): Promise<boolean> {
  const [row] = await sql`select 1 from channels where id = ${id}`;
  return !!row;
}

// GET /api/channels/:id/messages?before=<messageId>&limit=<n>
export const list = authed<"/api/channels/:id/messages">(async (req) => {
  const channelId = req.params.id;
  if (!isId(channelId) || !(await channelExists(channelId))) return fail(404, "channel not found");

  const params = new URL(req.url).searchParams;
  const before = params.get("before");
  if (before !== null && !isId(before)) return fail(400, "before must be a message id");
  const limitParam = params.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1) return fail(400, "limit must be a positive whole number");

  const rows: (MessageRow & AuthorRow & { author_id: string })[] = await sql`
    select m.id, m.channel_id, m.content, m.created_at, m.edited_at,
           u.id as author_id, u.username, u.display_name, u.avatar
    from messages m join users u on u.id = m.author_id
    where m.channel_id = ${channelId} and (${before}::bigint is null or m.id < ${before}::bigint)
    order by m.id desc
    limit ${Math.min(limit, MAX_LIMIT)}
  `;
  // Fetched newest-first so the limit keeps the latest ones; the client wants oldest first.
  const messages = rows.reverse().map((row) => toMessage(row, { ...row, id: row.author_id }));
  return Response.json(messages);
});

// POST /api/channels/:id/messages
export const send = authed<"/api/channels/:id/messages">(async (req, user) => {
  const channelId = req.params.id;
  if (!isId(channelId) || !(await channelExists(channelId))) return fail(404, "channel not found");
  const content = await readContent(req);
  if (content instanceof Response) return content;

  const [row]: MessageRow[] = await sql`
    insert into messages (channel_id, author_id, content) values (${channelId}, ${user.id}, ${content})
    returning id, channel_id, content, created_at, edited_at
  `;
  const message = toMessage(row!, user);
  publish({ type: "message_created", message });
  return Response.json(message, { status: 201 });
});

// Loads a message and checks the user wrote it; returns its channel id or an error response.
async function ownMessage(id: string, user: User): Promise<string | Response> {
  if (!isId(id)) return fail(404, "message not found");
  const [row] = await sql`select channel_id, author_id from messages where id = ${id}`;
  if (!row) return fail(404, "message not found");
  if (row.author_id !== user.id) return fail(403, "only the author can change this message");
  return String(row.channel_id);
}

// PATCH /api/messages/:id
export const edit = authed<"/api/messages/:id">(async (req, user) => {
  const owned = await ownMessage(req.params.id, user);
  if (owned instanceof Response) return owned;
  const content = await readContent(req);
  if (content instanceof Response) return content;

  const [row]: MessageRow[] = await sql`
    update messages set content = ${content}, edited_at = now()
    where id = ${req.params.id} and author_id = ${user.id}
    returning id, channel_id, content, created_at, edited_at
  `;
  // Deleted between the check and the update.
  if (!row) return fail(404, "message not found");
  const message = toMessage(row, user);
  publish({ type: "message_updated", message });
  return Response.json(message);
});

// DELETE /api/messages/:id
export const remove = authed<"/api/messages/:id">(async (req, user) => {
  const owned = await ownMessage(req.params.id, user);
  if (owned instanceof Response) return owned;

  const [row] = await sql`delete from messages where id = ${req.params.id} and author_id = ${user.id} returning id`;
  if (!row) return fail(404, "message not found");
  publish({ type: "message_deleted", id: req.params.id, channelId: owned });
  return new Response(null, { status: 204 });
});
