import { getPollingState } from "./polling-state";
import { getCurrentSync } from "./sync-state";
import type { DuolingoClient } from "./duolingo";
import { SYNC_LOCK_UNAVAILABLE, tryAcquireExternalSyncLock } from "./external-sync-lock";

export const SYNC_ALREADY_RUNNING = "Sync already running";

export type SyncGateBusy = {
  acquired: false;
  reason: string;
};

export type SyncGateAcquired = {
  acquired: true;
  release: () => void | Promise<void>;
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
    await gate.release();
  }
}

/**
 * Full account-level gate for sync mutations. The process-local gate is first
 * so this server never starts overlapping DB writes; the optional Redis/Valkey
 * lock is second so separate writer processes do not race the Duolingo
 * account's active course.
 */
export async function tryAcquireAccountSyncGate(client: DuolingoClient): Promise<SyncGate> {
  const localGate = tryAcquireSyncGate();
  if (!localGate.acquired) return localGate;

  let externalGate: SyncGate;
  try {
    externalGate = await tryAcquireExternalSyncLock(client);
  } catch {
    localGate.release();
    return { acquired: false, reason: SYNC_LOCK_UNAVAILABLE };
  }
  if (!externalGate.acquired) {
    localGate.release();
    return externalGate;
  }

  return {
    acquired: true,
    release: async () => {
      try {
        await externalGate.release();
      } finally {
        localGate.release();
      }
    },
  };
}
