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
4. **Nightly once at the configured hour in the resolved timezone (R).** Default `02:00`; configurable via the SyncBar selector (persisted to `app_settings.nightly_hour`). `quickCheck` first:
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

## Timezone model (critical)

The app uses two timezone concepts:

- **S (host/system timezone):** the machine/process timezone (`Intl` on that host).
- **R (resolved app timezone):** the timezone used for all day-boundary logic.

`R` priority (highest first):

1. **UI override** — `app_settings.timezone_override` set via the SyncBar "Override" input or `POST /api/settings { timezoneOverride }`. Reported as `resolvedTimezoneSource: "settings"`.
2. `DUOLINGO_TZ` env var. Reported as `"env"`.
3. Duolingo profile timezone (`user_profile.timezone`, filled from Duolingo user `timezone` on sync). Reported as `"profile"`.
4. Host/system timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Reported as `"system"`.

Both the settings and profile sources are wired into `tz.ts` via setter functions (`setSettingsTimezoneLoader`, `setProfileTimezoneLoader`) called from `db.ts` at init, avoiding an import cycle. The resolver itself **never validates** IANA names and **never throws** — failures in either loader fall through silently. IANA validation is enforced upstream at the `POST /api/settings` boundary (invalid zones → 400). After any update to the override or the profile timezone, callers must invoke `invalidateResolvedTimezone()` so subsequent reads pick up the new value.

Rules:

- UTC timestamps are still stored as UTC in SQLite.
- Any "which day is this?" decision must use **R**, not raw UTC and not host-local calendar extraction.
- Nightly scheduling computes "next `effectiveNightlyHour():00` in R" and then converts that wall-clock target to an epoch delay.

### UTC-host deployment note

If you deploy on a server configured to UTC, that only fixes **S**. It does **not** automatically mean "02:00 in your local timezone."

- Without an override, `DUOLINGO_TZ`, or a persisted profile timezone, `R` falls through to `S=UTC` and nightly runs happen at **02:00 UTC**.
- The fastest fix without a redeploy is the SyncBar "Override" input: set it to your IANA zone (e.g. `America/Los_Angeles`) and the resolver, the nightly scheduler, and every "which day" query pick it up immediately. Persisted in `app_settings.timezone_override`; survives process restarts.
- For headless / pre-login configuration, set `DUOLINGO_TZ=America/Los_Angeles` in the environment.

Deployment checklist (single-user/self-host):

1. Pick the user's wall-clock zone (for example, `America/Los_Angeles`).
2. Either: set `DUOLINGO_TZ` on the host to that IANA name, **or** open the dashboard and set the SyncBar "Override" to that zone.
3. Verify at runtime that `msUntilNextNightlySync` (from `/api/status`) counts down to the next nightly hour in that zone, and that `resolvedTimezoneSource` is `"settings"` or `"env"` (not `"system"`).
4. Keep host OS timezone independent (UTC is fine). Scheduling uses **R**, not host-local midnight math.

### DST policy

We do not pin the wall-clock interpretation of `R`; we re-derive it every time we cross a function boundary. That means daylight-saving transitions are absorbed by the standard `Intl.DateTimeFormat` pipeline rather than handled with explicit branches. Concrete behavior:

| Transition | What happens to the nightly tick (assume `nightly_hour = 2`) |
|---|---|
| **Spring forward** (`02:00 → 03:00`, the missing hour) | `epochMsForLocalTime(y, m, d, 2, R)` does a single guess-and-correct against the offset at the guessed instant; the nearest representable wall clock is `03:00`, so the nightly fires at `03:00` local that day. One-day shift, self-correcting. The round-trip test in `tz.test.ts` (`getLocalParts / epochMsForLocalTime round-trip`) is `parts.hour ∈ [h, h+1]` precisely so the spring-forward instant doesn't break the assertion. |
| **Fall back** (`02:00` happens twice) | Guess-and-correct picks the *first* occurrence (the pre-shift offset). The post-shift `02:00` is skipped. Acceptable: the missed second instance is just a normal idle hour the quiet-detector covers. |
| **Calendar-day buckets across DST** | `LOCAL_DATE(utc)` and `formatLocalDate` always go through `Intl.DateTimeFormat` with `timeZone: R`, which applies the correct offset for that instant. No off-by-one on either side of the transition. |

What this means for the resolver cache:

