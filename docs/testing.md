# Testing — design, coverage, backlog

Contributor-facing reference for writing tests and planning new coverage. For the user-facing "how do I run the tests" guide, see `**TESTING.md**` at the repo root. For runtime/module structure see `**docs/architecture.md**`.

## Setup

- Runner: Jest + `ts-jest` (`jest.config.ts`).
- Environment: `node`. **No jsdom / React Testing Library** — UI-level tests are intentionally deferred (see Backlog → Deferred).
- Library tests live under `src/lib/__tests__/`; route handler tests live beside
  their route under `src/app/api/**/__tests__/`.
- Module alias: `@/…` maps to `src/…` (jest + tsconfig).

## Current coverage


| File                           | Covers                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `duolingo.test.ts`             | JWT parsing (`sub` null/string/number), API error handling (401/429/non-JSON), legacy endpoint URL construction (username vs numeric ID) |
| `db.test.ts`                   | Schema constraints, `NOT NULL` enforcement, upsert behavior, `first_seen` preservation, snapshot accumulation, `migrateUserProfileTimezone` idempotency |
| `queries.test.ts`              | Decay detection (vocab + skills), XP stats aggregation (including freeze rows), course comparison joins, vocab-from-skills fallback      |
| `queries-windowing.test.ts`    | `getCourseXpHistory` / `getCourseXpDailyHistory` row-count windowing; ideal-anchor / `_pretrack` stacks; **timezone**: `LOCAL_DATE` bucketing vs UTC evening snapshots (PT regression), `getXpDaily(N)` window anchored in R (PT + IST regressions), UTC/IST control cases |
| `tz.test.ts`                   | Resolved zone **R** priority (settings loader → `DUOLINGO_TZ` → profile loader → system), cache invalidation, settings-loader fallthrough on null/empty/throw, `formatLocalDate` boundaries (PT/IST/UTC), `epochMsForLocalTime` / DST round-trips |
| `sync.test.ts`                 | Null-safe XP summary mapping, null date filtering, avatar URL protocol handling                                                          |
| `sync-skill-progress.test.ts`  | Skill sync overlays path-derived completion onto live legacy skill words, and falls back to latest stored word maps when live legacy skills are empty |
| `legacy-language-data.test.ts` | Resolving legacy `language_data` keys (`nb`/`no`, `zh`/`zs`, inner `language`, single-key fallback)                                      |
| `scripts.test.ts`              | Writing system classification, script skill identification, Latin/non-Latin detection, skill categorization                              |
| `language-names.test.ts`       | Language name and flag emoji lookup, unknown language fallbacks                                                                          |
| `polling.test.ts`              | Refresh cooldown enforcement, XP change detection, first-sync trigger, `advanceSyncState` reducer, automatic account-quiet jitter retry, preserved course-order recovery target retry, final pre-retry XP/course recheck, gate-busy re-monitoring, nightly entering the same account-quiet gate, manual refresh external-lock/conflict skips, `msUntilNextLocalTime` (next 02:00 in **R**), HMR `globalThis` polling bucket |
| `sync-cycle-order.test.ts`     | All-course sync course-selector order preservation, pre-conflict course-order recovery, incompatible recovery fallback, active-course / XP drift conflicts, drift-only per-course detail atomicity, manual per-course restore success/failure reporting |
| `logger.test.ts`               | `LOG_LEVEL` parsing/defaults, debug suppression, structured metadata, no automatic secret/JWT logging |
| `sync-lock.test.ts`            | Process-local sync single-flight gate: idle acquisition, busy rejection via `isRunning` or `currentSync`, release after success / throw, external-lock busy release of the local gate, combined local+external release |
| `external-sync-lock.test.ts`   | Optional Redis/Valkey account lock: disabled without URL, `SET NX PX` acquire, heartbeat, owner-token release, busy response, fail-closed unavailable response |
| `instance-role.test.ts`        | Role parsing: default `writer`, `manual`, `read-only`, and `DUOLINGO_READ_ONLY=1` compatibility |
| `course-preferences.test.ts`   | Browser-local preferred course selection order: last visited course, active profile course, first local course                           |
| `vocab-bundles.test.ts`        | Skill-bundle vocabulary model: status classification, defensive `words_json` parsing, course-order sorting, unique flat word rows with skill context |
| `read-only.test.ts`            | `isReadOnlyMode()` truth table for `DUOLINGO_READ_ONLY` (1/true/yes → true; 0/false/no/empty/random → false), case insensitive |
| `server-state.test.ts` (read-only/manual blocks) | `ensureClient` throws read-only error before checking JWT and never starts polling; `getClientOrNull` returns null without constructing a client; manual mode creates the JWT client but does not start/resume background polling |
| `src/app/api/data/__tests__/route.test.ts` | GET `/api/data`: auth gate, `q=course-xp-history` / `course-xp-daily-history` → correct `queries.ts` arguments and JSON body passthrough (chart consumer contract at HTTP boundary) |
| `src/app/api/sync/__tests__/route.test.ts` | POST `/api/sync`: `DUOLINGO_READ_ONLY` (`1`/`true`/`yes`) → 503 `{ error: "read-only" }` and never invokes `ensureClient`/`fullSync`/`manualRefresh`; normal mode dispatches `manualRefresh` vs `fullSync(_, cycleAll)` correctly; local/external busy force-sync returns skipped without calling `fullSync`; active-course conflict results do not send completion notification |
| `src/app/api/sync-course/__tests__/route.test.ts` | POST `/api/sync-course`: 503 in read-only without touching the writer path; 400 on missing required params; local/external busy writer returns skipped/error shape without calling `syncCourseDetails`; active-course conflict results preserve `switchedBack: false` |
| `src/app/api/polling/__tests__/route.test.ts` (read-only block) | POST `/api/polling`: 503 `{ error: "read-only" }` in read-only mode without touching pause/resume/ensureClient |
| `src/app/api/status/__tests__/route.test.ts` | GET `/api/status`: writer payload forwards account-quiet / course-conflict / course-order recovery timing state and expected durations; read-only payload preserves the inactive sync-state shape without constructing a client |
| `app-settings.test.ts` | `getAppSettings` / `updateAppSettings`: NULL-default fallthrough for fresh row, missing row, missing table; partial-field updates; `null` resets a field; empty-partial no-op. `effectiveNightlyHour`: NULL → `NIGHTLY_HOUR_DEFAULT` (23); valid 0..23 read-through; out-of-range / non-integer / DB-missing fallback to default |
| `src/app/api/settings/__tests__/route.test.ts` | GET `/api/settings`: returns effective `nightlyHour` + stored `timezoneOverride`. POST `nightlyHour`: integer 0..23 or null (boundary checks); `null` resets to default; non-integer / out-of-range / non-numeric → 400 with no DB write; change calls `rescheduleNightly()`; **does NOT** call `invalidateResolvedTimezone()`. POST `timezoneOverride`: valid IANA → 200 + DB write + `invalidateResolvedTimezone()` + **does NOT** reschedule; trims whitespace; null/empty/whitespace → reset + still invalidates cache; invalid IANA name (`Mars/Olympus_Mons`, `not_a_zone`, numbers, booleans) → 400 with no DB write or invalidate. POST body: empty body → 400; invalid JSON → 400. **Read-only mode** → 503 `{ error: "read-only" }` for both fields with no DB write, no reschedule, no invalidate |


