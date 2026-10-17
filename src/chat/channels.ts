import { sql } from "../db.ts";
import { publish } from "./gateway.ts";
import { authed, fail, readBody } from "./http.ts";

export type Channel = { id: string; name: string; topic: string | null; createdAt: string };

type ChannelRow = { id: string; name: string; topic: string | null; created_at: Date };

function toChannel(row: ChannelRow): Channel {
  return { id: String(row.id), name: row.name, topic: row.topic, createdAt: row.created_at.toISOString() };
}

// GET /api/channels
export const list = authed(async () => {
  const rows: ChannelRow[] = await sql`select id, name, topic, created_at from channels order by name`;
  return Response.json(rows.map(toChannel));
});

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

  const [row]: ChannelRow[] = await sql`
    insert into channels (name, topic, created_by) values (${name}, ${cleanTopic}, ${user.id})
    on conflict (name) do nothing
    returning id, name, topic, created_at
  `;
  if (!row) return fail(409, "channel name is taken");

  const channel = toChannel(row);
  publish({ type: "channel_created", channel });
  return Response.json(channel, { status: 201 });
});
