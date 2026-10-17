# Citrol API

The contract between the server (`src/server.ts`, `src/chat/`) and the browser (`src/client/`). Change both sides together.

Every endpoint below needs the session cookie and answers `401 {"error": "not logged in"}` without it. Errors are always `{"error": "<message>"}` with a 4xx status. All ids are **strings**, timestamps are ISO 8601 strings.

There is one server and no roles: every logged-in user sees every channel, and anyone can create a channel.

## Shapes

```ts
type Channel = { id: string; name: string; topic: string | null; createdAt: string };

type Author = { id: string; displayName: string; avatarUrl: string };

type Message = {
  id: string;
  channelId: string;
  author: Author;
  content: string;
  createdAt: string;
  editedAt: string | null;
};

type Member = Author & { online: boolean };
```

## REST

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/me` | | `{ id, username, displayName, avatarUrl }` |
| `GET /api/channels` | | `Channel[]`, by name |
| `POST /api/channels` | `{ name, topic? }` | `201 Channel`. `name`: 1–32 chars of `a-z 0-9 -`, unique (`409` if taken). `topic`: up to 200 chars. |
| `GET /api/channels/:id/messages?before=<messageId>&limit=<n>` | | `Message[]`, oldest first. The newest `limit` (default 50, max 100) messages older than `before`, or the newest overall without `before`. Fewer than `limit` means there is nothing older. |
| `POST /api/channels/:id/messages` | `{ content }` | `201 Message`. `content` is trimmed, 1–2000 chars. |
| `PATCH /api/messages/:id` | `{ content }` | `Message`. Only the author (`403` otherwise). Sets `editedAt`. |
| `DELETE /api/messages/:id` | | `204`. Only the author (`403` otherwise). |
| `GET /api/members` | | `Member[]`: everyone who has ever logged in, online first, then by name. |

Sending, editing and deleting go through REST, so validation and errors stay in one place. The WebSocket only carries what happened.

## WebSocket: `GET /ws`

The browser opens `ws(s)://<host>/ws`. The session cookie is checked on the upgrade (`401` without it). Every message is one JSON object with a `type`.

Server to browser:

| `type` | Fields | When |
|---|---|---|
| `ready` | `online: string[]` (user ids) | Right after connecting. |
| `message_created` | `message: Message` | Someone sent a message (the sender gets it too). |
| `message_updated` | `message: Message` | A message was edited. |
| `message_deleted` | `id, channelId` | A message was deleted. |
| `channel_created` | `channel: Channel` | Someone created a channel. |
| `presence` | `userId, online: boolean, member?: Member` | A user's first tab connected or last tab closed. `member` is included when they come online, so a user who logged in for the first time can be added to the list. |
| `typing` | `channelId, userId, displayName` | Someone is typing. Show it for 5 seconds unless it repeats. |

Browser to server:

| `type` | Fields | Rule |
|---|---|---|
| `typing` | `channelId` | Sent at most every 3 seconds while the user types. The server passes it on to everyone else. |

Every socket subscribes to one topic, so every event goes to every logged-in browser. When the socket drops (for example during a deploy), the browser reconnects with backoff and reloads the open channel's latest messages.
