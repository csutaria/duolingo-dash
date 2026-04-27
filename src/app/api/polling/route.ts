import { NextResponse } from "next/server";
import {
  ensureClient,
  isUserPaused,
  pauseUserPolling,
  resumeUserPolling,
} from "@/lib/server-state";
import { isPolling } from "@/lib/polling";
import { isReadOnlyMode } from "@/lib/read-only";

export async function POST(request: Request) {
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read-only" }, { status: 503 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (action !== "pause" && action !== "resume") {
      return NextResponse.json(
        { error: "action must be 'pause' or 'resume'" },
        { status: 400 },
      );
    }

    if (action === "pause") {
      pauseUserPolling();
    } else {
      ensureClient();
      resumeUserPolling();
    }

    return NextResponse.json({
      paused: isUserPaused(),
      polling: isPolling(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Polling control failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
