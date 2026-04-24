import { DuolingoClient } from "./duolingo";
import { quickCheck, fullSync, SyncResult } from "./sync";
import { getCurrentSync, CurrentSync } from "./sync-state";
import { getPollingState } from "./polling-state";

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

// ─── Cadence ──────────────────────────────────────────────────────────────
// Baseline: poll totalXp every 30 minutes. If it has changed since the last
// successful full sync, enter fast mode.
export const BASELINE_POLL_MS = 30 * 60 * 1000;
// Fast mode: poll totalXp every 2 minutes. Any observed change boots back to
// baseline; 5 consecutive unchanged ticks (10 minutes of quiet) fire a full
// cycle sync.
export const FAST_POLL_MS = 2 * 60 * 1000;
export const FAST_IDLE_TRIGGER_TICKS = 5;
// Nightly: single sync at 02:00 server local time (quickCheck-first).
export const NIGHTLY_HOUR_LOCAL = 2;
// Manual /api/sync cooldown — unchanged from prior design.
const MIN_MANUAL_REFRESH_MS = 30 * 1000;

// ─── Pure helpers (unit-testable without fake timers) ─────────────────────

/**
 * Pure state-machine reducer for the XP quiet-detector.
 *
 * Events:
 *  - `baseline_tick { changed }`: a 30-min baseline poll finished.
 *    `changed` = (currentXp !== lastSyncedXp).
 *  - `fast_tick { changed }`: a 2-min fast poll finished.
 *    `changed` = (currentXp !== lastObservedXp from previous fast tick).
 *  - `external_fullsync_done`: any `fullSync` triggered by a path other than
 *    the fast-poll idle trigger (nightly, manual, etc.) completed.
 *
 * Rules:
 *  - baseline + change → fast (idle counter = 0).
 *  - baseline + no-change → baseline (no-op).
 *  - fast + change → baseline (no extension; next baseline tick re-detects).
 *  - fast + no-change → fast (idle counter += 1); at 5, signal fullSync and
 *    return to baseline.
 *  - external full-sync completed at any time → baseline.
 */
export type SyncMode = "baseline" | "fast";
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
    return { state: { mode: "baseline", fastConsecutiveIdleTicks: 0 }, fireFullSync: false };
  }
  const nextTicks = state.fastConsecutiveIdleTicks + 1;
  if (nextTicks >= FAST_IDLE_TRIGGER_TICKS) {
    return { state: { mode: "baseline", fastConsecutiveIdleTicks: 0 }, fireFullSync: true };
  }
  return {
    state: { mode: "fast", fastConsecutiveIdleTicks: nextTicks },
    fireFullSync: false,
  };
}

/**
 * Compute ms until the next occurrence of `hour:00:00.000` in server local
 * time. Recomputed fresh each nightly cycle so DST transitions, clock skew,
 * and process sleep/wake are all handled naturally.
 */
export function msUntilNextLocalTime(hour: number, now: number = Date.now()): number {
  const d = new Date(now);
  const target = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    hour,
    0,
    0,
    0,
  );
  if (target.getTime() <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now;
}

// ─── Timer mechanics ──────────────────────────────────────────────────────

function enterFastMode(seedXp: number): void {
  const state = getPollingState();
  state.mode = "fast";
  state.fastLastObservedXp = seedXp;
  state.fastConsecutiveIdleTicks = 0;
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
  if (state.fastTimer) {
    clearInterval(state.fastTimer);
    state.fastTimer = null;
  }
}

async function baselineTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (state.isRunning) return;
  state.lastBaselineTickAtMs = Date.now();
  try {
    const { changed, currentXp } = await quickCheck(client);
    const transition = advanceSyncState(
      { mode: state.mode, fastConsecutiveIdleTicks: state.fastConsecutiveIdleTicks },
      { type: "baseline_tick", changed },
    );
    if (transition.state.mode === "fast" && state.mode !== "fast") {
      enterFastMode(currentXp);
    }
  } catch {
    // quickCheck failures are intentionally swallowed — they're cheap and
    // the next tick will retry.
  }
}

