# Multi-server / split-process deployment

This is an inventory of every assumption in the codebase that
**holds today only because the writer is a single process** (single
Node, single `globalThis`, single `setInterval`). It is not a design
proposal. The intent is to know exactly what would have to move out
of process memory before a true multi-instance writer topology
becomes viable, and to give a quick "this works / this doesn't"
answer for the topologies people might try in the meantime.

## Quick recommendations

- **One normal server:** run the default `writer` role. No extra lock
  configuration is needed.
- **Multiple browsers/devices hitting that one server:** supported. Sync
  mutations are single-flight inside the writer process.
- **Display-only second process:** use `DUOLINGO_READ_ONLY=1` or
  `DUOLINGO_INSTANCE_ROLE=read-only`.
- **Second process that can sync manually:** use
  `DUOLINGO_INSTANCE_ROLE=manual` and configure the same
  `DUOLINGO_SYNC_LOCK_REDIS_URL` on every mutating process. Set
  `DUOLINGO_SYNC_LOCK_NAMESPACE` too if one Redis/Valkey serves multiple
  unrelated accounts or deployments.
- **Multiple background writers:** discouraged. The Redis/Valkey account lock
  serializes sync mutations, but each writer still has its own timers,
  cooldowns, and account-quiet state.

## Status today

| Topology                                            | Supported?              | Notes                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 writer (single Node)                              | **Yes — primary mode.** | All polling timers, the JWT, the resolver cache, and the polling state live in the writer's `globalThis`. One writer can serve multiple browsers; async requests can overlap while awaiting I/O, so all sync mutations are single-flight inside that process. SQLite WAL with a single writer.                                                                                                  |
| 1 writer + N manual instances, separate DBs, same Duolingo account | **Yes, if an external account lock is configured on every mutating instance.** | Set `DUOLINGO_INSTANCE_ROLE=manual` on non-primary instances so they do not start background timers. Set the same `DUOLINGO_SYNC_LOCK_REDIS_URL` and namespace on every instance that can sync. This coordinates the shared Duolingo active-course resource; it does not merge SQLite data or make timers cluster-aware. |
| 1 writer + N read-only displays (`DUOLINGO_READ_ONLY=1`) | **Yes — designed.**     | C2 (`docs/architecture.md` § Read-only mode). Followers open the SQLite file with `{ readonly: true, fileMustExist: true }`, never call `ensureClient`, never start polling, and 503 every write route. Reads are concurrent-safe under WAL. Caveats below under "What's broken in the C2 model already".                                                                                       |
| 2+ writers against the same DB                      | **No.**                 | SQLite WAL is single-writer. Two writers = race + corruption. Two Duolingo clients with the same JWT = doubled API load and CAPTCHA risk.                                                                                                                                                                                                                                                        |
| 2+ background writers, separate DBs, same Duolingo account | **Discouraged.** | The Redis/Valkey account lock serializes sync mutations when every mutating instance participates. Course-aware drift detection and quiet+jitter backoff make accidental/non-participating contention safer, but every writer still has its own baseline/fast/nightly timers and cooldown state. Use one `writer` and make extra test instances `manual`, unless you are deliberately testing duplicate schedulers. |
| 1 writer behind a load balancer                     | **No, unless pinned to one process.** | Polling state lives in `globalThis`; if the LB ever spawned a second worker, both would think they own the polling timers and the JWT. Next.js dev mode keeps it to one process; productionising would require pinning to a single instance or moving the writer concerns out (see "Process-local state inventory" below).                                                                       |

## Process-local state inventory

Every piece of state that lives in process memory and would diverge
across processes if a second writer were spawned. Each row has the
file it lives in and what would have to move (or be coordinated)
before it could be replicated. This is *the* reason a true multi-
writer topology is not a small change.

