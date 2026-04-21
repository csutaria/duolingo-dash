# Architecture

Contributor-oriented reference for how Duolingo Dash runs. For Duolingo endpoint semantics see `**docs/api-map.md**`. For user-facing behavior see `**README.md**`.

## Shape of the app

```
Browser (Next.js client) ─► Next.js API routes (server) ─► duolingo.com
                                       ↕
                                 SQLite (data/duolingo.db)
```

- Single Next.js process. App Router, server-side API routes.
- JWT lives only in server process memory (`DUOLINGO_JWT` env var). Never on disk.
- `better-sqlite3` is declared in `serverExternalPackages` (`next.config.ts`) so it is not bundled.
- All Duolingo calls funnel through `src/lib/duolingo.ts` (`DuolingoClient`).

## Server state (in-memory)

`src/lib/server-state.ts` holds the singleton `DuolingoClient` and a small amount of process-lifetime state.


| State                                                                   | Module            | Purpose                                                              | Reset on restart?                                                |
| ----------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `client`                                                                | `server-state.ts` | `DuolingoClient` singleton                                           | Yes                                                              |
| `userPaused`                                                            | `server-state.ts` | User has clicked Pause in the UI                                     | **Yes, by design** — nightly syncs always resume after a restart |
| `isRunning`                                                             | `polling.ts`      | A sync is in flight                                                  | Yes                                                              |
| `pollTimer` / `allCourseTimer`                                          | `polling.ts`      | Active `setInterval` handles                                         | Yes                                                              |
| `lastPollCompletedAtMs` / `lastAllCourseSyncAtMs` / `lastManualRefresh` | `polling.ts`      | Timing for cadence + cooldown                                        | Yes                                                              |
| `currentSync`                                                           | `sync-state.ts`   | `{ type: "single" | "cycle", startedAtMs }` for an active `fullSync` | Yes                                                              |


`ensureClient()` lazily creates the client from `DUOLINGO_JWT` and starts polling **unless `userPaused` is true**. That guarantee is what lets `resumeUserPolling()` rely on `ensureClient()` being a no-op for the user's pause intent.

## Polling pipeline

Two concurrent timers are started by `startPolling(client)`:


| Timer            | Interval | What it does                                                                                                               |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pollTimer`      | 15 min   | `pollOnce`: calls Duolingo endpoint ② (quick `totalXp`). If changed, triggers `fullSync(client, cycleAll=true)`.           |
| `allCourseTimer` | 3 h      | `allCourseSync`: unconditional `fullSync(client, cycleAll=true)` (catches idle-day skill updates). Skipped if `isRunning`. |


Guards:

- `isRunning` is a single boolean — only one sync at a time across all triggers (interval tick, manual refresh, kickoff).
- On `startPolling`, a kickoff `pollOnce` runs once **only if** `isRunning === false` **and** `getCurrentSync() == null`. This prevents resume-during-sync from spawning a concurrent `fullSync`.
- `manualRefresh` has a 30 s cooldown (`MIN_MANUAL_REFRESH_MS`) and also respects `isRunning`.

```
  startPolling(client)
  ├── setInterval(pollOnce, 15m)
  ├── setInterval(allCourseSync, 3h)
  └── if (!isRunning && currentSync == null) kickoff pollOnce
