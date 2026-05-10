import { DuolingoClient } from "./duolingo";
import { quickCheck, fullSync, SyncResult } from "./sync";
import { getCurrentSync, CurrentSync } from "./sync-state";
import { getPollingState, type AutomaticCycleReason } from "./polling-state";
import { epochMsForLocalTime, getLocalParts } from "./tz";
import { getAppSettings } from "./app-settings";
import { SYNC_ALREADY_RUNNING, tryAcquireAccountSyncGate } from "./sync-lock";
import { isActiveCourseConflictResult } from "./sync-conflict";
import { logger } from "./logger";

/**
 * @internal exported for tests
 *
 * The kickoff baseline tick inside `startPolling` must not run when another
 * sync is already in flight. Regression guard for the resume-during-sync
 * case (commit 84935f3): `isRunning` covers the interval-tick or manual-
 * refresh path, and `currentSync` covers a `fullSync` started by any other
 * caller.
 */
export function shouldKickoffPoll(state: {
  isRunning: boolean;
  currentSync: CurrentSync | null;
}): boolean {
  return !state.isRunning && state.currentSync == null;
}

function skippedBecauseSyncRunning(totalXp = 0, reason = SYNC_ALREADY_RUNNING): SyncResult {
  return {
    type: "skipped",
    changed: false,
    totalXp,
    error: reason,
    timestamp: new Date().toISOString(),
  };
}

// ─── Cadence ──────────────────────────────────────────────────────────────
// Baseline: poll totalXp every 30 minutes. If it has changed since the last
// successful full sync, enter fast mode.
export const BASELINE_POLL_MS = 30 * 60 * 1000;
// Account-quiet mode: poll account state every 2 minutes. Any observed XP or
// active-course change resets the quiet counter; 5 consecutive unchanged ticks
// (10 minutes of quiet) schedule an automatic cycle sync after jitter.
export const FAST_POLL_MS = 2 * 60 * 1000;
export const FAST_IDLE_TRIGGER_TICKS = 5;
export const ACCOUNT_QUIET_JITTER_MIN_MS = 30 * 1000;
export const ACCOUNT_QUIET_JITTER_MAX_MS = 120 * 1000;
// Nightly: single sync at 23:00 in resolved zone (R) by default.
// `effectiveNightlyHour()` reads `app_settings.nightly_hour` at scheduling
// time so a UI change re-arms the next setTimeout without a process restart.
export const NIGHTLY_HOUR_DEFAULT = 23;
/** @deprecated kept as the documented default; runtime should call `effectiveNightlyHour()`. */
export const NIGHTLY_HOUR_LOCAL = NIGHTLY_HOUR_DEFAULT;

/**
 * The hour of day (0..23) when the nightly sync fires, in **R**.
 * Reads `app_settings.nightly_hour` and falls back to `NIGHTLY_HOUR_DEFAULT`
 * when unset or out of range. Read at scheduling time, not at module load,
 * so settings updates take effect on the next `scheduleNightly` call.
 */
export function effectiveNightlyHour(): number {
  let v: number | null;
  try {
    v = getAppSettings().nightly_hour;
  } catch {
    // If the DB isn't initialized yet (rare, e.g. very early boot) fall
    // back to the default rather than crashing the timer schedule.
    return NIGHTLY_HOUR_DEFAULT;
  }
  if (v == null) return NIGHTLY_HOUR_DEFAULT;
  if (!Number.isInteger(v) || v < 0 || v > 23) return NIGHTLY_HOUR_DEFAULT;
  return v;
}
// Manual /api/sync cooldown — unchanged from prior design.
const MIN_MANUAL_REFRESH_MS = 30 * 1000;

// ─── Pure helpers (unit-testable without fake timers) ─────────────────────

/**
 * Pure state-machine reducer for the XP quiet-detector.
 *
 * Events:
 *  - `baseline_tick { changed }`: a 30-min baseline poll finished.
 *    `changed` = (currentXp !== lastSyncedXp).
 *  - `fast_tick { changed }`: a 2-min account-quiet poll finished.
 *    `changed` = account XP or active course differed from the previous
 *    observation.
 *  - `external_fullsync_done`: any `fullSync` triggered by a path other than
 *    the fast-poll idle trigger (nightly, manual, etc.) completed.
 *
 * Rules:
 *  - baseline + change → fast (idle counter = 0).
 *  - baseline + no-change → baseline (no-op).
 *  - fast + change → fast (idle counter = 0).
 *  - fast + no-change → fast (idle counter += 1); at 5, signal fullSync and
 *    signal automatic cycle readiness.
 *  - external full-sync completed at any time → baseline.
 */
