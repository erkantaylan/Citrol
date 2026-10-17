import index from "./client/index.html";
import { config } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { avatarUrl, callback, startLogin } from "./auth/discord.ts";
import { SESSION_COOKIE, deleteSession } from "./auth/session.ts";
import * as channels from "./chat/channels.ts";
import * as dms from "./chat/dms.ts";
import * as gateway from "./chat/gateway.ts";
import { authed } from "./chat/http.ts";
import * as members from "./chat/members.ts";
import * as messages from "./chat/messages.ts";

await migrate();

const server = Bun.serve({
  port: config.port,
  development: config.dev,
  routes: {
    "/": index,

    // Coolify and Docker poll this to know the app and database are up.
    "/health": async () => {
      await sql`select 1`;
      return new Response("ok");
    },

    "/auth/discord": { GET: startLogin },
    "/auth/discord/callback": { GET: callback },
    "/auth/logout": {
      POST: async (req) => {
        const clear = await deleteSession(req.cookies.get(SESSION_COOKIE));
        return new Response(null, { status: 204, headers: { "Set-Cookie": clear } });
      },
    },

    "/api/me": {
      GET: authed(async (_req, user) =>
        Response.json({
          id: user.id,
          username: user.username,
          displayName: user.display_name ?? user.username,
          avatarUrl: avatarUrl(user),
        }),
      ),
    },
    "/api/channels": { GET: channels.list, POST: channels.create },
    "/api/channels/:id/read": { POST: channels.markRead },
    "/api/dms": { POST: dms.open },
    "/api/channels/:id/messages": { GET: messages.list, POST: messages.send },
    "/api/messages/:id": { PATCH: messages.edit, DELETE: messages.remove },
    "/api/members": { GET: members.list },

    "/ws": gateway.upgrade,
  },

  websocket: gateway.websocket,

  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

gateway.setServer(server);

console.log(`Citrol listening on ${server.url} (public: ${config.publicUrl})`);
