import type { Channel, Me, Member, Message } from "./types.ts";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The session is gone (logged out in another tab, expired): back to the login card.
  if (res.status === 401 && path !== "/api/me") {
    location.replace("/");
    throw new ApiError(401, "not logged in");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {}
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const PAGE_SIZE = 50;

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  channels: () => request<Channel[]>("GET", "/api/channels"),
  createChannel: (name: string, topic?: string) =>
    request<Channel>("POST", "/api/channels", topic ? { name, topic } : { name }),
  openDm: (userId: string) => request<Channel>("POST", "/api/dms", { userId }),
  markRead: (channelId: string, messageId: string) =>
    request<void>("POST", `/api/channels/${encodeURIComponent(channelId)}/read`, { messageId }),
  messages: (channelId: string, before?: string) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) params.set("before", before);
    return request<Message[]>("GET", `/api/channels/${encodeURIComponent(channelId)}/messages?${params}`);
  },
  send: (channelId: string, content: string) =>
    request<Message>("POST", `/api/channels/${encodeURIComponent(channelId)}/messages`, { content }),
  edit: (id: string, content: string) =>
    request<Message>("PATCH", `/api/messages/${encodeURIComponent(id)}`, { content }),
  remove: (id: string) => request<void>("DELETE", `/api/messages/${encodeURIComponent(id)}`),
  members: () => request<Member[]>("GET", "/api/members"),
  logout: () => fetch("/auth/logout", { method: "POST" }),
};
