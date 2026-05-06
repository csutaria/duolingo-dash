import { getPollingState } from "./polling-state";
import { getCurrentSync } from "./sync-state";

export const SYNC_ALREADY_RUNNING = "Sync already running";

export type SyncGateBusy = {
  acquired: false;
  reason: typeof SYNC_ALREADY_RUNNING;
};

export type SyncGateAcquired = {
  acquired: true;
  release: () => void;
};

export type SyncGate = SyncGateBusy | SyncGateAcquired;

/**
 * Process-local single-flight gate for every operation that can write local
 * sync state or switch the real Duolingo account's active course.
 *
 * `state.isRunning` is the authoritative mutex. `currentSync` is also treated
 * as busy so older code paths or in-flight `fullSync` calls that have already
 * published progress metadata cannot be overlapped by a new mutation.
 */
export function tryAcquireSyncGate(): SyncGate {
  const state = getPollingState();
  if (state.isRunning || getCurrentSync() != null) {
    return { acquired: false, reason: SYNC_ALREADY_RUNNING };
  }

  state.isRunning = true;
  return {
    acquired: true,
    release: () => {
      state.isRunning = false;
    },
  };
}

export async function withSyncGate<T>(
  fn: () => Promise<T>,
): Promise<T | SyncGateBusy> {
  const gate = tryAcquireSyncGate();
  if (!gate.acquired) return gate;
  try {
    return await fn();
  } finally {
    gate.release();
  }
}
