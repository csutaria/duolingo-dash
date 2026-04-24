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

## Sync requirements (authoritative)

1. **Never** run a full all-course cycle sync while the user is actively practicing. The cycle switches Duolingo's active course account-wide.
2. **Baseline XP check every 30 min.** Cheap `totalXp` read. No full sync is triggered directly from baseline.
3. **Quiet-detector (fast mode)**: when baseline sees XP changed vs last full sync, start polling `totalXp` every 2 min.
   - Any observed XP change → immediately return to baseline. Do **not** extend fast mode.
   - 5 consecutive unchanged fast ticks (10 min of quiet) → fire `fullSync(cycleAll=true)` → return to baseline.
4. **Nightly once at 02:00 server local time.** `quickCheck` first:
   - If XP changed vs last full sync → enter fast mode (if not already). Do not force a sync.
   - If XP unchanged → run `fullSync(cycleAll=true)`. Covers idle days.
5. **Pause** stops all three: baseline, fast, nightly. Pause is in-memory only — process restart always resumes polling.
6. **HMR safety**: all mutable polling state lives on a shared `globalThis.__duolingoPollingState` bucket so Next.js dev reloads don't orphan timers.
7. **Single-flight**: `isRunning` on the shared bucket acts as a global mutex across baseline/fast/nightly/manual paths — only one `fullSync` runs at a time.

## Server state (in-memory, shared `globalThis` bucket)

`src/lib/polling-state.ts` owns `globalThis.__duolingoPollingState`. All mutable polling/server-state reads/writes go through `getPollingState()`. This is what makes the dev-server HMR reload a no-op instead of an orphan-timer generator.


| Field                                                           | Purpose                                                    | Reset on process restart? |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| `client`                                                        | `DuolingoClient` singleton                                 | Yes                       |
| `userPaused`                                                    | User has clicked Pause in the UI                           | **Yes, by design**        |
| `baselineTimer`                                                 | 30-min `setInterval` handle                                | Yes                       |
| `fastTimer`                                                     | 2-min `setInterval` handle (only while `mode === "fast"`)  | Yes                       |
| `nightlyTimer`                                                  | Next 02:00 `setTimeout` handle (chained)                   | Yes                       |
| `isRunning`                                                     | Global single-flight mutex                                 | Yes                       |
| `mode`                                                          | `"baseline"` or `"fast"`                                   | Yes                       |
| `fastLastObservedXp` / `fastConsecutiveIdleTicks`               | Fast-mode bookkeeping                                      | Yes                       |
| `lastBaselineTickAtMs` / `lastNightlyAtMs` / `lastManualRefreshAtMs` | Timing for cadence + cooldown                         | Yes                       |
| `lastSyncResult`                                                | Most recent `SyncResult` for UI                            | Yes                       |
| `currentSync` (in `sync-state.ts`, separate)                    | `{ type, startedAtMs }` for an active `fullSync`           | Yes                       |


`ensureClient()` lazily creates the client from `DUOLINGO_JWT` and starts polling **unless `userPaused` is true**.

## Polling pipeline

`startPolling(client)` arms three independent schedules on the shared bucket:


| Timer           | Kind                 | Cadence                             | What it does                                                                                                              |
| --------------- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `baselineTimer` | `setInterval`        | 30 min                              | `baselineTick`: `quickCheck`. If XP changed vs last sync and in baseline mode → enter fast mode. Never fires `fullSync`. |
| `fastTimer`     | `setInterval`        | 2 min (only while `mode === "fast"`) | `fastTick`: `getTotalXp`. Any change → revert to baseline. 5 unchanged ticks → `fullSync(cycleAll=true)` → revert.       |
| `nightlyTimer`  | chained `setTimeout` | next 02:00 local                    | `nightlyTick`: `quickCheck`. Changed → enter fast mode (no sync). Unchanged → `fullSync(cycleAll=true)`. Re-arms.        |


State transitions (pure, unit-tested as `advanceSyncState`):

