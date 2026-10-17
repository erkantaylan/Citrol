# Citrol, day 1: our own Discord

Citrol is a small Discord-like chat that runs in the browser. We built it live in class, from an empty folder to a deployed app, in one evening: the first commit landed at 20:05 and the last at 21:54.

Try it: https://discord.etaylan.com (log in with your Discord account).

Code: https://github.com/erkantaylan/Citrol (public, read it as much as you like).

## Tech used

| Part | What we used | What it did for us |
|---|---|---|
| Language and runtime | TypeScript on Bun | One language for the server and the browser. Bun runs TypeScript directly, no build step to set up. |
| Server | `Bun.serve` | The web server, the REST API and the WebSocket, all built in. No framework. |
| Database | PostgreSQL 17 | Stores users, sessions, channels, messages, read markers and mentions. Talked to with Bun's built-in SQL client. |
| Database changes | Plain SQL migrations | Numbered `.sql` files in `migrations/`, run in order when the app starts. |
| Realtime | One WebSocket at `/ws` | Tells every browser about new, edited and deleted messages, who's online and who's typing. |
| Login | Discord OAuth2 | "Log in with Discord". No passwords of our own to store. |
| Frontend | Plain TypeScript and CSS | No React or other framework. Grew out of a static HTML mockup. |
| Build and bundling | Bun's HTML imports | The server imports `index.html` and Bun bundles the browser code for us. |
| Containers | Docker and Docker Compose | App plus Postgres in one compose file. Two files: one for local work, one for the server. |
| Hosting and deploy | Coolify | Watches the GitHub repo and redeploys on every push to `main`. |
| Images | ComfyUI with Z-Image Turbo | Generated the anime mascots locally on the teacher's GPU. |
| Tools | Claude Code with sub-agents, Git and GitHub | Claude Code wrote and tested the code while the teacher steered. Git kept the history, GitHub hosts it. |

The whole app has no runtime dependencies: everything comes from Bun itself. The only dev tools are TypeScript and Bun's type definitions.

## What Citrol can do now

- Log in with Discord. You stay logged in for a while, even when we deploy a new version.
- One server that's already open when you arrive. No server list.
- Text channels: general, homework, showcase and off-topic to start with. Anyone can create a new one. No roles, no admins.
- Send, edit and delete your own messages. Scroll up to load older history.
- Everything is live: new messages, edits, deletes, who's online, who's typing.
- Direct messages (DMs) between two people.
- Unread counts that the server remembers, so they're right after a reload or on another device. The tab title shows the total.
- Desktop notifications for DMs and mentions, switched on from the user panel.
- @mentions: type `@` and pick a person from the list. Messages that mention you are highlighted, and channels show an @ badge.
- Right-click (or long-press on a phone) for a menu: copy, edit, delete, message someone, mark as read, copy link.
- Message formatting: bold, italic, underline, strike, code, spoilers, quotes, links, colours like `[cyan]text[/cyan]` and `[rainbow]text[/rainbow]`. The "Aa" button next to the message box shows the cheat sheet.
- Six anime mascots standing at the bottom of the sidebar. Click one to switch to the next.
- And the joke rule: if you try to send `@everyone`, your own tab closes instead.

## How we built it

### First, decide what we're building

The goal was our own Discord, web only. We kept it small on purpose, and made these calls along the way:

- One server, already open. No server list.
- Text channels only. Voice can come later.
- No roles: anyone can create channels.
- Login only with Discord.
- One dark theme with a cyan accent.
- Postgres runs inside the compose file, next to the app.
- Two compose files: one for running locally, one for Coolify.
- Coolify deploys on every push to `main`. No GitHub Actions.
- No backups for now.

### Then, the order of work

1. **A static mockup.** Just one HTML page in the cyan theme, no code behind it. Then we took out roles and the server list. Changing a mockup is cheap; changing a finished app isn't.
2. **Test the scary part first.** Before any app existed, we tested Discord login with a throwaway script. If login didn't work, nothing else mattered.
3. **A walking skeleton.** Login, sessions in Postgres, Docker and Coolify, pushed and deployed before a single chat feature. It did almost nothing, but it did it on the real server. From then on every feature went straight to the live site.
4. **Features, one round at a time.** Each round was one commit and one deploy.

The feature rounds:

1. Skeleton: login, sessions, Docker, deploy.
2. Channels, messages, live updates over one WebSocket, the chat screen.
3. DMs, unread counts kept on the server, desktop notifications, the right-click menu.
4. @mentions with the picker (and the `@everyone` joke).
5. Message formatting: markdown, colours, rainbow.
6. Anime mascots. We compared five image models, picked Z-Image Turbo, generated 30 images, kept 6 and cut out their backgrounds. Later we made them twice as big.

### How we worked with Claude Code

The teacher steered with short commands, so it was always clear what Claude should do:

- **discuss**: talk only, don't touch anything.
- **execute**: do it now.
- **sling**: hand the work to sub-agents.

Every feature round followed the same pattern:

1. Claude first wrote the **API contract** in `docs/api.md`: which URLs exist, what they take, what they answer. This is the agreement between the server and the browser.
2. Then it started two sub-agents **in parallel**: one for the backend, one for the frontend. Both worked from the same contract, so they didn't need to wait for each other.
3. Each sub-agent tested its own half. The backend ran against a real Postgres with fake users. The frontend ran in a headless Chrome against a fake API.
4. Claude then ran both halves together in Docker and checked that they really fit, before pushing.

Sometimes unfinished work was lying around in the folder at commit time. Claude committed only the finished parts, then checked that commit in a clean copy of the repo before pushing. That way nothing half-done reached the live site by accident.

## Things we learned

**Don't do things on a GET that a browser might preload.** The first login test failed with "state mismatch". The test server kept one login state value in a global variable. While the teacher was still typing the URL, the browser preloaded the page in the background, which made a new state and overwrote the first one. The fix: keep the state per browser, in a cookie. And the general rule: a GET request can happen when nobody clicked anything, so it shouldn't change anything important.

**Cookies need SameSite=Lax, not Strict.** With Strict, the browser doesn't send the cookie when Discord redirects you back to our site, so the login loses track of you. Lax allows that one kind of trip back.

**Discord ids are too big for JavaScript numbers.** They're 64-bit numbers, and JavaScript would quietly round them. So we store and send them as text.

**Sessions live in the database, not in memory.** Memory is wiped on every deploy, and the database isn't: it sits in a named Docker volume that survives rebuilds. We tested it by rebuilding the app container and checking we were still logged in.

**Migrations only ever add.** Once a migration has run on the real database, we never edit or delete it. Any change is a new file. Otherwise your laptop and the server end up with different databases.

**Secrets never go on the shared screen.** The `.env` file with the Discord secret stays on the teacher's machine and is in `.gitignore`. The secret itself was pasted in off-screen. On a stream or a shared screen, assume everything you show is recorded.

**"Private" DMs are private from other users, not encrypted.** Other people can't see your DMs, and the server checks that on every request. But whoever runs the database can read them. That's normal for Discord too, but it's worth knowing what "private" really means.

## What's next

These are ideas, not promises. The class decides through the surveys.

- Replies to a specific message.
- Reactions with emoji.
- Uploading images and files.
- Voice channels, later.
- Maybe a small toolbar for colours and formatting, so you don't have to remember the tags.
