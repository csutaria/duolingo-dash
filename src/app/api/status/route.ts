import { NextResponse } from "next/server";
import { getClientOrNull } from "@/lib/server-state";
import {
  getLastSyncResult,
  isPolling,
  isCurrentlyRunning,
  getSyncTimingStatus,
} from "@/lib/polling";
import { getSyncStatus } from "@/lib/queries";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({ demoMode: true });
  }

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