- `invalidateResolvedTimezone()` is fired only on writes to `app_settings.timezone_override` or to the stored profile timezone, **not** on DST. Caching the IANA *zone string* (not an offset) means `Intl` recomputes the offset every time we format. DST transitions inside a fixed zone don't require cache invalidation.
- A live process spans DST transitions without action. A long-running `setTimeout` for the nightly is also fine: the `delay` is computed in real-time milliseconds against the post-DST instant, so the OS scheduler fires it at the right wall-clock moment regardless of when the timer was armed.

What we do **not** support:

- Switching `R` to a fixed-offset zone (e.g. `Etc/GMT+8`) and expecting it to track local DST. By definition fixed-offset zones don't observe DST; if the user's locale does, they should use the IANA region name (`America/Los_Angeles`, not `Etc/GMT+8`).
- Mid-tick DST recomputation. If the spring-forward instant lands inside a `setTimeout` window, the timer fires at the originally-computed epoch ms (which already accounts for the new offset). No further adjustment is performed.

## App settings (`app_settings` table)

Single-row (`id = 1`) SQLite table for user-editable preferences. Helpers in `src/lib/app-settings.ts` (`getAppSettings`, `updateAppSettings`); HTTP surface in `/api/settings`.

| Column              | Type      | Default fallthrough                                | Consumer                                              |
| ------------------- | --------- | -------------------------------------------------- | ----------------------------------------------------- |
| `nightly_hour`      | INTEGER 0..23 | `null` → 2 (legacy `NIGHTLY_HOUR_DEFAULT`)         | `effectiveNightlyHour()` in `polling.ts`              |
| `timezone_override` | TEXT (IANA)   | `null` → resolver chain (env → profile → host)     | `setSettingsTimezoneLoader()` in `tz.ts` (top of priority chain) |
| `updated_at`        | TEXT      | `datetime('now')`                                  | Audit only                                            |

Notes:

- `NULL` always means **fall through to default**, not "value 0". Storing 0 in `nightly_hour` means "midnight (R)".
- `getAppSettings()` is read-side defensive: if the table or row is missing (e.g. read-only instance pointed at an un-migrated DB) it returns `{ nightly_hour: null, timezone_override: null }` rather than throwing.
- The helpers live in their own module so consumers can `jest.doMock("./db", { getDb: () => testDb })` and have the helpers reach the mocked handle. Functions defined inside `db.ts` itself bypass module-level mocks because their internal `getDb()` reference resolves to the real binding.
- Updating `nightly_hour` via `POST /api/settings` calls `rescheduleNightly()` so the next `setTimeout` is re-armed against the new hour without a process restart.
- Updating `timezone_override` via `POST /api/settings` calls `invalidateResolvedTimezone()` so the next `getResolvedTimezone()` re-runs the chain and the change takes effect for every downstream consumer (UDF, queries, scheduler) in the next read.

## Nightly sync (selectable hour)

`scheduleNightly(client)` reads `effectiveNightlyHour()` at scheduling time (not module load). The chain is:

```
app_settings.nightly_hour (UI)  ─┐
                                 ├─► effectiveNightlyHour()  ──►  msUntilNextLocalTime(h, R)
NIGHTLY_HOUR_DEFAULT (= 2)  ─────┘
```

- `effectiveNightlyHour()` validates the stored value is an integer in `0..23`; out-of-range / non-integer / DB-missing → `NIGHTLY_HOUR_DEFAULT` (2).
- The hour is interpreted in **R** (resolved zone), not S — see `msUntilNextLocalTime` and the Timezone model section above. Changing the hour does **not** change the zone.
- `POST /api/settings { "nightlyHour": 7 }` triggers `updateAppSettings({ nightly_hour: 7 })` then `rescheduleNightly()`. The latter no-ops if there is no live client (e.g. paused before resume).
- `GET /api/status` reports the effective hour as `nightlyHour` (always present in non-DEMO responses, including read-only). The UI surfaces it as a `<select>` next to "Next nightly sync" in the SyncBar status panel.


## Read-only mode (`DUOLINGO_READ_ONLY=1`)

A second instance can be run as a **display-only** process pointing at the same SQLite file. Use this to test/preview the UI on another machine without contending with the writer for the Duolingo API or the SQLite write lock.

Activated by env: `DUOLINGO_READ_ONLY=1` (also `true`/`yes`, case-insensitive). Surfaced via `isReadOnlyMode()` in `src/lib/read-only.ts`. Side-effects:

