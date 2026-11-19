# JARVIS HUD

A live heads-up display for your Google Calendar, Gmail and Google Drive. It shows every calendar from every account you connect, including your cleaning schedule and your Fiery calendar. It checks Google every 4 hours, whenever you open the page, and when you click Refresh. Updates appear without a reload.

- **Briefing:** a plain-English summary of your day at the top, with four cards: what's next (with a countdown), today's events and cleans, unread mail, and anything that needs attention.
- **Today:** a timeline with your own calendars in one lane and shared calendars (like the Cleaning Schedule) in another, a line at the current time, and double-bookings outlined in red.
- **Coming up:** the rest of the week, grouped by day.
- **Calendar toggles:** each calendar shows in its Google Calendar colour; click a calendar's chip to hide or show it everywhere. Your choice is remembered in that browser.
- **Event details:** click any event for the time, place (with a map link), people, Meet link, what's before and after it, and why it's flagged.
- **Mail:** unread inbox threads from all accounts, newest first.
- **Files:** the most recently edited Drive files.
- **Tasks:** stored on the server, so every open screen updates when you add or tick one off.
- **Web view** (the WEB tab, or `/#web`): every event this week laid out as a spider web. Each ring is a day, with today on the outside, and each spoke is an hour. People and places hang between the events they share. Two kinds of dependency are flagged:
  - **Overlap** (red): the same person, or you, is booked into two events at once. Two different crews cleaning two houses at the same time is not an overlap.
  - **Tight hand-off** (amber, dashed): the same person goes straight from one place to another with 45 minutes or less between them.

  Tap any dot to see everything it connects to. Drag people and places to untangle the web, scroll or use + / − to zoom, and filter people, places or the running order.
- **Chat with Claude:** a chat panel that knows your calendar, mail, tasks and weather, and also answers anything else Claude can. Replies stream in as they're written. Quick buttons (What's next?, Cleans, Double-bookings, Mail, Tasks, Status report) answer instantly without Claude. Press `/` to jump to the chat, **Expand** for a bigger window, **New** to start over. Voice output and dictation use your browser's built-in speech.
- **Day picker:** seven days across the top of the timeline, each with its forecast and a dot per calendar. Click a day to see its timeline.
- **Weather** (optional): current conditions and a 7-day forecast for your city.
- **Real drive times** (optional): tight hand-offs are judged by the actual drive between the two addresses.

All Google access is **read-only**. JARVIS cannot send mail, change events or edit files.

## Try it with demo data

Needs Node 18 or newer. Run `npm install` once in the `jarvis` folder; it adds the Claude library the chat uses. Everything except the chat works without it.

```bash
cd jarvis
npm install
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

## Chat with Claude

1. Run `npm install` in the `jarvis` folder, if you haven't.
2. Get an API key at https://console.anthropic.com (**API keys → Create key**). This is separate from a Claude.ai subscription and is billed by usage, so add a little credit there.
3. Add it to `jarvis/.env` and restart JARVIS:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

Things to know:

- **Model:** Claude Opus 5.5 by default, at low effort so answers come quickly. Change it with `JARVIS_MODEL` (for example `claude-haiku-5-5` for the cheapest, `claude-fable-5-2` for the most capable) and `JARVIS_EFFORT` (`low`, `medium`, `high`).
- **What Claude sees:** when you send a message, JARVIS includes a snapshot of your next week of events (titles, times, places, people), unread mail senders and subjects, recent file names, tasks and weather. It is sent to Anthropic with your message. Claude can read it but cannot change anything in Google.
- **Conversations** are kept in memory only and are gone when JARVIS restarts. **New** clears one straight away.
- Without a key, the quick buttons still work.

## Weather and drive times (optional)

Add your city to `jarvis/.env`:

```
JARVIS_CITY=St. Thomas, Ontario
```

That switches on the weather (from [Open-Meteo](https://open-meteo.com), free for non-commercial use; only the city's coordinates are sent).

To judge tight hand-offs by real driving time, also add:

```
JARVIS_DRIVE_TIMES=1
```

A hand-off is then flagged when the gap is shorter than the drive plus 10 minutes, and shows both numbers ("15 min gap, about 22 min drive"). Without it, any change of address with 45 minutes or less is flagged.

This is off by default because it sends your events' addresses to two free public services: OpenStreetMap's Nominatim (to find each address, once, then remembered) and the OSRM demo server (to get drive times). Both are best-effort and meant for light use; addresses they can't find fall back to the 45-minute rule. Addresses are only searched near your city, so "137 Fifth Ave" doesn't land in New York.

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
| `POLL_SECONDS` | `14400` (4 hours) | How often to pull from Google. It also pulls when you open the page (if the last pull is over 5 minutes old) and when you click Refresh |
| `CALENDAR_DAYS` | `7` | Days of calendar to show |
| `JARVIS_HIDE_CALENDARS` | `holiday\|transferred from` | Calendars to hide, matched on name |
| `JARVIS_TZ` | system time zone | Time zone for spoken answers |
| `JARVIS_CITY` | (none) | City for weather and for locating addresses |
| `JARVIS_UNITS` | `metric` | `imperial` for °F and mph |
| `JARVIS_DRIVE_TIMES` | off | `1` to use real drive times (sends event addresses to OpenStreetMap services) |
| `JARVIS_MODEL` | `claude-opus-5-5` | Claude model for the chat |
| `JARVIS_EFFORT` | `low` | How hard Claude thinks: `low`, `medium`, `high` |
| `JARVIS_CALENDAR_NAMES` | (none) | Rename calendars on screen, for example `you@luma.com=Luma`. A Gmail account's main calendar is called Personal, and other main calendars use the email's domain |
| `JARVIS_MY_EMAILS` | (none) | Other addresses that are you (for example a personal Gmail), so they aren't shown as other people |

## Tests

```bash
cd jarvis
node --test
```

They run against local stand-ins for Google, Claude, the weather and the map services. They cover the chat (streaming, conversation memory), weather, drive times, the web view's overlap and hand-off rules, calendar merging and de-duplication, mail and Drive parsing, a revoked account, the sign-in flow, live task updates and the request protections.
