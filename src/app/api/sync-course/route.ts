import { NextResponse } from "next/server";
import { ensureClient } from "@/lib/server-state";
import { syncCourseDetails } from "@/lib/sync";

export async function POST(request: Request) {
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

    const result = await syncCourseDetails(client, courseId, learningLanguage, fromLanguage);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
