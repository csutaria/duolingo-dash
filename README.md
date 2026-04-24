# Duolingo Dash

Personal Duolingo learning dashboard. All data stays local — API calls go directly to duolingo.com, no third-party services.

Overview

More screenshots

HistoryCourse DetailVocabulary



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

The dashboard's goal is simple: stay current without interrupting you while you practice. An all-course cycle sync temporarily switches your active Duolingo course, so it's designed to only run when you're not actively earning XP.

**Background sync, at a glance:**

- **Every 30 min** — cheap XP check only, no course switching.
- **If your XP changed** — switches to a 2-min watch. Any new XP in that window drops back to the 30-min baseline (you're still practicing; try again later). 10 minutes of quiet → one full all-course sync.
- **Every night at 02:00 (server local time)** — one full all-course sync to catch idle-day changes. If you happen to be earning XP around 02:00, the nightly skips its own sync and lets the quiet-watcher run one once you stop.
- **Manual Refresh** — resyncs the active course only.
- **Manual Sync All Languages** — resyncs every course immediately (same disruption caveat below).

### Heads-up: all-course syncs switch your active Duolingo language

Reading skill and vocab data requires Duolingo's API to have that course active on your account. During a full all-course sync, Dash temporarily switches your active course one-at-a-time and switches back when done. This is visible in the real Duolingo app — if you start a lesson mid-sync you might land in the wrong language. The 10-min quiet window before Dash fires one is specifically designed to avoid this.

### Pause + progress bar

Click the polling indicator in the header to open a small panel:

- **Pause** stops all background sync (baseline 30-min XP checks, the 2-min quiet watcher, and the nightly). Manual **Refresh** and **Sync All Languages** still work while paused. Pause resets on server restart — if you want it permanently off, pause again after each restart.
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