import index from "./client/index.html";
import { config } from "./config.ts";
import { migrate, sql } from "./db.ts";
import { avatarUrl, callback, startLogin } from "./auth/discord.ts";
import { SESSION_COOKIE, deleteSession, getUser } from "./auth/session.ts";

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
      GET: async (req) => {
        const user = await getUser(req.cookies.get(SESSION_COOKIE));
        if (!user) return Response.json({ error: "not logged in" }, { status: 401 });
        return Response.json({
          id: user.id,
          username: user.username,
          displayName: user.display_name ?? user.username,
          avatarUrl: avatarUrl(user),
        });
      },
    },
  },

  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Citrol listening on ${server.url} (public: ${config.publicUrl})`);
