// Shapes from docs/api.md.

export type Me = { id: string; username: string; displayName: string; avatarUrl: string };

export type Channel = { id: string; name: string; topic: string | null; createdAt: string };

export type Author = { id: string; displayName: string; avatarUrl: string };

export type Message = {
  id: string;
  channelId: string;
  author: Author;
  content: string;
  createdAt: string;
  editedAt: string | null;
};

export type Member = Author & { online: boolean };

export type ServerEvent =
  | { type: "ready"; online: string[] }
  | { type: "message_created"; message: Message }
  | { type: "message_updated"; message: Message }
  | { type: "message_deleted"; id: string; channelId: string }
  | { type: "channel_created"; channel: Channel }
  | { type: "presence"; userId: string; online: boolean; member?: Member }
  | { type: "typing"; channelId: string; userId: string; displayName: string };
