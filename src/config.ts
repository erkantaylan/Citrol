// All settings come from env vars: .env locally, the compose file in Docker.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const publicUrl = required("PUBLIC_URL").replace(/\/$/, "");

export const config = {
  port: Number(process.env.PORT ?? 7421),
  dev: process.env.NODE_ENV !== "production",
  publicUrl,
  // Behind a proxy the app sees http, so https comes from the public URL, not the request.
  secureCookies: publicUrl.startsWith("https://"),
  databaseUrl: required("DATABASE_URL"),
  discord: {
    clientId: required("DISCORD_CLIENT_ID"),
    clientSecret: required("DISCORD_CLIENT_SECRET"),
    redirectUri: `${publicUrl}/auth/discord/callback`,
    // Empty means anyone with a Discord account can log in.
    guildId: process.env.DISCORD_GUILD_ID || null,
  },
};
