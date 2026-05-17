import type { DuolingoClient } from "./duolingo";
import type { CourseOrderRecoveryTarget, SyncResult } from "./sync";

export type AutomaticCycleReason =
  | "xp_changed"
  | "nightly"
  | "active_course_conflict"
  | "account_conflict"
  | "gate_busy"
  | "retry_error";

/**
 * All mutable polling/server-state lives here, behind a single `globalThis`
 * bucket. In Next.js dev, HMR re-executes modules — without this bucket,
 * each reload would leave the previous module's `setInterval` handles live in
 * the Node event loop (orphaned timers). By reading/writing through
 * `globalThis.__duolingoPollingState`, a reloaded module's `startPolling()`
 * sees existing timer handles and early-returns, and `stopPolling()` clears
 * the same handles every previous module registered. `isRunning` is also a
 * real global mutex across any concurrent callers spanning module instances.
 */
export type PollingState = {
  client: DuolingoClient | null;
  userPaused: boolean;

  baselineTimer: ReturnType<typeof setInterval> | null;
  fastTimer: ReturnType<typeof setInterval> | null;
  accountQuietJitterTimer: ReturnType<typeof setTimeout> | null;
  nightlyTimer: ReturnType<typeof setTimeout> | null;

  isRunning: boolean;

  mode: "baseline" | "fast" | "course_conflict";
  fastLastObservedXp: number | null;
  fastConsecutiveIdleTicks: number;
  accountQuietLastObservedCourseId: string | null;
  accountQuietJitterUntilMs: number | null;
  automaticCycleReason: AutomaticCycleReason | null;
  courseOrderRecoveryTarget: CourseOrderRecoveryTarget | null;

  lastBaselineTickAtMs: number | null;
  lastNightlyAtMs: number | null;
  lastManualRefreshAtMs: number;
  lastSyncResult: SyncResult | null;
};

function initialState(): PollingState {
  return {
    client: null,
    userPaused: false,
    baselineTimer: null,
    fastTimer: null,
    accountQuietJitterTimer: null,
    nightlyTimer: null,
    isRunning: false,
    mode: "baseline",
    fastLastObservedXp: null,
    fastConsecutiveIdleTicks: 0,
    accountQuietLastObservedCourseId: null,
    accountQuietJitterUntilMs: null,
    automaticCycleReason: null,
    courseOrderRecoveryTarget: null,
    lastBaselineTickAtMs: null,
    lastNightlyAtMs: null,
    lastManualRefreshAtMs: 0,
    lastSyncResult: null,
  };
}

type GlobalWithPollingState = typeof globalThis & {
  __duolingoPollingState?: PollingState;
};

export function getPollingState(): PollingState {
  const g = globalThis as GlobalWithPollingState;
  if (!g.__duolingoPollingState) {
    g.__duolingoPollingState = initialState();
  }
  return g.__duolingoPollingState;
}

/** @internal tests only — resets the shared bucket to a fresh `initialState()`. */
export function __resetPollingStateForTests(): void {
  const g = globalThis as GlobalWithPollingState;
  g.__duolingoPollingState = initialState();
}
