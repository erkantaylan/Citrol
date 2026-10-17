import { sql } from "../db.ts";
import { channelsFor } from "./channels.ts";
import { publishToUser } from "./gateway.ts";
import { authed, fail, readBody } from "./http.ts";

// POST /api/dms: the DM with another user, created on first use.
export const open = authed(async (req, user) => {
  const body = await readBody(req);
  if (!body) return fail(400, "expected a JSON object");
  const { userId } = body;
  if (typeof userId !== "string" || !userId) return fail(400, "userId must be a user id");
  if (userId === user.id) return fail(400, "you can't send a DM to yourself");
  const [other] = await sql`select 1 from users where id = ${userId}`;
  if (!other) return fail(404, "user not found");

  // The pair is stored in order, and the unique index on it settles two people opening the DM at once.
  const [a, b] = [sql`least(${user.id}::text, ${userId}::text)`, sql`greatest(${user.id}::text, ${userId}::text)`];
  const [created] = await sql`
    insert into channels (kind, created_by, dm_user_a, dm_user_b) values ('dm', ${user.id}, ${a}, ${b})
    on conflict (dm_user_a, dm_user_b) do nothing
    returning id
  `;
  if (!created) {
    const [existing] = await sql`select id from channels where dm_user_a = ${a} and dm_user_b = ${b}`;
    const [channel] = existing ? await channelsFor(user.id, String(existing.id)) : [];
    return channel ? Response.json(channel) : fail(404, "user not found");
  }

  const id = String(created.id);
  const [mine] = await channelsFor(user.id, id);
  const [theirs] = await channelsFor(userId, id);
  publishToUser(user.id, { type: "channel_created", channel: mine });
  publishToUser(userId, { type: "channel_created", channel: theirs });
  return Response.json(mine, { status: 201 });
});
