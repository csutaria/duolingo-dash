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
      const rawLang = c.learningLanguage ?? "";
      // Mirror the getUser() fallback: parse from course ID if API omits learningLanguage
      let effectiveLang = rawLang;
      if (!effectiveLang && c.id) {
        const withoutPrefix = c.id.replace(/^DUOLINGO_/, "");
        const lastUnderscore = withoutPrefix.lastIndexOf("_");
        if (lastUnderscore !== -1) effectiveLang = withoutPrefix.slice(0, lastUnderscore).toLowerCase();
      }
      const { key, data } = resolveLegacyLanguageEntry(legacyUser, effectiveLang);
      return {
        courseId: c.id ?? null,
        rawLearningLanguage: rawLang,
        effectiveLearningLanguage: effectiveLang,
        matchedLanguageDataKey: key,
        resolvedBlockLanguage: data?.language ?? null,
        skillCount: data?.skills?.length ?? 0,
      };
    });

    // Sample raw skill objects from each resolved language (first 2 skills each)
    const skillSamples = courses.reduce<Record<string, unknown[]>>((acc, c) => {
      const lang = String(c.learningLanguage ?? "");
      const { key, data } = resolveLegacyLanguageEntry(legacyUser, lang);
      if (key && data?.skills?.length) {
        acc[lang] = data.skills.slice(0, 2).map((s) => ({ ...s }));
      }
      return acc;
    }, {});

    return NextResponse.json({
      rawUser,
      legacyUserLanguageKeys: Object.keys(legacyUser.language_data ?? {}),
      legacyUserTopLevelKeys: Object.keys(legacyUser as unknown as Record<string, unknown>),
      legacyLanguageResolution,
      skillSamples,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
