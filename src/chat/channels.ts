import { sql } from "../db.ts";
import { findChannel, visibleTo } from "./access.ts";
import { publish, publishToUser } from "./gateway.ts";
import { type Author, authed, fail, isId, readBody, toAuthor } from "./http.ts";

export type Channel = {
  id: string;
  kind: "text" | "dm";
  name: string | null;
  topic: string | null;
  other: Author | null;
  createdAt: string;
  lastMessageId: string | null;
  unreadCount: number;
};

type ChannelRow = {
  id: string;
  kind: "text" | "dm";
  name: string | null;
  topic: string | null;
  created_at: Date;
  other_id: string | null;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar: string | null;
  last_message_id: string | null;
  unread_count: number;
};

function toChannel(row: ChannelRow): Channel {
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name,
    topic: row.topic,
    other: row.other_id
      ? toAuthor({ id: row.other_id, username: row.other_username!, display_name: row.other_display_name, avatar: row.other_avatar })
      : null,
    createdAt: row.created_at.toISOString(),
    lastMessageId: row.last_message_id === null ? null : String(row.last_message_id),
    unreadCount: row.unread_count,
  };
}

// The channels a user can see, from their side: text channels by name, then DMs by latest activity.
// With onlyId, just that channel (an empty list if they can't see it).
export async function channelsFor(userId: string, onlyId?: string): Promise<Channel[]> {
  // Unread: messages by others past the read marker. A text channel also ignores everything from
  // before the user's first login, so a new user doesn't start with the whole history unread.
  const rows: ChannelRow[] = await sql`
    select c.id, c.kind, c.name, c.topic, c.created_at,
           o.id as other_id, o.username as other_username, o.display_name as other_display_name, o.avatar as other_avatar,
           last.id as last_message_id,
           (select count(*)::int from messages m
            where m.channel_id = c.id and m.author_id <> ${userId}
              and m.id > coalesce(r.last_read_message_id, 0)
              and (c.kind = 'dm' or m.created_at > me.created_at)) as unread_count
    from channels c
    join users me on me.id = ${userId}
    left join users o on o.id = case when c.dm_user_a = ${userId} then c.dm_user_b else c.dm_user_a end
    left join channel_reads r on r.channel_id = c.id and r.user_id = ${userId}
    left join lateral (select id, created_at from messages where channel_id = c.id order by id desc limit 1) last on true
    where ${visibleTo(userId)} ${onlyId ? sql`and c.id = ${onlyId}` : sql``}
    order by c.kind = 'dm', c.name, coalesce(last.created_at, c.created_at) desc, c.id desc
  `;
  return rows.map(toChannel);
}

// GET /api/channels
export const list = authed(async (_req, user) => Response.json(await channelsFor(user.id)));

// POST /api/channels
export const create = authed(async (req, user) => {
  const body = await readBody(req);
  if (!body) return fail(400, "expected a JSON object");

  const { name, topic = null } = body;
  if (typeof name !== "string" || !/^[a-z0-9-]{1,32}$/.test(name)) {
    return fail(400, "name must be 1-32 characters of a-z, 0-9 and -");
  }
  if (topic !== null && typeof topic !== "string") return fail(400, "topic must be a string");
  const cleanTopic = topic?.trim() || null;
  if (cleanTopic && cleanTopic.length > 200) return fail(400, "topic must be at most 200 characters");

  const [row] = await sql`
    insert into channels (name, topic, created_by) values (${name}, ${cleanTopic}, ${user.id})
    on conflict (name) do nothing
    returning id, name, topic, created_at
  `;
  if (!row) return fail(409, "channel name is taken");

  const channel: Channel = {
    id: String(row.id),
    kind: "text",
    name: row.name,
    topic: row.topic,
    other: null,
    createdAt: row.created_at.toISOString(),
    lastMessageId: null,
    unreadCount: 0,
  };
  publish({ type: "channel_created", channel });
  return Response.json(channel, { status: 201 });
});

// POST /api/channels/:id/read
export const markRead = authed<"/api/channels/:id/read">(async (req, user) => {
  const channel = await findChannel(req.params.id, user.id);
  if (!channel) return fail(404, "channel not found");
  const body = await readBody(req);
  if (!body) return fail(400, "expected a JSON object");
  const { messageId } = body;
  if (!isId(messageId)) return fail(400, "messageId must be a message id");
  const [message] = await sql`select 1 from messages where id = ${messageId} and channel_id = ${channel.id}`;
  if (!message) return fail(404, "message not found");

  // The where on the update keeps the marker from moving backwards; no row back means it didn't move.
  const [moved] = await sql`
    insert into channel_reads (user_id, channel_id, last_read_message_id) values (${user.id}, ${channel.id}, ${messageId})
    on conflict (user_id, channel_id) do update set last_read_message_id = excluded.last_read_message_id
    where channel_reads.last_read_message_id < excluded.last_read_message_id
    returning 1
  `;
  if (moved) publishToUser(user.id, { type: "read", channelId: channel.id, messageId });
  return new Response(null, { status: 204 });
});