async function fastTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  if (state.mode !== "fast") {
    // Defensive: timer should have been cleared. Clear it now and bail.
    if (state.fastTimer) {
      clearInterval(state.fastTimer);
      state.fastTimer = null;
    }
    return;
  }
  if (state.isRunning) return;

  let currentXp: number;
  try {
    currentXp = await client.getTotalXp();
  } catch {
    return;
  }

  const changed = state.fastLastObservedXp !== null && currentXp !== state.fastLastObservedXp;
  state.fastLastObservedXp = currentXp;

  const transition = advanceSyncState(
    { mode: "fast", fastConsecutiveIdleTicks: state.fastConsecutiveIdleTicks },
    { type: "fast_tick", changed },
  );

  if (transition.fireFullSync) {
    exitFastMode();
    state.isRunning = true;
    try {
      state.lastSyncResult = await fullSync(client, true);
    } catch {
      // logged inside fullSync
    } finally {
      state.isRunning = false;
    }
    return;
  }

  if (transition.state.mode === "baseline") {
    exitFastMode();
    return;
  }

  state.fastConsecutiveIdleTicks = transition.state.fastConsecutiveIdleTicks;
}

/**
 * Runs at 02:00 local time. Decision logic:
 *  - If isRunning → skip and re-arm. (Quiet-detector / manual is already
 *    taking care of things.)
 *  - Else quickCheck. If XP changed vs last successful full sync, user was
 *    active around 2 a.m.; enter fast mode (if not already) and let the
 *    quiet-detector run the sync once XP stops. Do not force a fullSync.
 *  - If XP unchanged → run fullSync(client, cycleAll=true). This covers
 *    truly idle days and days where the last active-sync landed hours ago.
 */
async function nightlyTick(client: DuolingoClient): Promise<void> {
  const state = getPollingState();
  try {
    if (state.isRunning) return;

    let changed: boolean;
    let currentXp: number;
    try {
      const res = await quickCheck(client);
      changed = res.changed;
      currentXp = res.currentXp;
    } catch {
      return;
    }

    if (changed) {
      if (state.mode === "baseline") enterFastMode(currentXp);
      return;
    }

    state.isRunning = true;
    try {
      state.lastSyncResult = await fullSync(client, true);
      state.lastNightlyAtMs = Date.now();
    } catch {
      // logged inside fullSync
    } finally {
      state.isRunning = false;
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
  const delay = msUntilNextLocalTime(NIGHTLY_HOUR_LOCAL);
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
  if (state.nightlyTimer) {
    clearTimeout(state.nightlyTimer);
    state.nightlyTimer = null;
  }
  state.mode = "baseline";
  state.fastLastObservedXp = null;
  state.fastConsecutiveIdleTicks = 0;
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
    return {
      type: "skipped",
      changed: false,
      totalXp: state.lastSyncResult?.totalXp ?? 0,
      timestamp: new Date().toISOString(),
    };
  }
  state.isRunning = true;
  state.lastManualRefreshAtMs = now;
  try {
    state.lastSyncResult = await fullSync(client);
    return state.lastSyncResult;
  } finally {
    state.isRunning = false;
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
  syncMode: SyncMode;
  fastIdleTicks: number;
  fastIdleTicksRequired: number;
};

export function getSyncTimingStatus(): SyncTimingStatus {
  const state = getPollingState();
  const now = Date.now();

  // In fast mode we don't track a per-tick timestamp; the best estimate is
  // "within FAST_POLL_MS". In baseline we derive from lastBaselineTickAtMs.
  let msUntilNextXpCheck: number | null = null;
  if (state.mode === "fast") {
    msUntilNextXpCheck = FAST_POLL_MS;
  } else if (state.lastBaselineTickAtMs !== null) {
    msUntilNextXpCheck = Math.max(0, state.lastBaselineTickAtMs + BASELINE_POLL_MS - now);
  }

  const msUntilNextNightlySync =
    state.nightlyTimer !== null
      ? msUntilNextLocalTime(NIGHTLY_HOUR_LOCAL, now)
      : null;

  return {
    msUntilNextXpCheck,
    msUntilNextNightlySync,
    syncMode: state.mode,
    fastIdleTicks: state.fastConsecutiveIdleTicks,
    fastIdleTicksRequired: FAST_IDLE_TRIGGER_TICKS,
  };
}

/**
 * Called by `/api/sync` after a manual full-sync completes. Resets the
 * quiet-detector so we don't immediately re-trigger after the manual cycle
 * landed fresh data.
 */
export function notifyAllCourseSyncComplete(): void {
  const state = getPollingState();
  state.lastNightlyAtMs = Date.now();
  if (state.mode === "fast") {
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
}