```

## Sync pipeline (`fullSync`)

`fullSync(client, cycleAllCourses)` in `src/lib/sync.ts`:

1. `setCurrentSync("single" | "cycle")` — populates `sync-state` for UI/progress.
2. Endpoint ① (`getUser`) → profile, course snapshots, XP daily history.
3. Streak epoch tracking — if `streakData.currentStreak.startDate` is present:
  - `updateStreakEpochs(startDate, previousStreakLength)` — records streak start/end in `streak_epochs`. Skipped if `startDate >= today` (intra-day sync before first practice).
  - `backfillImpliedFreeze(startDate)` — marks zero-XP days within the current streak window as `implied_freeze = 1` in `xp_daily` (covers days protected by a streak shield that weren't flagged `frozen` by Duolingo).
4. Achievements, if present.
5. Course detail:
  - `cycleAllCourses = false` → `saveLanguageDetails` for the active course only (endpoints ⑤, ⑦).
  - `cycleAllCourses = true` → `syncAllCourseDetails` cycles through every course via endpoint ⑥ (`PATCH /users/{id}`) — **this is account-wide and visible in the real Duolingo app**.
6. `logSync({ syncType: "full", totalXp, success, durationMs, cycleAll })`.
7. `clearCurrentSync()` in a `finally` — always clears, even on throw.

The `durationMs` recorded here is what powers the progress bar (see below).

## Sync progress

`sync_log` (SQLite) records every sync attempt:


| Column          | Added     | Notes                                             |
| --------------- | --------- | ------------------------------------------------- |
| `sync_time`     | original  | ISO string                                        |
| `sync_type`     | original  | `"quick"` or `"full"`                             |
| `total_xp`      | original  |                                                   |
| `success`       | original  | 0/1                                               |
| `error_message` | original  |                                                   |
| `duration_ms`   | migration | nullable; only set by `fullSync`                  |
| `cycle_all`     | migration | `1` for `cycleAll=true` `fullSync`, `0` otherwise |


`migrateSyncLog(db)` is idempotent — runs on every `initSchema()` call and only `ALTER TABLE`s columns that don't already exist.

`getMedianDurationMs(cycleAll, limit = 3)` returns the median of the last `limit` **successful full syncs** with the matching `cycle_all` flag and a non-null `duration_ms`. Returns `null` when there's no usable data — the UI then renders an indeterminate (pulsing) bar.

Progress is derived client-side as `min(1, elapsed / expectedDurationMs[type])` from `/api/status`. Intentionally approximate — no per-step telemetry.

## Internal API routes


| Route              | Method                                              | Purpose                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/status`      | `GET`                                               | Auth state, polling on/off, `paused`, `currentlyRunning`, `currentSync`, `expectedDurationMs.{single,cycle}`, last sync result, DB status, cadence countdowns. Primary source for UI polling state. |
| `/api/polling`     | `POST { action: "pause" | "resume" }`               | Toggle `userPaused`. Returns `{ paused, polling }`. 400 on invalid action.                                                                                                                          |
| `/api/sync`        | `POST { force?: boolean, cycleAll?: boolean }`      | `force=false` (default): `manualRefresh` (respects cooldown + `isRunning`). `force=true`: direct `fullSync(client, cycleAll)`.                                                                      |
| `/api/sync-course` | `POST { courseId, learningLanguage, fromLanguage }` | `syncCourseDetails` for a single course (may cycle via endpoint ⑥ if not active).                                                                                                                   |
| `/api/data`        | `GET`                                               | Read-only queries for the dashboard UI. Supports `DEMO_MODE`.                                                                                                                                       |
| `/api/debug`       | `GET`                                               | Dev-only (`NODE_ENV === "development"`). Returns raw user + legacy-language resolution per course.                                                                                                  |


`/api/status` and `/api/data` do not require auth in `DEMO_MODE` (env `DEMO_MODE=true`) — they read from `data/mock.db` seeded by `scripts/seed-mock.js`.

## Pause semantics

- `pauseUserPolling()` sets `userPaused = true` and calls `stopPolling()` (clears both intervals).
- `resumeUserPolling()` sets `userPaused = false` and calls `startPolling(client)` **if** a client exists and polling isn't already running.
- While paused, manual `/api/sync` still works. Its activity is reflected in `currentSync` + UI badge so the user can tell a sync is happening despite the pause.
- Pause is **not persisted**. A server restart resumes normal polling. This is intentional for a self-hosted, long-running process — it guarantees nightly background updates even if the user forgets to un-pause.

## What pause does *not* do

- Does not call Duolingo. Purely local timer control.
- Does not affect the real Duolingo app or account state.
- Does not block manual refreshes or `Sync All Languages`.

## Cross-reference

- `**docs/api-map.md`** — Duolingo endpoints, `language_data` key resolution, `xp_daily` aggregates.
- `**TESTING.md**` — what's covered, how to run, future test backlog.
- `**README.md**` — user-facing setup and behavior.
- `**CLAUDE.md**` / `**AGENTS.md**` — agent-oriented notes.

