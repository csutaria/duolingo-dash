# Duolingo Dash

Personal Duolingo learning dashboard. All data stays local — API calls go directly to duolingo.com, no third-party services.

Overview

More screenshots

XP HistoryCourse DetailVocabulary



## Setup

```bash
npm install
```

### Get your JWT

1. Log into [duolingo.com](https://www.duolingo.com) in your browser
2. Open Developer Tools (F12)
3. Go to **Application > Cookies > duolingo.com**
4. Copy the value of `jwt_token`

Alternatively, in the **Network** tab, find any request to duolingo.com and copy the `Authorization` header value after `Bearer`.

### Run the dashboard

```bash
read -s DUOLINGO_JWT && export DUOLINGO_JWT
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The JWT lives in the server process memory only. It is never written to disk.

## What it does while running

Once you open the dashboard, it keeps itself in sync with Duolingo in the background:

- Every 15 minutes it checks your total XP. If it changed, it pulls a fresh snapshot across all your courses.
- Every 3 hours it refreshes everything regardless of XP change (catches updates on idle days).
- Manual **Refresh** button: resyncs the active course only.
- Manual **Sync All Languages** button: resyncs every course immediately.

### Heads-up: syncing all courses switches your active language

Reading skill and vocab data for a course requires Duolingo's API to have that course active on your account. When Dash runs a full all-course sync, it **temporarily switches your active course on Duolingo**, one at a time, and switches back when done. This is visible in the real Duolingo app — if you start a lesson mid-sync you might land in the wrong language.

### Pause + progress bar

Click the polling indicator in the header to open a small panel:

- **Pause** stops the background 15-minute / 3-hour timers. Manual **Refresh** and **Sync All Languages** still work while paused. Pause resets on server restart so nightly updates always resume — pause it again if you want it off.
- While a sync is running, the panel shows an approximate progress bar. It's based on the median of your recent sync durations, so the first few syncs (before any history) show an indeterminate bar.

## Testing

```bash
npm test
```

Runs the full Jest suite. No extra setup needed. See `**TESTING.md**` for how to run subsets and `**docs/testing.md**` for coverage and the test backlog.

## Where to look


| Doc                               | For                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `**TESTING.md**`                  | Running the test suite                                                             |
| `**docs/architecture.md**`        | How polling, sync, pause, and the internal API routes fit together                 |
| `**docs/api-map.md**`             | Duolingo endpoints, `language_data` keys, `xp_daily` aggregates, known limitations |
| `**docs/testing.md**`             | Test design, coverage, backlog                                                     |
| `**docs/roadmap.md**`             | Planned features                                                                   |
| `**CLAUDE.md**` / `**AGENTS.md**` | Agent-oriented notes                                                               |


## Architecture at a glance

- **Next.js** (App Router) — pages and server-side API routes.
- **SQLite** (better-sqlite3) — historical snapshots in `data/duolingo.db`.
- **Recharts** — XP and progress charts.
- **Tailwind CSS** — styling.

```
Browser (localhost:3000) → Next.js API routes → duolingo.com
                                  ↕
                            SQLite (data/duolingo.db)
```

Details: `**docs/architecture.md**`.