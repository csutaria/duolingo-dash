import { DuolingoClient, initClient } from "./duolingo";
import { startPolling, stopPolling, isPolling } from "./polling";
import { getPollingState } from "./polling-state";

// `client` and `userPaused` live on the shared globalThis bucket in
// polling-state.ts so Next.js HMR can't orphan timers or spawn a second
// singleton. See the comment in polling-state.ts.

export function ensureClient(): DuolingoClient {
  const state = getPollingState();
  if (state.client) return state.client;

  const jwt = process.env.DUOLINGO_JWT;
  if (!jwt) {
    throw new Error("DUOLINGO_JWT environment variable is not set");
  }

  state.client = initClient(jwt);

  if (!isPolling() && !state.userPaused) {
    startPolling(state.client);
  }

  return state.client;
}

export function getClientOrNull(): DuolingoClient | null {
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
  if (state.client && !isPolling()) {
    startPolling(state.client);
  }
}
