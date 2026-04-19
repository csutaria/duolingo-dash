import { NextResponse } from "next/server";
import { getClientOrNull } from "@/lib/server-state";
import { resolveLegacyLanguageEntry } from "@/lib/legacy-language-data";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const client = getClientOrNull();
  if (!client) {
    return NextResponse.json({ error: "Not authenticated. Set DUOLINGO_JWT." }, { status: 401 });
  }

  try {
    const [rawUser, legacyUser] = await Promise.all([
      client.getRawUserDebug(),
      client.getLegacyUser(),
    ]);

    const raw = rawUser as { courses?: Array<{ id?: string; learningLanguage?: string }> };
    const courses = raw.courses ?? [];
    const legacyLanguageResolution = courses.map((c) => {
      const lang = String(c.learningLanguage ?? "");
      const { key, data } = resolveLegacyLanguageEntry(legacyUser, lang);
      return {
        courseId: c.id ?? null,
        learningLanguage: lang,
        matchedLanguageDataKey: key,
        resolvedBlockLanguage: data?.language ?? null,
        skillCount: data?.skills?.length ?? 0,
      };
    });

    return NextResponse.json({
      rawUser,
      legacyUserLanguageKeys: Object.keys(legacyUser.language_data ?? {}),
      legacyUserTopLevelKeys: Object.keys(legacyUser as unknown as Record<string, unknown>),
      legacyLanguageResolution,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
