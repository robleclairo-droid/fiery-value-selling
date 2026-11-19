# JARVIS HUD

A live heads-up display for your Google Calendar, Gmail and Google Drive. It shows every calendar from every account you connect, including your cleaning schedule and your Fiery calendar. Changes reach the screen within a minute, without a reload.

- **Calendars:** one panel per calendar, from every connected Google account. Invitation copies of events from a calendar already on screen are removed, so a clean doesn't show twice.
- **Mail:** unread inbox threads from all accounts, newest first.
- **Files:** the most recently edited Drive files.
- **Tasks:** stored on the server, so every open screen updates when you add or remove one.
- **Web view** (the WEB tab, or `/#web`): every event this week laid out as a spider web. Each ring is a day, with today on the outside, and each spoke is an hour. People and places hang between the events they share. Two kinds of dependency are flagged:
  - **Overlap** (red): the same person, or you, is booked into two events at once. Two different crews cleaning two houses at the same time is not an overlap.
  - **Tight hand-off** (amber, dashed): the same person goes straight from one place to another with 45 minutes or less between them.

  Tap any dot to see everything it connects to. Drag people and places to untangle the web, scroll or use + / − to zoom, and filter people, places or the running order.
- **Host status:** real CPU and memory of the machine running JARVIS, plus a countdown to the next sync.
- **Ask JARVIS:** quick commands (`schedule`, `cleaning`, `mail`, `files`, `tasks`, `report`). With an Anthropic API key, it also answers free-form questions from your live data. Voice output and dictation use your browser's built-in speech.

All Google access is **read-only**. JARVIS cannot send mail, change events or edit files.

## Try it with demo data

Needs Node 18 or newer. There is nothing to install.

```bash
cd jarvis
DEMO=1 node server.js
```

Open http://localhost:3000.

## Connect your Google accounts

You create your own Google sign-in once. It takes about ten minutes.

1. Go to https://console.cloud.google.com and create a project (for example "JARVIS").
2. Under **APIs & Services → Library**, enable **Google Calendar API**, **Gmail API** and **Google Drive API**.
3. Under **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - User type **External**. Fill in the app name and your email.
   - Under **Audience**, add every Google account you'll connect as a **test user**, for example your Luma address and your Fiery address.
   - Then click **Publish app**, so it moves to "In production". In "Testing" mode Google expires your sign-in every 7 days. You don't need Google's verification for personal use. You'll see an "unverified app" warning when you sign in; click **Advanced → Go to JARVIS**.
4. Under **APIs & Services → Credentials**, choose **Create credentials → OAuth client ID → Web application**. Add this authorized redirect URI:
   `http://localhost:3000/auth/callback`
5. Put the downloaded `client_secret_….json` file in the `jarvis` folder. JARVIS reads the client ID and secret from it, and git ignores it. (Or copy `.env.example` to `.env` and paste them into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.) Then run:
   ```bash
   cd jarvis
   node server.js
   ```
6. Open http://localhost:3000 and click **+ Connect Google account**. Sign in with your Luma account, then click it again and sign in with your Fiery account. Each account's calendars, mail and files merge into the one screen.

Sign-in tokens are saved in `jarvis/.data/store.json` (readable only by you, never committed). To disconnect an account, click the ✕ next to it twice, and also remove access at https://myaccount.google.com/permissions.

### If the Fiery account won't connect

Company Google Workspaces often block apps the admin hasn't approved, and you'll see "Access blocked" or "admin_policy_enforced". Two ways around it:

- Ask Fiery IT to allow the app (they'll need the client ID from step 4), or
- In Google Calendar on your Fiery account, share your calendar with your Luma address ("See all event details"). It then shows up automatically under your Luma account, with no Fiery sign-in needed.

## Free-form questions (optional)

Add an Anthropic API key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Questions like "When's my next clean?" or "What should I focus on today?" are then answered by Claude, using only the data on screen. Without a key, the quick commands still work.

## Run it all the time

JARVIS has to run on a machine that stays on: your computer, a spare laptop or Raspberry Pi on a wall screen, or a small cloud server. GitHub Pages can't run it, because the server holds your Google sign-in.

To keep it running on your own computer after a restart, use a process manager, for example `npx pm2 start server.js --name jarvis`.

To open it from other devices, put it behind HTTPS (Caddy, Cloudflare Tunnel, or a host like Render or Fly.io), then set these in `.env`:

```
HOST=0.0.0.0
BASE_URL=https://jarvis.yourdomain.com
JARVIS_PASSWORD=pick-a-long-password
```

Add `https://jarvis.yourdomain.com/auth/callback` as a second redirect URI in the Google client (step 4). Never expose it without `JARVIS_PASSWORD` and HTTPS: anyone who can reach it can read your inbox subjects and calendar.

## Settings

All settings go in `jarvis/.env`. See `.env.example` for every option.

| Setting | Default | What it does |
| --- | --- | --- |
| `POLL_SECONDS` | `60` | How often to pull from Google (minimum 15) |
| `CALENDAR_DAYS` | `7` | Days of calendar to show |
| `JARVIS_HIDE_CALENDARS` | `holiday\|transferred from` | Calendars to hide, matched on name |
| `JARVIS_TZ` | system time zone | Time zone for spoken answers |
| `JARVIS_MY_EMAILS` | (none) | Other addresses that are you (for example a personal Gmail), so they aren't shown as other people |

## Tests

```bash
cd jarvis
node --test
```

The tests run the real server against a fake Google API. They cover the web view's overlap and hand-off rules, calendar merging and de-duplication, mail and Drive parsing, a revoked account, the sign-in flow, live task updates and the request protections.
