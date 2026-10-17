// Shapes from docs/api.md.

export type Author = { id: string; username: string; displayName: string; avatarUrl: string };

export type Me = Author;

export type Channel = {
  id: string;
  kind: "text" | "dm";
  name: string | null;
  topic: string | null;
  // The other person, only for a DM.
  other: Author | null;
  createdAt: string;
  lastMessageId: string | null;
  unreadCount: number;
  // Of the unread ones, those that mention me.
  mentionCount: number;
};

export type Message = {
  id: string;
  channelId: string;
  author: Author;
  // May contain mention tokens `<@id>`.
  content: string;
  // Ids of the users mentioned.
  mentions: string[];
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
  | { type: "read"; channelId: string; messageId: string }
  | { type: "presence"; userId: string; online: boolean; member?: Member }
  | { type: "typing"; channelId: string; userId: string; displayName: string };
