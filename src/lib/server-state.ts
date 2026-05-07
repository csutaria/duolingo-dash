import { DuolingoClient, initClient } from "./duolingo";
import { startPolling, stopPolling, isPolling } from "./polling";
import { getPollingState } from "./polling-state";
import { isBackgroundSyncEnabled } from "./instance-role";
import { isReadOnlyMode } from "./read-only";

// `client` and `userPaused` live on the shared globalThis bucket in
// polling-state.ts so Next.js HMR can't orphan timers or spawn a second
// singleton. See the comment in polling-state.ts.

export function ensureClient(): DuolingoClient {
  if (isReadOnlyMode()) {
    // Read-only instance never instantiates a Duolingo client: no JWT
    // requirement, no polling, no writes. Mutating routes guard on
    // `isReadOnlyMode()` and return 503 before reaching this path;
    // status / data routes use `getClientOrNull()` which returns null
    // here without throwing.
    throw new Error("read-only mode: Duolingo client is disabled");
  }

  const state = getPollingState();
  if (state.client) return state.client;

  const jwt = process.env.DUOLINGO_JWT;
  if (!jwt) {
    throw new Error("DUOLINGO_JWT environment variable is not set");
  }

  state.client = initClient(jwt);

  if (isBackgroundSyncEnabled() && !isPolling() && !state.userPaused) {
    startPolling(state.client);
  }

  return state.client;
}

export function getClientOrNull(): DuolingoClient | null {
  if (isReadOnlyMode()) return null;
  const state = getPollingState();
  if (state.client) return state.client;
  try {
    return ensureClient();
  } catch {
    return null;
  }
}

export function resetClient(): void {
  stopPolling();
  getPollingState().client = null;
}

export function isUserPaused(): boolean {
  return getPollingState().userPaused;
}

export function pauseUserPolling(): void {
  getPollingState().userPaused = true;
  stopPolling();
}

export function resumeUserPolling(): void {
  const state = getPollingState();
  state.userPaused = false;
  if (isBackgroundSyncEnabled() && state.client && !isPolling()) {
    startPolling(state.client);
  }
}