export type SyncMode = "baseline" | "fast";
export type RuntimeSyncMode = SyncMode | "course_conflict";
export type SyncStateSnapshot = {
  mode: SyncMode;
  fastConsecutiveIdleTicks: number;
};
export type SyncEvent =
  | { type: "baseline_tick"; changed: boolean }
  | { type: "fast_tick"; changed: boolean }
  | { type: "external_fullsync_done" };
export type SyncTransition = {
  state: SyncStateSnapshot;
  fireFullSync: boolean;
};

export function advanceSyncState(
  state: SyncStateSnapshot,
  event: SyncEvent,
): SyncTransition {
  if (event.type === "external_fullsync_done") {
    return { state: { mode: "baseline", fastConsecutiveIdleTicks: 0 }, fireFullSync: false };
  }

  if (event.type === "baseline_tick") {
    if (state.mode !== "baseline") {
      return { state, fireFullSync: false };
    }
    if (event.changed) {
      return { state: { mode: "fast", fastConsecutiveIdleTicks: 0 }, fireFullSync: false };
    }
    return { state, fireFullSync: false };
  }

  // fast_tick
  if (state.mode !== "fast") {
    return { state, fireFullSync: false };
  }
  if (event.changed) {
    return { state: { mode: "fast", fastConsecutiveIdleTicks: 0 }, fireFullSync: false };
  }
  const nextTicks = state.fastConsecutiveIdleTicks + 1;
  if (nextTicks >= FAST_IDLE_TRIGGER_TICKS) {
    return { state: { mode: "fast", fastConsecutiveIdleTicks: nextTicks }, fireFullSync: true };
  }
  return {
    state: { mode: "fast", fastConsecutiveIdleTicks: nextTicks },
    fireFullSync: false,
  };
}

/**
 * Compute ms until the next occurrence of `hour:00:00.000` in the
 * resolved server zone (R), not the host's process-local zone.
 *
 * Recomputed fresh each nightly cycle so DST transitions, clock skew,
 * resolver-source changes, and process sleep/wake all settle on the
 * next call rather than drifting silently.
 */
export function msUntilNextLocalTime(hour: number, now: number = Date.now()): number {
  // "Today" in R, anchored at the requested hour.
  const parts = getLocalParts(now);
  let target = epochMsForLocalTime(parts.year, parts.month, parts.day, hour);
  if (target <= now) {
    // Roll the *R-local* day forward, then convert back to epoch ms.
    // Date math via UTC midnight keeps the day-bump zone-agnostic; the
    // epoch conversion below picks the right offset (incl. across DST).
    const utc = Date.UTC(parts.year, parts.month - 1, parts.day) + 86400000;
    const next = new Date(utc);
    target = epochMsForLocalTime(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      hour,
    );
  }
  return target - now;
}

// ─── Timer mechanics ──────────────────────────────────────────────────────

type AccountObservation = {
  totalXp: number;
  currentCourseId: string;
};

function enterAccountQuietMode(
  client: DuolingoClient,
  reason: AutomaticCycleReason,
  seed?: Partial<AccountObservation>,
): void {
  const state = getPollingState();
  state.client = client;
  state.mode = reason === "active_course_conflict" ? "course_conflict" : "fast";
  state.fastLastObservedXp = seed?.totalXp ?? null;
  state.fastConsecutiveIdleTicks = 0;
  state.accountQuietLastObservedCourseId = seed?.currentCourseId ?? null;
  state.automaticCycleReason = reason;
  clearAccountQuietJitter();
  logger.debug("account quiet detector entered", {
    reason,
    seedXp: seed?.totalXp ?? null,
    seedCourseId: seed?.currentCourseId ?? null,
  });
  if (state.fastTimer) return;
  state.fastTimer = setInterval(() => {
    if (state.client) void fastTick(state.client);
  }, FAST_POLL_MS);
}

function exitFastMode(): void {
  const state = getPollingState();
  state.mode = "baseline";
  state.fastLastObservedXp = null;
  state.fastConsecutiveIdleTicks = 0;
  state.accountQuietLastObservedCourseId = null;
  state.automaticCycleReason = null;
  clearAccountQuietJitter();
  if (state.fastTimer) {
    clearInterval(state.fastTimer);
    state.fastTimer = null;
  }
}

function clearAccountQuietJitter(): void {
  const state = getPollingState();
  if (state.accountQuietJitterTimer) {
    clearTimeout(state.accountQuietJitterTimer);
    state.accountQuietJitterTimer = null;
  }
  state.accountQuietJitterUntilMs = null;
}

