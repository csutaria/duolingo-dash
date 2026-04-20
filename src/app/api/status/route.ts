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

const DEMO_MODE = process.env.DEMO_MODE === "true";

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({ demoMode: true });
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
    polling: isPolling(),
    paused: isUserPaused(),
    currentlyRunning: isCurrentlyRunning(),
    currentSync,
    expectedDurationMs,
    lastSyncResult: syncResult,
    dbStatus,
    msUntilNextPoll: timing.msUntilNextPoll,
    msUntilNextAllCourseSync: timing.msUntilNextAllCourseSync,
  });
}