```
  baseline ──(baseline_tick, changed)──▶ fast (idle=0)
  fast ─────(fast_tick, changed)──────▶ baseline          // boots back to slow; no extension
  fast ─────(fast_tick, no-change)────▶ fast (idle++)
  fast ─────(5th no-change tick)──────▶ baseline + fire fullSync
  any  ─────(external_fullsync_done)──▶ baseline
```

Guards:

- `isRunning` (global mutex on the bucket). Only one sync at a time across baseline/fast/nightly/manual paths.
- `startPolling` is idempotent: `if (state.baselineTimer) return;` — re-entrant calls (HMR, multiple `ensureClient`s) are no-ops.
- Kickoff `baselineTick` runs once on start, but **only if** `isRunning === false` **and** `getCurrentSync() == null` (regression guard, commit 84935f3).
- `manualRefresh` keeps its 30 s cooldown and respects `isRunning`.
- `/api/sync` (any `force=true` or `manualRefresh` success) calls `notifyAllCourseSyncComplete()`, which resets fast-mode state so the detector doesn't re-trigger on the data the manual sync just landed.

```
  startPolling(client)
  ├── setInterval(baselineTick, 30m)
  ├── setTimeout(nightlyTick, msUntilNextLocalTime(2))      // chained
  ├── (fastTimer armed on demand when baseline detects change)
  └── if (!isRunning && currentSync == null) kickoff baselineTick
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
| `/api/status`      | `GET`                                               | Auth state, polling on/off, `paused`, `currentlyRunning`, `currentSync`, `expectedDurationMs.{single,cycle}`, last sync result, DB status, `msUntilNextXpCheck`, `msUntilNextNightlySync`, `syncMode` (`"baseline"`/`"fast"`), `fastIdleTicks`, `fastIdleTicksRequired`. Primary source for UI polling state. |
| `/api/polling`     | `POST { action: "pause" | "resume" }`               | Toggle `userPaused`. Returns `{ paused, polling }`. 400 on invalid action.                                                                                                                          |
| `/api/sync`        | `POST { force?: boolean, cycleAll?: boolean }`      | `force=false` (default): `manualRefresh` (respects cooldown + `isRunning`). `force=true`: direct `fullSync(client, cycleAll)`.                                                                      |
| `/api/sync-course` | `POST { courseId, learningLanguage, fromLanguage }` | `syncCourseDetails` for a single course (may cycle via endpoint ⑥ if not active).                                                                                                                   |
| `/api/data`        | `GET`                                               | Read-only queries for the dashboard UI. Supports `DEMO_MODE`.                                                                                                                                       |
| `/api/debug`       | `GET`                                               | Dev-only (`NODE_ENV === "development"`). Returns raw user + legacy-language resolution per course.                                                                                                  |


`/api/status` and `/api/data` do not require auth in `DEMO_MODE` (env `DEMO_MODE=true`) — they read from `data/mock.db` seeded by `scripts/seed-mock.js`.

## Pause semantics

- `pauseUserPolling()` sets `userPaused = true` and calls `stopPolling()` — clears baseline, fast (if active), and nightly.
- `resumeUserPolling()` sets `userPaused = false` and calls `startPolling(client)` if a client exists and polling isn't already running.
- Manual `/api/sync` (Refresh and Sync All Languages) still works while paused. Its activity surfaces in `currentSync` + UI badge.
- Pause is **not persisted**. Process restart resumes normal polling. This guarantees nightly coverage on a long-lived self-hosted process even if the user forgets to un-pause.

Pause does not: call Duolingo directly, touch the real Duolingo app or account, or block manual refreshes.

## Cross-reference

- `**docs/api-map.md`** — Duolingo endpoints, `language_data` key resolution, `xp_daily` aggregates.
- `**TESTING.md**` — what's covered, how to run, future test backlog.
- `**README.md**` — user-facing setup and behavior.
- `**CLAUDE.md**` / `**AGENTS.md**` — agent-oriented notes.

