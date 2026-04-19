import { DuolingoClient, initClient } from "./duolingo";
import { startPolling, stopPolling, isPolling } from "./polling";

let client: DuolingoClient | null = null;

export function ensureClient(): DuolingoClient {
  if (client) return client;

  const jwt = process.env.DUOLINGO_JWT;
  if (!jwt) {
    throw new Error("DUOLINGO_JWT environment variable is not set");
  }

  client = initClient(jwt);

  if (!isPolling()) {
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