export function randomAccountQuietJitterMs(random: () => number = Math.random): number {
  const span = ACCOUNT_QUIET_JITTER_MAX_MS - ACCOUNT_QUIET_JITTER_MIN_MS;
  return Math.min(
    ACCOUNT_QUIET_JITTER_MAX_MS,
    ACCOUNT_QUIET_JITTER_MIN_MS + Math.floor(random() * (span + 1)),
  );
}

async function baselineTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (state.mode !== "baseline") return;
  if (state.isRunning) return;
  state.lastBaselineTickAtMs = Date.now();
  logger.debug("baseline tick");
  try {
    const { changed, currentXp } = await quickCheck(client);
    const transition = advanceSyncState(
      { mode: state.mode, fastConsecutiveIdleTicks: state.fastConsecutiveIdleTicks },
      { type: "baseline_tick", changed },
    );
    if (transition.state.mode === "fast") {
      enterAccountQuietMode(client, "xp_changed", { totalXp: currentXp });
    }
  } catch {
    // quickCheck failures are intentionally swallowed — they're cheap and
    // the next tick will retry.
  }
}

async function fastTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (state.mode === "fast" || state.mode === "course_conflict") {
    await accountQuietTick(client);
    return;
  }
  // Defensive: timer should have been cleared. Clear it now and bail.
  if (state.fastTimer) {
    clearInterval(state.fastTimer);
    state.fastTimer = null;
  }
}

async function accountQuietTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (
    (state.mode !== "fast" && state.mode !== "course_conflict")
    || state.isRunning
    || state.accountQuietJitterTimer
  ) return;
  logger.debug("account quiet tick", {
    reason: state.automaticCycleReason,
    idleTicks: state.fastConsecutiveIdleTicks,
    lastCourseId: state.accountQuietLastObservedCourseId,
  });

  const observation = await readAccountObservation(client);
  if (!observation) {
    return;
  }

  const changed = accountObservationChanged(state, observation);

  state.fastLastObservedXp = observation.totalXp;
  state.accountQuietLastObservedCourseId = observation.currentCourseId;

  if (changed) {
    state.fastConsecutiveIdleTicks = 0;
    logger.debug("account quiet reset", {
      reason: state.automaticCycleReason,
      currentXp: observation.totalXp,
      currentCourseId: observation.currentCourseId,
    });
    return;
  }

  const transition = advanceSyncState(
    { mode: "fast", fastConsecutiveIdleTicks: state.fastConsecutiveIdleTicks },
    { type: "fast_tick", changed: false },
  );
  state.fastConsecutiveIdleTicks = transition.state.fastConsecutiveIdleTicks;
  if (transition.fireFullSync) {
    scheduleAccountQuietJitter(client);
  }
}

function scheduleAccountQuietJitter(client: DuolingoClient): void {
  const state = getPollingState();
  if (state.accountQuietJitterTimer) return;
  const delay = randomAccountQuietJitterMs();
  state.accountQuietJitterUntilMs = Date.now() + delay;
  logger.info("account quiet jitter scheduled", {
    reason: state.automaticCycleReason,
    delayMs: delay,
  });
  if (state.fastTimer) {
    clearInterval(state.fastTimer);
    state.fastTimer = null;
  }
  state.accountQuietJitterTimer = setTimeout(() => {
    state.accountQuietJitterTimer = null;
    state.accountQuietJitterUntilMs = null;
    void retryAutomaticCycle(client);
  }, delay);
}

