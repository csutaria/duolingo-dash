import { NextResponse } from "next/server";
import { ensureClient } from "@/lib/server-state";
import { syncCourseDetails } from "@/lib/sync";
import { isReadOnlyMode } from "@/lib/read-only";
import { SYNC_ALREADY_RUNNING, tryAcquireSyncGate } from "@/lib/sync-lock";

export async function POST(request: Request) {
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read-only" }, { status: 503 });
  }
  try {
    const client = ensureClient();
    const body = await request.json();
    const { courseId, learningLanguage, fromLanguage } = body;

    if (!courseId || !learningLanguage || !fromLanguage) {
      return NextResponse.json(
        { error: "courseId, learningLanguage, and fromLanguage are required" },
        { status: 400 },
      );
    }

    const gate = tryAcquireSyncGate();
    if (!gate.acquired) {
      return NextResponse.json({
        success: false,
        switchedBack: true,
        error: SYNC_ALREADY_RUNNING,
        details: [SYNC_ALREADY_RUNNING],
      });
    }

    let result;
    try {
      result = await syncCourseDetails(client, courseId, learningLanguage, fromLanguage);
    } finally {
      gate.release();
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