| State                                                       | Location                                       | Survival across restart?                                  | What multi-writer would need                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userPaused`                                                | `src/lib/server-state.ts` (via `globalThis`)   | **No, by design** — restart resumes polling.              | Persist as a DB row (`app_settings.paused`?) and turn `pauseUserPolling()` into a write + a per-process listener. Or: accept that pause is a writer-local toggle and never replicate.                                                                                              |
| `baselineTimer` / `fastTimer` / `nightlyTimer`              | `src/lib/polling.ts` (via `globalThis`)        | No (in-memory `setInterval` / `setTimeout` handles).     | Coordination primitive needed — exactly one process must own each timer. Options: leader election (advisory file lock, DB row "leader_pid + heartbeat", external lock service). Without this, every writer fires its own nightly and they collide.                                  |
| `isRunning` (single-flight mutex)                           | `src/lib/polling-state.ts` (via `globalThis`), claimed by `src/lib/sync-lock.ts` | No.                                                       | Gates all sync mutations inside one process, including requests from multiple browsers. Cross-process syncs require the optional Redis/Valkey account lock (`DUOLINGO_SYNC_LOCK_REDIS_URL`) on every mutating instance. The external lock protects the Duolingo active course, not SQLite writes or polling leadership. |
| `mode` (`"baseline"` / `"fast"` / `"course_conflict"`)       | `src/lib/polling.ts` (via `globalThis`)        | No (recomputed at startup; defaults to baseline).         | Move to a DB row so all writers agree on whether the quiet-detector is active. Without this, writer A in baseline + writer B in fast/course-conflict = duplicate coverage.                                                                                                          |
| `fastLastObservedXp` / `fastConsecutiveIdleTicks` / `accountQuietLastObservedCourseId` / `accountQuietJitterUntilMs` / `automaticCycleReason` | `src/lib/polling.ts` | No. | Same — quiet/backoff bookkeeping has to be authoritative, not per-process, if duplicate background writers are ever supported as a real topology. |
| `lastBaselineTickAtMs` / `lastNightlyAtMs` / `lastManualRefreshAtMs` | `src/lib/polling.ts`                  | No (cooldowns reset on restart).                          | These power UI cooldowns and the manual-refresh 30 s gate. Coordinate via DB rows or accept per-process cooldowns (only one writer ever sees a given user's request anyway, given the lack of LB).                                                                                |
| `lastSyncResult`                                            | `src/lib/polling.ts`                           | No.                                                       | Already partially mirrored in `sync_log` (durable). The in-memory copy is just a last-known cache for `/api/status`. A reader could query `sync_log` directly instead of relying on the writer's memory — already true for read-only mode.                                          |
| `currentSync`                                               | `src/lib/sync-state.ts`                        | No (cleared on `setCurrentSync(null)` or restart).        | Move to a DB row keyed by writer-id with a heartbeat, or accept that progress UI only works against the writer that started the sync.                                                                                                                                              |
| `client` (Duolingo SDK + JWT)                               | `src/lib/server-state.ts`                      | No (rebuilt from `DUOLINGO_JWT` env on `ensureClient`).   | One JWT = one effective Duolingo session. Multiple writers with the same JWT race for tokens and increase CAPTCHA risk. Multi-writer would require: (a) shared JWT store with refresh coordination, (b) a single "Duolingo gateway" process, or (c) accept stricter locking. |
| Resolver cache (`cachedZone`, `cachedSource`)               | `src/lib/tz.ts`                                | No (rebuilt on first read).                               | Each process caches independently. Writes to `app_settings.timezone_override` or to the stored profile zone fire `invalidateResolvedTimezone()` **only in the process that handled the write**. See "What's broken in the C2 model already" below.                                |
| `profileLoader` / `settingsLoader` (loader closures)        | `src/lib/tz.ts`                                | No (re-registered in `getDb()`).                          | Process-local by design — they wrap each process's own DB handle. Moving the cache out of `tz.ts` would moot this row.                                                                                                                                                              |
| HMR `globalThis.__duolingoPollingState`                     | `src/lib/polling.ts`                           | No.                                                       | This is an HMR fix, not a multi-process fix. Each Node process has its own `globalThis`.                                                                                                                                                                                              |

## What's broken in the C2 (read-only follower) model already

The C2 read-only mode is the only multi-process configuration we
currently support. It works for "show the dashboard on a second
machine without contending with the writer", but it has known gaps
that follow directly from the inventory above:

1. **Resolver cache is per-process.** When the writer learns a new
   Duolingo profile timezone (during sync) or the user changes
   `app_settings.timezone_override`, only the writer's
   `invalidateResolvedTimezone()` fires. The follower keeps the old
   `R` until it's restarted. Mitigation: small process; restart is
   cheap. Long-term fix: a DB-watched cache (e.g. invalidate on a
   short polling read of `app_settings.updated_at`).
2. **`dbStatus.lastSync` is the writer's view.** Followers can
   surface it, but they don't know whether the writer is *actually*
   running. A dead writer + a live follower would show stale
   "Last sync N hours ago" without any "writer is unreachable"
   indicator. Today the user would notice via the absence of new
   data; eventually we'd want a writer-heartbeat row.
3. **Nightly hour is read from `app_settings.nightly_hour` per-process.**
   The follower's `effectiveNightlyHour()` is correct (no scheduling
   happens there), but a follower can't change it via the UI — the
   selector is disabled by `!authenticated`, and `POST /api/settings`
   503s in read-only mode. As intended.
4. **The follower never updates `sync_log`.** Don't interpret
   "no recent sync from this process" as a problem on a follower.
5. **No leader-election.** If a follower is accidentally started
   without `DUOLINGO_READ_ONLY=1` and points at the same DB, it will
   try to acquire the SQLite write lock and start its own polling.
   SQLite will reject concurrent writes, but both processes will
   poll Duolingo with the same JWT, doubling the request rate. The
   external account lock can serialize sync mutations if configured,
   and course-aware drift detection can abort/back off when a
   non-participating actor changes the active course, but neither
   mechanism stops duplicate cheap polls or makes both processes
   share timer state. The safest follower remains read-only; test
   instances that need manual sync should use the `manual` role.

These are documented, not fixed. The C2 model is a "display-only
follower", not a "follower that takes over on writer failure".

## SQLite limits

- **Single writer, multiple readers** under WAL. A second writer is
  unsafe. Period.
- **Same filesystem.** Network filesystems (NFS, SMB) with WAL are
  not recommended; use a local-disk DB and replicate at the app
  layer if needed.
- **`fileMustExist: true`** on read-only opens means the follower
  cannot bootstrap an empty DB. The writer must run `initSchema`
  first.
- **`PRAGMA journal_mode = WAL`** is set by the writer; readers
  inherit it via the `-wal` and `-shm` files. If you copy the DB
  file by itself without those, readers will see stale data or fail.

## What we'd actually need for multi-writer

If, in the future, this app ever needs to scale beyond
1-writer-plus-N-readers, here is the order of operations. None of
this is built; it's the punch list.

1. **Move polling timers behind a leader-election primitive.** Only
   the leader runs `baselineTimer` / `fastTimer` / `nightlyTimer`.
   Followers are read-only display + manual-action proxies that
   forward to the leader.
2. **Persist `mode`, `fastLastObservedXp`, `fastConsecutiveIdleTicks`,
   `currentSync`, and `lastSyncResult` to DB rows** so a leader
   change doesn't lose quiet-detector progress mid-window.
3. **Move `userPaused` to a DB row** if pause should be cluster-wide.
4. **Centralize the JWT.** Either one writer holds it and others
   call into it, or pull JWT refresh into a shared store with a
   single refresher.
5. **Replace the `globalThis` polling bucket with a DB-backed
   coordination layer.** The HMR fix can stay; it's orthogonal.
6. **Resolver invalidation across processes.** Either short-poll
   `app_settings.updated_at` from each process and clear the cache
   when it changes, or move to a small pub/sub primitive (LISTEN/
   NOTIFY-style; SQLite doesn't have it natively, so this likely
   means moving off SQLite for app settings).

Items 1–5 are all "lift state out of process memory and into a
coordinated store". Item 6 is the only one that pushes against a
SQLite limitation directly.

## Cross-references

- Instance roles, external account lock, and read-only side-effects: `docs/architecture.md` § Instance roles.
- Polling pipeline + timers: `docs/architecture.md` § Polling pipeline.
- Resolver cache + DST: `docs/architecture.md` § Timezone model § DST policy.
- HMR `globalThis` polling bucket: `src/lib/polling.ts` (via `getPollingState()`).
- Tests for the bucket: `src/lib/__tests__/polling.test.ts` ("HMR `globalThis` polling bucket").
