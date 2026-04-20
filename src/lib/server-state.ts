import { DuolingoClient, initClient } from "./duolingo";
import { startPolling, stopPolling, isPolling } from "./polling";

let client: DuolingoClient | null = null;
// In-memory only by design: resets on server restart so nightly polls resume.
let userPaused = false;

export function ensureClient(): DuolingoClient {
  if (client) return client;

  const jwt = process.env.DUOLINGO_JWT;
  if (!jwt) {
    throw new Error("DUOLINGO_JWT environment variable is not set");
  }

  client = initClient(jwt);

  if (!isPolling() && !userPaused) {
    startPolling(client);
  }

  return client;
}

export function getClientOrNull(): DuolingoClient | null {
  if (client) return client;
  try {
    return ensureClient();
  } catch {
    return null;
  }
}

export function resetClient(): void {
  stopPolling();
  client = null;
}

export function isUserPaused(): boolean {
  return userPaused;
}

export function pauseUserPolling(): void {
  userPaused = true;
  stopPolling();
}

export function resumeUserPolling(): void {
  userPaused = false;
  if (client && !isPolling()) {
    startPolling(client);
  }
}
