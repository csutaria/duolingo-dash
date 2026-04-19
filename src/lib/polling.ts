import { DuolingoClient } from "./duolingo";
import { quickCheck, fullSync, SyncResult } from "./sync";

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const ALL_COURSE_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MIN_MANUAL_REFRESH_MS = 30 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let allCourseTimer: ReturnType<typeof setInterval> | null = null;
let lastManualRefresh = 0;
let lastSyncResult: SyncResult | null = null;
let isRunning = false;
let lastPollCompletedAtMs: number | null = null;
let lastAllCourseSyncAtMs: number | null = null;

async function pollOnce(client: DuolingoClient): Promise<SyncResult> {
  try {
    const { changed, currentXp } = await quickCheck(client);
    if (!changed) {
      return { type: "skipped", changed: false, totalXp: currentXp, timestamp: new Date().toISOString() };
    }
    const result = await fullSync(client, true);
    lastAllCourseSyncAtMs = Date.now();
    return result;
  } finally {
    lastPollCompletedAtMs = Date.now();
  }
}

async function allCourseSync(client: DuolingoClient): Promise<void> {
  const now = Date.now();
  if (isRunning) return;
  if (lastAllCourseSyncAtMs !== null && now - lastAllCourseSyncAtMs < ALL_COURSE_INTERVAL_MS) return;
  isRunning = true;
  try {
    lastSyncResult = await fullSync(client, true);
    lastAllCourseSyncAtMs = Date.now();
  } catch {
    // errors logged inside fullSync
  } finally {
    isRunning = false;
  }
}

export function startPolling(client: DuolingoClient): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      lastSyncResult = await pollOnce(client);
    } catch {
      // errors logged inside sync
    } finally {
      isRunning = false;
    }
  }, POLL_INTERVAL_MS);

  allCourseTimer = setInterval(() => allCourseSync(client), ALL_COURSE_INTERVAL_MS);

  pollOnce(client)
    .then((r) => {
      lastSyncResult = r;
    })
    .catch(() => {});
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (allCourseTimer) {
    clearInterval(allCourseTimer);
    allCourseTimer = null;
  }
}

export async function manualRefresh(client: DuolingoClient): Promise<SyncResult & { cooldownRemaining?: number }> {
  const now = Date.now();
  const elapsed = now - lastManualRefresh;
  if (elapsed < MIN_MANUAL_REFRESH_MS) {
    return {
      type: "skipped",
      changed: false,
      totalXp: lastSyncResult?.totalXp ?? 0,
      timestamp: new Date().toISOString(),
      cooldownRemaining: Math.ceil((MIN_MANUAL_REFRESH_MS - elapsed) / 1000),
    };
  }
  if (isRunning) {
    return {
      type: "skipped",
      changed: false,
      totalXp: lastSyncResult?.totalXp ?? 0,
      timestamp: new Date().toISOString(),
    };
  }
  isRunning = true;
  lastManualRefresh = now;
  try {
    lastSyncResult = await fullSync(client);
    return lastSyncResult;
  } finally {
    isRunning = false;
  }
}

export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

export function isPolling(): boolean {
  return pollTimer !== null;
}

export function isCurrentlyRunning(): boolean {
  return isRunning;
}

export type SyncTimingStatus = {
  msUntilNextPoll: number | null;
  msUntilNextAllCourseSync: number | null;
};

export function getSyncTimingStatus(): SyncTimingStatus {
  const now = Date.now();
  const msUntilNextPoll =
    lastPollCompletedAtMs !== null
      ? Math.max(0, lastPollCompletedAtMs + POLL_INTERVAL_MS - now)
      : null;
  const msUntilNextAllCourseSync =
    lastAllCourseSyncAtMs !== null
      ? Math.max(0, lastAllCourseSyncAtMs + ALL_COURSE_INTERVAL_MS - now)
      : null;
  return { msUntilNextPoll, msUntilNextAllCourseSync };
}

export function notifyAllCourseSyncComplete(): void {
  lastAllCourseSyncAtMs = Date.now();
}

/** @internal tests */
export function resetPollingStateForTests(): void {
  lastPollCompletedAtMs = null;
  lastAllCourseSyncAtMs = null;
}
