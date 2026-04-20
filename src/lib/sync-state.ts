export type CurrentSyncType = "single" | "cycle";

export interface CurrentSync {
  type: CurrentSyncType;
  startedAtMs: number;
}

let currentSync: CurrentSync | null = null;

export function setCurrentSync(type: CurrentSyncType): void {
  currentSync = { type, startedAtMs: Date.now() };
}

export function clearCurrentSync(): void {
  currentSync = null;
}

export function getCurrentSync(): CurrentSync | null {
  return currentSync;
}