| Subsystem | Read-only behavior |
| --- | --- |
| `getDb()` (`src/lib/db.ts`) | Opens with `new Database(DB_PATH, { readonly: true, fileMustExist: true })`. Skips `initSchema` and migrations (writer already ran them). Still registers the `LOCAL_DATE` UDF — that's per-connection, not a write. |
| `ensureClient()` (`src/lib/server-state.ts`) | Throws `"read-only mode: Duolingo client is disabled"` immediately, before `DUOLINGO_JWT` is consulted and before `startPolling` runs. No timers are armed. |
| `getClientOrNull()` | Returns `null` without attempting to construct a client — `/api/status` and `/api/data` use this path. |
| `POST /api/sync` | Returns `503 { "error": "read-only" }`. |
| `POST /api/sync-course` | Returns `503 { "error": "read-only" }`. |
| `POST /api/polling` | Returns `503 { "error": "read-only" }`. |
| `GET /api/status` | Returns the **same shape** as the normal-mode payload, with sentinel values for fields that don't apply: `readOnly: true`, `authenticated: false`, `polling: false`, `paused: false`, `currentlyRunning: false`, `currentSync: null`, `expectedDurationMs: { single: null, cycle: null }`, `lastSyncResult: null`, `msUntilNextXpCheck: null`, `msUntilNextNightlySync: null`, `syncMode: "baseline"`, `fastIdleTicks: 0`, `fastIdleTicksRequired: 5`. `dbStatus`, `resolvedTimezone`, `resolvedTimezoneSource`, `timezoneOverride`, and `nightlyHour` are real values read from the DB. The shape parity is intentional — the UI takes one render path for both modes. `getAppSettings()` is read-defensive when the table is missing on an un-migrated DB. |
| `SyncBar` UI | Renders a blue **"Read-only"** pill in place of Refresh / Sync All. The status panel shows "Display-only instance. Writes are disabled." instead of the pause toggle. The `Last sync` row + Timezone row still render from `dbStatus`. |

Caveats and follow-ups (these are why this is a "display" mode, not "follower" mode):

- The resolver cache in `src/lib/tz.ts` is per-process. If the writer learns a new Duolingo profile timezone, or if the user changes the `app_settings.timezone_override` from another instance, the read-only process won't see it until restart — `invalidateResolvedTimezone()` is only fired in the process that handled the write. Acceptable for the C2 display-only model; the broader inventory of per-process state and what would have to change for true multi-writer is in [`docs/multi-server.md`](./multi-server.md).
- `dbStatus` reflects the writer's last sync — the read-only process never updates `sync_log`. The UI should not interpret "no recent sync" as a problem on a read-only instance.
- The DB file must be reachable by both processes (same host, shared filesystem, or copy). SQLite WAL is concurrent-read-safe with a single writer, which is the configuration we expect here.

See `README.md` § "Running a display-only second instance" for the user-facing instructions.

## Polling pipeline

`startPolling(client)` arms three independent schedules on the shared bucket:


