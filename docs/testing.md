# Testing — design, coverage, backlog

Contributor-facing reference for writing tests and planning new coverage. For the user-facing "how do I run the tests" guide, see `**TESTING.md**` at the repo root. For runtime/module structure see `**docs/architecture.md**`.

## Setup

- Runner: Jest + `ts-jest` (`jest.config.ts`).
- Environment: `node`. **No jsdom / React Testing Library** — UI-level tests are intentionally deferred (see Backlog → Deferred).
- Tests live under `src/lib/__tests__/`.
- Module alias: `@/…` maps to `src/…` (jest + tsconfig).

## Current coverage


| File                           | Covers                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `duolingo.test.ts`             | JWT parsing (`sub` null/string/number), API error handling (401/429/non-JSON), legacy endpoint URL construction (username vs numeric ID) |
| `db.test.ts`                   | Schema constraints, `NOT NULL` enforcement, upsert behavior, `first_seen` preservation, snapshot accumulation                            |
| `queries.test.ts`              | Decay detection (vocab + skills), XP stats aggregation (including freeze rows), course comparison joins, vocab-from-skills fallback      |
| `sync.test.ts`                 | Null-safe XP summary mapping, null date filtering, avatar URL protocol handling                                                          |
| `legacy-language-data.test.ts` | Resolving legacy `language_data` keys (`nb`/`no`, `zh`/`zs`, inner `language`, single-key fallback)                                      |
| `scripts.test.ts`              | Writing system classification, script skill identification, Latin/non-Latin detection, skill categorization                              |
| `language-names.test.ts`       | Language name and flag emoji lookup, unknown language fallbacks                                                                          |
| `polling.test.ts`              | Refresh cooldown enforcement, XP change detection, first-sync trigger                                                                    |


Additional invariants exercised across files:

- Dead endpoints returning HTML instead of JSON (must not parse as JSON).
- Null / missing fields on XP summaries before they hit SQLite `NOT NULL` columns.
- Snapshot-based decay (compare latest vs previous snapshot per skill/vocab).
- Protocol-relative avatar URLs (`//…` → `https://…`).
- Legacy `language_data` key resolution (e.g. `nb`/`no`, `zh`/`zs`) and `XP_STATS_SQL` aggregates (freeze rows vs practice-day counts).

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

### Path-based skill progress (`94e3fab`)

Not in this push. Add when we revisit the path-sectioned sync path.

- `buildPathProgressMap` (or equivalent helper) over `currentCourse.pathSectioned` fixtures — sections → units → levels → skills resolution, `completedUnits` gating, `finishedLevels` / `finishedSessions` extraction, behavior on malformed / partial payloads.
- Integration inside `fullSync`: given a fixture user with `pathSectioned` populated, skill snapshots land with the path-derived progress values rather than the legacy `learned`/`strength` zeros.

### Demo mode / mock data / screenshot pipeline

The biggest uncovered surface today. Goal: keep the demo story from silently drifting when the main code evolves.

- `DEMO_MODE` routing — `/api/status` short-circuits to `{ demoMode: true }`; `/api/data` reads from `data/mock.db` without requiring `DUOLINGO_JWT`.
- `scripts/seed-mock.js` produces a DB whose schema matches the live `initSchema()` — run real migrations against the seeded mock DB and assert no drift.
- Every table queried by `/api/data` has at least one row in the seeded mock DB. Fail loudly when someone adds a new query and forgets the fixture.
- `scripts/screenshot.js` smoke test — runs end-to-end against `DEMO_MODE=true` and produces the expected image files. Acceptable to mark as slow / CI-only.
- Mock DB schema drift regression — when `initSchema()` adds a column, the mock DB must have it too (via the real migration path at seed time, or an explicit assertion in tests).

### Deferred

- `SyncBar` React component — `pinned`/`suppressed` state transitions, indicator color for paused / syncing / paused+syncing, progress bar render paths (known + unknown duration). Blocked on adding jsdom + RTL.
- `/api/status` response shape — snapshot-style assertion that the UI's expected fields are always present.
- `/api/sync` and `/api/sync-course` handler-level tests.

## Writing a new test — checklist

1. File lives in `src/lib/__tests__/`, named after the module it covers.
2. If the module-under-test uses top-level `let`, reach for `jest.isolateModules`.
3. If you need a DB, construct an in-memory `better-sqlite3` and run the same migrations `initSchema()` runs — don't hand-roll divergent DDL.
4. If the test spins up any timers (e.g. `setInterval`), use Jest's fake timers or make sure to `stopPolling()` in `afterEach`.
5. Update the **Current coverage** table in this file when the test lands; tick the backlog checkbox.

