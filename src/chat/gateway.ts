import type { BunRequest, Server, ServerWebSocket, WebSocketHandler } from "bun";
import { SESSION_COOKIE, getUser, type User } from "../auth/session.ts";
import { fail, isId, toAuthor } from "./http.ts";

export type SocketData = { user: User; lastTyping: number };

const TOPIC = "all";
const TYPING_INTERVAL_MS = 2000;

let server: Server<SocketData> | null = null;
// Open sockets per user id, so a user with several tabs only goes offline when the last one closes.
const connections = new Map<string, number>();

export function setServer(s: Server<SocketData>) {
  server = s;
}

export function isOnline(userId: string): boolean {
  return connections.has(userId);
}

// Sends an event to every connected browser.
export function publish(event: { type: string; [key: string]: unknown }) {
  server?.publish(TOPIC, JSON.stringify(event));
}

// GET /ws
export async function upgrade(req: BunRequest, srv: Server<SocketData>): Promise<Response | undefined> {
  const user = await getUser(req.cookies.get(SESSION_COOKIE));
  if (!user) return fail(401, "not logged in");
  if (srv.upgrade(req, { data: { user, lastTyping: 0 } })) return;
  return fail(400, "expected a websocket upgrade");
}

export const websocket: WebSocketHandler<SocketData> = {
  open(ws) {
    const { user } = ws.data;
    const count = (connections.get(user.id) ?? 0) + 1;
    connections.set(user.id, count);
    ws.subscribe(TOPIC);
    ws.send(JSON.stringify({ type: "ready", online: [...connections.keys()] }));
    // ws.publish skips this socket: its ready already lists the user as online.
    if (count === 1) {
      ws.publish(TOPIC, JSON.stringify({ type: "presence", userId: user.id, online: true, member: { ...toAuthor(user), online: true } }));
    }
  },

  message(ws, raw) {
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const { type, channelId } = msg as { type?: unknown; channelId?: unknown };
    if (type !== "typing" || !isId(channelId)) return;

    const now = Date.now();
    if (now - ws.data.lastTyping < TYPING_INTERVAL_MS) return;
    ws.data.lastTyping = now;

    const { user } = ws.data;
    ws.publish(TOPIC, JSON.stringify({ type: "typing", channelId, userId: user.id, displayName: toAuthor(user).displayName }));
  },

  close(ws: ServerWebSocket<SocketData>) {
    const { user } = ws.data;
    const count = (connections.get(user.id) ?? 1) - 1;
    if (count > 0) {
      connections.set(user.id, count);
      return;
    }
    connections.delete(user.id);
    publish({ type: "presence", userId: user.id, online: false });
  },
};
