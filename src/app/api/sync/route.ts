import { NextResponse } from "next/server";
import { ensureClient } from "@/lib/server-state";
import { manualRefresh, notifyAllCourseSyncComplete } from "@/lib/polling";
import { fullSync } from "@/lib/sync";

export async function POST(request: Request) {
  try {
    const client = ensureClient();
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;
    const cycleAll = body.cycleAll === true;

    let result;
    if (force) {
      result = await fullSync(client, cycleAll);
      notifyAllCourseSyncComplete();
    } else {
      result = await manualRefresh(client);
      notifyAllCourseSyncComplete();
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
