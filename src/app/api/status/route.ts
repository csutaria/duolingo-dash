import { NextResponse } from "next/server";
import { getClientOrNull } from "@/lib/server-state";
import {
  getLastSyncResult,
  isPolling,
  isCurrentlyRunning,
  getSyncTimingStatus,
} from "@/lib/polling";
import { getSyncStatus } from "@/lib/queries";

export async function GET() {
  const client = getClientOrNull();
  const syncResult = getLastSyncResult();
  const dbStatus = client ? getSyncStatus() : null;
  const timing = getSyncTimingStatus();

  return NextResponse.json({
    authenticated: client !== null,
    polling: isPolling(),
    currentlyRunning: isCurrentlyRunning(),
    lastSyncResult: syncResult,
    dbStatus,
    msUntilNextPoll: timing.msUntilNextPoll,
    msUntilNextAllCourseSync: timing.msUntilNextAllCourseSync,
  });
}