async function retryAutomaticCycle(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (state.mode !== "fast" && state.mode !== "course_conflict") return;
  logger.info("account quiet jitter retry", { reason: state.automaticCycleReason });

  const observation = await readAccountObservation(client);
  if (!observation) {
    enterAccountQuietMode(client, state.automaticCycleReason ?? "retry_error");
    return;
  }
  if (accountObservationChanged(state, observation)) {
    logger.debug("account quiet retry precheck reset", {
      reason: state.automaticCycleReason,
      currentXp: observation.totalXp,
      currentCourseId: observation.currentCourseId,
    });
    enterAccountQuietMode(client, state.automaticCycleReason ?? "retry_error", observation);
    return;
  }
  state.fastLastObservedXp = observation.totalXp;
  state.accountQuietLastObservedCourseId = observation.currentCourseId;

  const gate = await tryAcquireAccountSyncGate(client);
  if (!gate.acquired) {
    logger.debug("account quiet retry gate busy", { reason: gate.reason });
    enterAccountQuietMode(client, "gate_busy", observation);
    return;
  }
  try {
    state.lastSyncResult = await fullSync(client, true);
    if (isActiveCourseConflictResult(state.lastSyncResult)) {
      enterAccountQuietMode(client, "active_course_conflict");
      return;
    }
    if (state.automaticCycleReason === "nightly") {
      state.lastNightlyAtMs = Date.now();
    }
    exitFastMode();
  } catch (err) {
    logger.warn("automatic cycle retry failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    enterAccountQuietMode(client, "retry_error", observation);
  } finally {
    await gate.release();
  }
}

async function readAccountObservation(client: DuolingoClient): Promise<AccountObservation | null> {
  try {
    const user = await client.getUser();
    return { totalXp: user.totalXp, currentCourseId: user.currentCourseId };
  } catch (err) {
    logger.debug("account quiet observation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function accountObservationChanged(
  state: ReturnType<typeof getPollingState>,
  observation: AccountObservation,
): boolean {
  return (
    (state.fastLastObservedXp !== null && observation.totalXp !== state.fastLastObservedXp)
    || (state.accountQuietLastObservedCourseId !== null
      && observation.currentCourseId !== state.accountQuietLastObservedCourseId)
  );
}

/** @internal tests */
export async function __runFastTickForTests(client: DuolingoClient): Promise<void> {
  await fastTick(client);
}

/** @internal tests */
export async function __runNightlyTickForTests(client: DuolingoClient): Promise<void> {
  await nightlyTick(client);
}

/**
 * Runs at the configured local time. Decision logic:
 *  - If isRunning → skip and re-arm. (Quiet-detector / manual is already
 *    taking care of things.)
 *  - Else quickCheck to seed account-quiet monitoring cheaply.
 *  - Automatic cycle-all always goes through the same account-quiet gate:
 *    XP and active course must both stay stable, then jitter runs, then a
 *    final observation happens before acquiring the sync gate.
 */
async function nightlyTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  try {
    if (state.isRunning) return;
    logger.info("nightly tick");

    let currentXp: number;
    try {
      const res = await quickCheck(client);
      currentXp = res.currentXp;
    } catch {
      return;
    }

    if (state.mode === "baseline") {
      enterAccountQuietMode(client, "nightly", { totalXp: currentXp });
      return;
    }
  } finally {
    scheduleNightly(client);
  }
}

function scheduleNightly(client: DuolingoClient): void {
  const state = getPollingState();
  if (state.nightlyTimer) {
    clearTimeout(state.nightlyTimer);
    state.nightlyTimer = null;
  }
  const delay = msUntilNextLocalTime(effectiveNightlyHour());
  logger.debug("nightly scheduled", { delayMs: delay });
  state.nightlyTimer = setTimeout(() => {
    state.nightlyTimer = null;
    void nightlyTick(client);
  }, delay);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function startPolling(client: DuolingoClient): void {
  const state = getPollingState();
  state.client = client;
  if (state.baselineTimer) return;
  logger.info("polling start");

  state.baselineTimer = setInterval(() => {
    void baselineTick(client);
  }, BASELINE_POLL_MS);

  scheduleNightly(client);

  // Kickoff: run a baseline check once, but only if no sync is in flight.
  if (shouldKickoffPoll({ isRunning: state.isRunning, currentSync: getCurrentSync() })) {
    void baselineTick(client);
  }
}

export function stopPolling(): void {
  const state = getPollingState();
  if (state.baselineTimer) {
    clearInterval(state.baselineTimer);
    state.baselineTimer = null;
  }
  if (state.fastTimer) {
    clearInterval(state.fastTimer);
    state.fastTimer = null;
  }
  clearAccountQuietJitter();
  if (state.nightlyTimer) {
    clearTimeout(state.nightlyTimer);
    state.nightlyTimer = null;
  }
  state.mode = "baseline";
  state.fastLastObservedXp = null;
  state.fastConsecutiveIdleTicks = 0;
  state.accountQuietLastObservedCourseId = null;
  state.automaticCycleReason = null;
}

export async function manualRefresh(client: DuolingoClient): Promise<SyncResult & { cooldownRemaining?: number }> {
  const state = getPollingState();
  const now = Date.now();
  const elapsed = now - state.lastManualRefreshAtMs;
  if (elapsed < MIN_MANUAL_REFRESH_MS) {
    return {
      type: "skipped",
      changed: false,
      totalXp: state.lastSyncResult?.totalXp ?? 0,
      timestamp: new Date().toISOString(),
      cooldownRemaining: Math.ceil((MIN_MANUAL_REFRESH_MS - elapsed) / 1000),
    };
  }
  if (state.isRunning) {
    return skippedBecauseSyncRunning(state.lastSyncResult?.totalXp ?? 0);
  }
  const gate = await tryAcquireAccountSyncGate(client);
  if (!gate.acquired) {
    return skippedBecauseSyncRunning(state.lastSyncResult?.totalXp ?? 0, gate.reason);
  }
  state.lastManualRefreshAtMs = now;
  try {
    state.lastSyncResult = await fullSync(client);
    return state.lastSyncResult;
  } finally {
    await gate.release();
  }
}

export function getLastSyncResult(): SyncResult | null {
  return getPollingState().lastSyncResult;
}

export function isPolling(): boolean {
  return getPollingState().baselineTimer !== null;
}

export function isCurrentlyRunning(): boolean {
  return getPollingState().isRunning;
}

export type SyncTimingStatus = {
  msUntilNextXpCheck: number | null;
  msUntilNextNightlySync: number | null;
  syncMode: RuntimeSyncMode;
  fastIdleTicks: number;
  fastIdleTicksRequired: number;
  courseConflict: {
    active: boolean;
    lastObservedCourseId: string | null;
    jitterUntilMs: number | null;
    msUntilJitterRetry: number | null;
  };
  accountQuiet: {
    active: boolean;
    reason: AutomaticCycleReason | null;
    lastObservedCourseId: string | null;
    jitterUntilMs: number | null;
    msUntilJitterRetry: number | null;
  };
};

export function getSyncTimingStatus(): SyncTimingStatus {
  const state = getPollingState();
  const now = Date.now();

  // In fast mode we don't track a per-tick timestamp; the best estimate is
  // "within FAST_POLL_MS". In baseline we derive from lastBaselineTickAtMs.
  let msUntilNextXpCheck: number | null = null;
  if ((state.mode === "fast" || state.mode === "course_conflict") && state.fastTimer !== null) {
    msUntilNextXpCheck = FAST_POLL_MS;
  } else if (state.lastBaselineTickAtMs !== null) {
    msUntilNextXpCheck = Math.max(0, state.lastBaselineTickAtMs + BASELINE_POLL_MS - now);
  }

  const msUntilNextNightlySync =
    state.nightlyTimer !== null
      ? msUntilNextLocalTime(effectiveNightlyHour(), now)
      : null;

  return {
    msUntilNextXpCheck,
    msUntilNextNightlySync,
    syncMode: state.mode,
    fastIdleTicks: state.fastConsecutiveIdleTicks,
    fastIdleTicksRequired: FAST_IDLE_TRIGGER_TICKS,
    courseConflict: {
      active: state.mode === "course_conflict",
      lastObservedCourseId: state.accountQuietLastObservedCourseId,
      jitterUntilMs: state.accountQuietJitterUntilMs,
      msUntilJitterRetry: state.accountQuietJitterUntilMs === null
        ? null
        : Math.max(0, state.accountQuietJitterUntilMs - now),
    },
    accountQuiet: {
      active: state.mode === "fast" || state.mode === "course_conflict",
      reason: state.automaticCycleReason,
      lastObservedCourseId: state.accountQuietLastObservedCourseId,
      jitterUntilMs: state.accountQuietJitterUntilMs,
      msUntilJitterRetry: state.accountQuietJitterUntilMs === null
        ? null
        : Math.max(0, state.accountQuietJitterUntilMs - now),
    },
  };
}

/**
 * Re-arm the nightly setTimeout against the current `effectiveNightlyHour()`.
 * Called by `/api/settings` after a successful nightly_hour update so the
 * change takes effect on the next tick without a process restart. No-op if
 * polling isn't running (the writer is paused / unauthenticated). Caller
 * is responsible for passing the live client; we re-use the one already
 * stashed in polling state.
 */
export function rescheduleNightly(): void {
  const state = getPollingState();
  if (!state.client) return;
  scheduleNightly(state.client);
}

/**
 * Called by `/api/sync` after a manual full-sync completes. Resets the
 * quiet-detector so we don't immediately re-trigger after the manual cycle
 * landed fresh data.
 */
export function notifyAllCourseSyncComplete(): void {
  const state = getPollingState();
  state.lastNightlyAtMs = Date.now();
  if (state.mode === "fast" || state.mode === "course_conflict") {
    exitFastMode();
  }
}

/** @internal tests */
export function resetPollingStateForTests(): void {
  stopPolling();
  const state = getPollingState();
  state.isRunning = false;
  state.lastBaselineTickAtMs = null;
  state.lastNightlyAtMs = null;
  state.lastManualRefreshAtMs = 0;
  state.lastSyncResult = null;
  state.client = null;
  state.accountQuietLastObservedCourseId = null;
  state.accountQuietJitterUntilMs = null;
  state.automaticCycleReason = null;
}
