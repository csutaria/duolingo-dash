import { NextResponse } from "next/server";
import { getClientOrNull, isUserPaused } from "@/lib/server-state";
import {
  getLastSyncResult,
  isPolling,
  isCurrentlyRunning,
  getSyncTimingStatus,
} from "@/lib/polling";
import { getSyncStatus } from "@/lib/queries";
import { getCurrentSync } from "@/lib/sync-state";
import { getMedianDurationMs } from "@/lib/db";
import { getResolvedTimezone, getResolvedTimezoneSource } from "@/lib/tz";
import { isReadOnlyMode } from "@/lib/read-only";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({
      demoMode: true,
      readOnly: isReadOnlyMode(),
      resolvedTimezone: getResolvedTimezone(),
      resolvedTimezoneSource: getResolvedTimezoneSource(),
    });
  }

  const readOnly = isReadOnlyMode();
  if (readOnly) {
    // Read-only instance: no client, no polling, no sync timers. Most
    // status fields are meaningless; return only what the UI needs to
    // render the "Read-only" banner and the timezone row. `dbStatus`
    // is still safe to read (read-only SELECTs).
    return NextResponse.json({
      authenticated: false,
      readOnly: true,
      resolvedTimezone: getResolvedTimezone(),
      resolvedTimezoneSource: getResolvedTimezoneSource(),
      polling: false,
      paused: false,
      currentlyRunning: false,
      currentSync: null,
      expectedDurationMs: { single: null, cycle: null },
      lastSyncResult: null,
      dbStatus: getSyncStatus(),
      msUntilNextXpCheck: null,
      msUntilNextNightlySync: null,
      syncMode: "baseline" as const,
      fastIdleTicks: 0,
      fastIdleTicksRequired: 5,
    });
  }

  const client = getClientOrNull();
  const syncResult = getLastSyncResult();
  const dbStatus = client ? getSyncStatus() : null;
  const timing = getSyncTimingStatus();
  const currentSync = getCurrentSync();
  const expectedDurationMs = client
    ? {
        single: getMedianDurationMs(false, 3),
        cycle: getMedianDurationMs(true, 3),
      }
    : { single: null, cycle: null };

  return NextResponse.json({
    authenticated: client !== null,
    readOnly: false,
    resolvedTimezone: getResolvedTimezone(),
    resolvedTimezoneSource: getResolvedTimezoneSource(),
    polling: isPolling(),
    paused: isUserPaused(),
    currentlyRunning: isCurrentlyRunning(),
    currentSync,
    expectedDurationMs,
    lastSyncResult: syncResult,
    dbStatus,
    msUntilNextXpCheck: timing.msUntilNextXpCheck,
    msUntilNextNightlySync: timing.msUntilNextNightlySync,
    syncMode: timing.syncMode,
    fastIdleTicks: timing.fastIdleTicks,
    fastIdleTicksRequired: timing.fastIdleTicksRequired,
  });
}
