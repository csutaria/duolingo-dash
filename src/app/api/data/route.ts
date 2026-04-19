import { NextRequest, NextResponse } from "next/server";
import { getClientOrNull } from "@/lib/server-state";
import {
  getProfile,
  getCourseLatest,
  getCourseHistory,
  getCourseComparison,
  getXpDaily,
  getXpStats,
  getVocabLatest,
  getVocabDecay,
  getVocabHistory,
  getSkillsLatest,
  getSkillDecay,
  getSkillHistory,
  getAchievements,
} from "@/lib/queries";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export async function GET(request: NextRequest) {
  if (!DEMO_MODE) {
    const client = getClientOrNull();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated. Set DUOLINGO_JWT environment variable." },
        { status: 401 },
      );
    }
  }

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q");

  try {
    switch (query) {
      case "profile":
        return NextResponse.json(getProfile() ?? null);

      case "courses":
        return NextResponse.json(getCourseLatest());

      case "course-comparison":
        return NextResponse.json(getCourseComparison());

      case "course-history": {
        const courseId = searchParams.get("courseId");
        if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });
        return NextResponse.json(getCourseHistory(courseId));
      }

      case "xp-daily": {
        const days = searchParams.get("days");
        return NextResponse.json(getXpDaily(days ? parseInt(days) : undefined));
      }

      case "xp-stats":
        return NextResponse.json(getXpStats());

      case "vocab": {
        const courseId = searchParams.get("courseId");
        if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });
        return NextResponse.json(getVocabLatest(courseId));
      }

      case "vocab-decay": {
        const courseId = searchParams.get("courseId");
        if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });
        return NextResponse.json(getVocabDecay(courseId));
      }

      case "vocab-history": {
        const courseId = searchParams.get("courseId");
        const lexemeId = searchParams.get("lexemeId");
        if (!courseId || !lexemeId) return NextResponse.json({ error: "courseId and lexemeId required" }, { status: 400 });
        return NextResponse.json(getVocabHistory(courseId, lexemeId));
      }

      case "skills": {
        const courseId = searchParams.get("courseId");
        if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });
        return NextResponse.json(getSkillsLatest(courseId));
      }

      case "skill-decay": {
        const courseId = searchParams.get("courseId");
        if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });
        return NextResponse.json(getSkillDecay(courseId));
      }

      case "skill-history": {
        const courseId = searchParams.get("courseId");
        const skillId = searchParams.get("skillId");
        if (!courseId || !skillId) return NextResponse.json({ error: "courseId and skillId required" }, { status: 400 });
        return NextResponse.json(getSkillHistory(courseId, skillId));
      }

      case "achievements":
        return NextResponse.json(getAchievements());

      default:
        return NextResponse.json({ error: `Unknown query: ${query}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