| Timer           | Kind                 | Cadence                             | What it does                                                                                                              |
| --------------- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `baselineTimer` | `setInterval`        | 30 min                              | `baselineTick`: `quickCheck`. If XP changed vs last sync and in baseline mode → enter fast mode. Never fires `fullSync`. |
| `fastTimer`     | `setInterval`        | 2 min (only while `mode === "fast"`) | `fastTick`: `getTotalXp`. Any change → revert to baseline. 5 unchanged ticks → `fullSync(cycleAll=true)` → revert.       |
| `nightlyTimer`  | chained `setTimeout` | next `effectiveNightlyHour():00` in R | `nightlyTick`: `quickCheck`. Changed → enter fast mode (no sync). Unchanged → `fullSync(cycleAll=true)`. Re-arms with the current setting (UI changes take effect on the next arming or via `rescheduleNightly()`).        |


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
  ├── setTimeout(nightlyTick, msUntilNextLocalTime(2))      // next 02:00 in R; chained
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
  - `cycleAllCourses = true` → `syncAllCourseDetails` cycles through every course via endpoint ⑥ (`PATCH /users/{id}`) — **this is account-wide and visible in the real Duolingo app**. Each PATCH moves its target to the top of the account's course-selector (a recency stack), and the API-returned `user.courses` array mirrors that order. The cycle visits non-active courses in **reverse of `user.courses`** and restores the active course last — the identity permutation, so the selector ends the cycle in the exact order the user started with.
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
| `/api/status`      | `GET`                                               | Auth state, polling on/off, `paused`, `currentlyRunning`, `currentSync`, `expectedDurationMs.{single,cycle}`, last sync result, DB status, `msUntilNextXpCheck`, `msUntilNextNightlySync`, `syncMode` (`"baseline"`/`"fast"`), `fastIdleTicks`, `fastIdleTicksRequired`, **`nightlyHour`** (effective `0..23` in **R**), **`resolvedTimezone`** (IANA **R**), **`resolvedTimezoneSource`** (`settings` / `env` / `profile` / `system`), **`timezoneOverride`** (raw stored `app_settings.timezone_override`, `null` when unset), **`readOnly`** (`true` when `DUOLINGO_READ_ONLY=1`). Primary source for UI polling state. |
| `/api/polling`     | `POST { action: "pause" | "resume" }`               | Toggle `userPaused`. Returns `{ paused, polling }`. 400 on invalid action. **503 `{ error: "read-only" }`** in read-only mode.                                                                       |
| `/api/settings`    | `GET` / `POST`                                      | `GET` → `{ nightlyHour, timezoneOverride }` (effective `nightlyHour`, raw stored `timezoneOverride`). `POST { nightlyHour?: 0..23 \| null, timezoneOverride?: string \| null }` updates `app_settings`. Side effects: a `nightlyHour` change re-arms the nightly `setTimeout` via `rescheduleNightly()`; a `timezoneOverride` change calls `invalidateResolvedTimezone()` so R re-resolves on the next read. `timezoneOverride` is validated as a real IANA zone (via `Intl.DateTimeFormat`) — bogus strings → 400. 400 on any validation failure. **503 `{ error: "read-only" }`** in read-only mode. |
| `/api/sync`        | `POST { force?: boolean, cycleAll?: boolean }`      | `force=false` (default): `manualRefresh` (respects cooldown + `isRunning`). `force=true`: direct `fullSync(client, cycleAll)`. **503 `{ error: "read-only" }`** in read-only mode.                  |
| `/api/sync-course` | `POST { courseId, learningLanguage, fromLanguage }` | `syncCourseDetails` for a single course (may cycle via endpoint ⑥ if not active). **503 `{ error: "read-only" }`** in read-only mode.                                                                |
| `/api/data`        | `GET`                                               | Read-only queries for the dashboard UI. Supports `DEMO_MODE`.                                                                                                                                       |
| `/api/debug`       | `GET`                                               | Dev-only (`NODE_ENV === "development"`). Returns raw user + legacy-language resolution per course.                                                                                                  |


In `DEMO_MODE` (env `DEMO_MODE=true`):

- `/api/status` short-circuits to a small fixture payload (`{ demoMode: true, readOnly, resolvedTimezone, resolvedTimezoneSource, timezoneOverride: null }`) **without reading any DB**. None of the polling/sync/dbStatus fields are populated.
- `/api/data` reads from `data/mock.db` (seeded by `scripts/seed-mock.js`) instead of `data/duolingo.db`. The path swap happens in `getDb()` (`src/lib/db.ts`); the rest of the read pipeline is unchanged.
- Neither route requires `DUOLINGO_JWT`.

## Pause semantics

- `pauseUserPolling()` sets `userPaused = true` and calls `stopPolling()` — clears baseline, fast (if active), and nightly.
- `resumeUserPolling()` sets `userPaused = false` and calls `startPolling(client)` if a client exists and polling isn't already running.
- Manual `/api/sync` (Refresh and Sync All Languages) still works while paused. Its activity surfaces in `currentSync` + UI badge.
- Pause is **not persisted**. Process restart resumes normal polling. This guarantees nightly coverage on a long-lived self-hosted process even if the user forgets to un-pause.

Pause does not: call Duolingo directly, touch the real Duolingo app or account, or block manual refreshes.

## Cross-reference

- `**docs/api-map.md`** — Duolingo endpoints, `language_data` key resolution, `xp_daily` aggregates.
- `**docs/history-xp-semantics.md`** — History/Overview chart selector semantics, delta vs cumulative decisions, and current open chart follow-ups.
- `**TESTING.md**` — what's covered, how to run, future test backlog.
- `**README.md**` — user-facing setup and behavior.
- `**CLAUDE.md**` / `**AGENTS.md**` — agent-oriented notes.

