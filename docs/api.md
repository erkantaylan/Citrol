# Citrol API

The contract between the server (`src/server.ts`, `src/chat/`) and the browser (`src/client/`). Change both sides together.

Every endpoint below needs the session cookie and answers `401 {"error": "not logged in"}` without it. Errors are always `{"error": "<message>"}` with a 4xx status. All ids are **strings**, timestamps are ISO 8601 strings.

There is one server and no roles: every logged-in user sees every text channel, and anyone can create one. Direct messages (DMs) are one-to-one and visible only to their two members.

## Shapes

```ts
type Author = { id: string; username: string; displayName: string; avatarUrl: string };

type Channel = {
  id: string;
  kind: "text" | "dm";
  name: string | null;      // null for a DM
  topic: string | null;     // null for a DM
  other: Author | null;     // the other person, only for a DM
  createdAt: string;
  lastMessageId: string | null;
  unreadCount: number;      // messages from others newer than what I've read
  mentionCount: number;     // of those, the ones that mention me
};

type Message = {
  id: string;
  channelId: string;
  author: Author;
  content: string;          // may contain mention tokens, see "Mentions"
  mentions: string[];       // ids of the users mentioned, no duplicates
  createdAt: string;
  editedAt: string | null;
};

type Member = Author & { online: boolean };
```

## Mentions

A mention is stored in `content` as the token `<@USER_ID>`, for example `hi <@1002>!`, so it keeps pointing at the right person when they change their name. The browser shows it as `@displayName`.

On send and edit, the server finds the tokens, keeps only ids of users that exist (an unknown id stays in the text but isn't a mention), and returns them in `mentions`. Mentioning yourself doesn't count. In a DM, only the other member can be mentioned. There is no `@everyone`: the browser refuses to send it and closes the sender's tab instead (a class joke; it is enforced only in the browser).

## REST

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/me` | | `{ id, username, displayName, avatarUrl }` |
| `GET /api/channels` | | `Channel[]`: all text channels by name, then my DMs, latest activity first. |
| `POST /api/channels` | `{ name, topic? }` | `201 Channel` (a text channel). `name`: 1–32 chars of `a-z 0-9 -`, unique (`409` if taken). `topic`: up to 200 chars. |
| `POST /api/dms` | `{ userId }` | The DM with that user: `200 Channel` if it exists, `201 Channel` if new. `400` for yourself, `404` for an unknown user. There is exactly one DM per pair of users. |
| `POST /api/channels/:id/read` | `{ messageId }` | `204`. Marks the channel read up to that message. Never moves backwards. |
| `GET /api/channels/:id/messages?before=<messageId>&limit=<n>` | | `Message[]`, oldest first. The newest `limit` (default 50, max 100) messages older than `before`, or the newest overall without `before`. Fewer than `limit` means there is nothing older. |
| `POST /api/channels/:id/messages` | `{ content }` | `201 Message`. `content` is trimmed, 1–2000 chars. |
| `PATCH /api/messages/:id` | `{ content }` | `Message`. Only the author (`403` otherwise). Sets `editedAt`. |
| `DELETE /api/messages/:id` | | `204`. Only the author (`403` otherwise). |
| `GET /api/members` | | `Member[]`: everyone who has ever logged in, online first, then by name. |

A DM that I'm not a member of behaves as if it didn't exist: every route answers `404`.

Sending, editing and deleting go through REST, so validation and errors stay in one place. The WebSocket only carries what happened.

## WebSocket: `GET /ws`

The browser opens `ws(s)://<host>/ws`. The session cookie is checked on the upgrade (`401` without it). Every message is one JSON object with a `type`.

Each socket subscribes to two topics: one shared by everyone, and one for its own user (`user:<id>`). Events about text channels go to everyone. Events about a DM go only to the two members' topics, never to the shared one.

Server to browser:

| `type` | Fields | When |
|---|---|---|
| `ready` | `online: string[]` (user ids) | Right after connecting. |
| `message_created` | `message: Message` | Someone sent a message (the sender gets it too). |
| `message_updated` | `message: Message` | A message was edited. |
| `message_deleted` | `id, channelId` | A message was deleted. |
| `channel_created` | `channel: Channel` | A text channel was created (to everyone), or a DM was created (to its two members; each gets the `Channel` from their own side, with `other` set to the other person). |
| `read` | `channelId, messageId` | I marked a channel read, sent to my own topic so my other tabs clear it too. |
| `presence` | `userId, online: boolean, member?: Member` | A user's first tab connected or last tab closed. `member` is included when they come online, so a user who logged in for the first time can be added to the list. |
| `typing` | `channelId, userId, displayName` | Someone is typing. Show it for 5 seconds unless it repeats. In a DM it goes only to the other member. |

Browser to server:

| `type` | Fields | Rule |
|---|---|---|
| `typing` | `channelId` | Sent at most every 3 seconds while the user types. The server passes it on, and ignores it for a DM the sender isn't in. |

When the socket drops (for example during a deploy), the browser reconnects with backoff and reloads the channel list, the open channel's latest messages and the member list.
