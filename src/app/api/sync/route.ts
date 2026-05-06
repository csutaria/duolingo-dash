import { NextResponse } from "next/server";
import { ensureClient } from "@/lib/server-state";
import { manualRefresh, notifyAllCourseSyncComplete } from "@/lib/polling";
import { fullSync } from "@/lib/sync";
import { isReadOnlyMode } from "@/lib/read-only";
import { SYNC_ALREADY_RUNNING, tryAcquireSyncGate } from "@/lib/sync-lock";

export async function POST(request: Request) {
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read-only" }, { status: 503 });
  }
  try {
    const client = ensureClient();
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;
    const cycleAll = body.cycleAll === true;

    let result;
    if (force) {
      const gate = tryAcquireSyncGate();
      if (!gate.acquired) {
        return NextResponse.json({
          type: "skipped",
          changed: false,
          totalXp: 0,
          error: SYNC_ALREADY_RUNNING,
          timestamp: new Date().toISOString(),
        });
      }
      try {
        result = await fullSync(client, cycleAll);
      } finally {
        gate.release();
      }
    } else {
      result = await manualRefresh(client);
    }
    if (result.type === "full") notifyAllCourseSyncComplete();

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