Additional invariants exercised across files:

- Dead endpoints returning HTML instead of JSON (must not parse as JSON).
- Null / missing fields on XP summaries before they hit SQLite `NOT NULL` columns.
- Snapshot-based decay (compare latest vs previous snapshot per skill/vocab).
- Protocol-relative avatar URLs (`//…` → `https://…`).
- Legacy `language_data` key resolution (e.g. `nb`/`no`, `zh`/`zs`) and `XP_STATS_SQL` aggregates (freeze rows vs practice-day counts).
- SQLite `LOCAL_DATE` UDF + `queries.ts` date walks: snapshot rows bucket by resolved calendar day, not raw UTC `DATE()`.

## What is intentionally not tested

- **React components / UI behavior.** No jsdom/RTL. Re-evaluate if UI state machines grow (e.g. `SyncBar`'s `pinned`/`suppressed`/`focused`/`hover`).
- **End-to-end browser flows.** Out of scope.
- **Live Duolingo API calls.** The client is exercised via fixtures; real requests never happen in tests.

## Conventions

- Prefer narrow unit tests over broad integration when the module boundary is clean (`src/lib/`* without React).
- When a module uses top-level `let` singletons (e.g. `server-state.ts`, `polling.ts`, `sync-state.ts`), use `jest.isolateModules` per case so each test gets a fresh module.
- Fixtures for Duolingo payloads live inline in the test file unless they're large and reused — then move them to `src/lib/__tests__/fixtures/`.
- `ts-jest` compiles on the fly; no separate build step before testing.
- Never hit duolingo.com from a test. If a test needs `DuolingoClient`, stub it.

## History chart decisions

Decision/status notes for History/Overview XP semantics live in `docs/history-xp-semantics.md`.

## Backlog

Planned tests, grouped by surface. Roughly priority-ordered within each group. Items marked `[x]` have landed; promote them into the **Current coverage** table once their home file stabilizes.

### Pause / progress feature surface (this push)

- [x] `migrateSyncLog` idempotency — runs twice safely, adds `duration_ms` and `cycle_all` only when missing, pre-existing rows get `cycle_all = 0` via the column default. (`sync-log.test.ts`)
- [x] `logSync` options signature — full syncs persist `durationMs` + `cycleAll`, quick syncs insert with `duration_ms = NULL` and `cycle_all = 0`. (`sync-log.test.ts`)
- [x] `getMedianDurationMs(cycleAll, limit)` — filters on `sync_type = 'full'` AND `success = 1` AND `cycle_all` AND non-null `duration_ms`; returns median of the most recent `limit` rows; returns `null` when no rows match; `cycle_all` rows don't cross-contaminate. (`sync-log.test.ts`)
- [x] `sync-state.ts` — default `null`; `setCurrentSync` populates with recent `startedAtMs`; `clearCurrentSync` resets; second `setCurrentSync` overwrites (last-write-wins). (`sync-state.test.ts`)
- [x] `server-state` pause/resume — `isUserPaused()` default false; `pauseUserPolling()` stops polling; `resumeUserPolling()` restarts if a client exists; `ensureClient()` does **not** `startPolling` when `userPaused === true`. Uses `jest.doMock` on `./polling` + `./duolingo` so no timers start. (`server-state.test.ts`)
- [x] `/api/polling` route — handler-level test: `{ action: "pause" }` → 200 + `{ paused: true, polling: false }`; `{ action: "resume" }` → 200 + `{ paused: false, polling: true }`; invalid/missing/malformed action → 400; `ensureClient` failure → 500; ordering guarantee `ensureClient` before `resumeUserPolling`. (`src/app/api/polling/__tests__/route.test.ts`)
- [x] `polling.ts` kickoff guard — regression for commit `84935f3`: `shouldKickoffPoll({isRunning, currentSync})` returns false when either guard is set. Predicate extracted from the inline condition in `startPolling`; behavior unchanged. (`polling.test.ts`)
- [x] `fullSync` clears `currentSync` in a `finally` even when the call throws. Error path only (see `fullsync-instrumentation.test.ts` header for scope rationale): asserts `currentSync.type` during the in-flight call is `single`/`cycle` as expected, is `null` after the call returns, and that `logSync` receives the right error metadata. Success path is structurally protected by the same finally and is planned alongside path-based skill progress fixtures. (`fullsync-instrumentation.test.ts`)

### Streak epoch tracking (`updateStreakEpochs`, `backfillImpliedFreeze`, `migrateStreakTracking`)

Logic is non-trivial and directly drives chart coloring correctness. All three functions are in `src/lib/db.ts`.

**`migrateStreakTracking`:**
- Idempotency — run twice on the same DB, `implied_freeze` column appears exactly once, existing rows unchanged.

**`updateStreakEpochs`:**
- Intra-day guard — `currentStreakStart >= today` → function returns early, no row written.
- First-sync case — no open epoch exists → inserts initial epoch with `streak_end_date = NULL`.
- Same-start no-op — open epoch already has `streak_start_date = currentStreakStart` → no changes.
- Epoch transition — different `currentStreakStart`: closes old epoch (`streak_end_date = newStart - 1 day`, `streak_length = previousStreakLength`), opens new epoch.
- Idempotency across transitions — calling twice with the same new start doesn't duplicate rows (`INSERT OR IGNORE`).

**`backfillImpliedFreeze`:**
- WHERE clause correctness — sets `implied_freeze = 1` only for rows where `date >= currentStreakStart AND date < LOCAL_DATE(datetime('now')) AND gained_xp = 0 AND streak_extended = 0 AND frozen = 0` (cutoff is **today** in resolved zone **R**, not UTC `DATE('now')`).
- `date < LOCAL_DATE(datetime('now'))` boundary — today's row is never touched (handles intra-day sync before practice).
- Already-set rows — `implied_freeze = 0` filter means already-set rows are not redundantly updated (idempotent).
- Rows outside the streak window — zero-XP rows before `currentStreakStart` must remain `implied_freeze = 0`.

### Stacked XP chart — data logic (`course-xp-history` and `course-xp-daily-history`)

Core of both features is non-trivial JS computation in `queries.ts`. UI is intentionally untested; the data layer is not.

**`getCourseXpHistory` (History page, delta/cumulative modes):**
- Forward-fill — sparse snapshots per course: each date carries the most recent prior `xp`, not zero.
- Mode handling:
  - delta mode (`days=N` or `days=all`) stores per-course gains, uses `_prior` baseline floor, and preserves `_prior + _pretrack + Σcourses = _total`.
  - cumulative mode (no `days`) stores per-course totals, `_prior = 0`, `_pretrack` bridges to the ideal/profile-aligned total.
- Edge cases: no snapshots in window; single snapshot (forward-fill to end of range).

**`getCourseXpDailyHistory` (incremental, Overview page):**
- Delta computation — day-over-day diff from `course_snapshots.xp`; a day with no snapshot for a course must produce delta 0, not carry forward.
- Baseline seeding — the last snapshot strictly before `startStr` seeds `lastKnown`; first-ever snapshot for a course yields delta 0 (no prior reference).
- Untracked gap — `_untracked = max(0, xp_daily.gained_xp - sum_of_course_deltas)` per day; verify it is 0 when deltas match or exceed the daily total, and positive when snapshot coverage is incomplete.
- All-zero day — a day with no snapshots for any course and a non-zero `xp_daily` entry should produce all-zero language deltas and a non-zero `_untracked`.

### Resolved timezone (R) — `tz.ts`, `LOCAL_DATE`, charts, `/api/status`

- [x] Resolver priority, `formatLocalDate`, cache invalidation (`tz.test.ts`).
- [x] `LOCAL_DATE` snapshot bucketing vs UTC `DATE()` — PT / UTC / IST regressions (`queries-windowing.test.ts`).
- [x] `migrateUserProfileTimezone` idempotency (`db.test.ts`).
- [x] `msUntilNextLocalTime` next 02:00 in R (`polling.test.ts` — uses `TZ` / `Intl` for deterministic host zone in those cases).

### Path-based skill progress (`94e3fab`)

Not in this push. Add when we revisit the path-sectioned sync path.

- `buildPathProgressMap` (or equivalent helper) over `currentCourse.pathSectioned` fixtures — sections → units → levels → skills resolution, `completedUnits` gating, `finishedLevels` / `finishedSessions` extraction, behavior on malformed / partial payloads.
- Integration inside `fullSync`: given a fixture user with `pathSectioned` populated, skill snapshots land with the path-derived progress values rather than the legacy `learned`/`strength` zeros.

### Demo mode / mock data / screenshot pipeline

**Capture is automated** (`npm run screenshots` → `scripts/screenshots.js`); the items below are still the biggest *test* gaps for keeping the demo story from silently drifting when the main code evolves.

Contributors changing chart components (`DailyMetricChart`, `StackedXpChart`, `XpChart`, …) should re-run `npm run screenshots` before merge so `docs/screenshots/` stays accurate for review.

- `DEMO_MODE` routing — `/api/status` short-circuits with a small fixture (`demoMode`, `readOnly`, `resolvedTimezone`, `resolvedTimezoneSource`, `timezoneOverride: null`); `/api/data` reads from `data/mock.db` without requiring `DUOLINGO_JWT`.
- `scripts/seed-mock.js` produces a DB whose schema matches the live `initSchema()` — run real migrations against the seeded mock DB and assert no drift.
- Every table queried by `/api/data` has at least one row in the seeded mock DB. Fail loudly when someone adds a new query and forgets the fixture.
- [x] Mock screenshot story consistency — seeded `xp_daily` account totals cover seeded per-course snapshot deltas for standard screenshot windows / anchor intervals, while preserving the streak-loss/freeze/gap narrative and all-time pre-tracking gap (`seed-mock.test.ts`).
- `scripts/screenshots.js` / `npm run screenshots` **CI smoke test** — assert exit 0 and expected files under `docs/screenshots/` (acceptable to mark slow / CI-only). The script itself is the manual workflow replacement; automated *assertion* in Jest is still open.
- Mock DB schema drift regression — when `initSchema()` adds a column, the mock DB must have it too (via the real migration path at seed time, or an explicit assertion in tests).

### Deferred

- `SyncBar` React component — `pinned`/`suppressed` state transitions, indicator color for paused / syncing / paused+syncing, progress bar render paths (known + unknown duration), Read-only badge / hidden write-button branches. Blocked on adding jsdom + RTL.

**Done (chart API wiring + write-route guards):**

- [x] GET `/api/data` — `course-xp-history` / `course-xp-daily-history` query dispatch (`src/app/api/data/__tests__/route.test.ts`).
- [x] POST `/api/sync` and `/api/sync-course` handler-level tests, with read-only 503 guards.
- [x] GET `/api/status` response shape — account-quiet/course-conflict fields for writer mode and inactive sentinels for read-only mode (`src/app/api/status/__tests__/route.test.ts`).

## Writing a new test — checklist

1. Library tests live in `src/lib/__tests__/`, named after the module they cover. Route handler tests live beside the route under `src/app/api/**/__tests__/`.
2. If the module-under-test uses top-level `let`, reach for `jest.isolateModules`.
3. If you need a DB, construct an in-memory `better-sqlite3` and run the same migrations `initSchema()` runs — don't hand-roll divergent DDL.
4. If the test spins up any timers (e.g. `setInterval`), use Jest's fake timers or make sure to `stopPolling()` in `afterEach`.
5. Update the **Current coverage** table in this file when the test lands; tick the backlog checkbox.
