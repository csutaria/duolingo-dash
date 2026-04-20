import { DuolingoClient } from "./duolingo";
import type { PathSection } from "./types";
import {
  getDb,
  getLastSyncXp,
  logSync,
  upsertProfile,
  insertCourseSnapshot,
  upsertXpDaily,
  snapshotVocab,
  snapshotSkills,
  upsertAchievements,
} from "./db";
import { resolveLegacyLanguageData } from "./legacy-language-data";
import { clearCurrentSync, setCurrentSync } from "./sync-state";
import { DuolingoUser, XpSummary } from "./types";

export interface SyncResult {
  type: "quick" | "full" | "skipped";
  changed: boolean;
  totalXp: number;
  error?: string;
  timestamp: string;
}

export async function quickCheck(
  client: DuolingoClient,
  currentXpHint?: number,
): Promise<{ changed: boolean; currentXp: number }> {
  const currentXp = currentXpHint ?? (await client.getTotalXp());
  const lastXp = getLastSyncXp();
  return { changed: lastXp === null || currentXp !== lastXp, currentXp };
}

export async function fullSync(client: DuolingoClient, cycleAllCourses = false): Promise<SyncResult> {
  const now = new Date().toISOString();
  const startedAtMs = Date.now();
  let totalXp = 0;

  setCurrentSync(cycleAllCourses ? "cycle" : "single");

  try {
    const user = await client.getUser();
    totalXp = user.totalXp;

    saveProfile(user);
    saveCourseSnapshots(user);
    await saveXpHistory(client);

    const achievements = user._achievements
      ?? (user as unknown as Record<string, unknown>).achievements as typeof user._achievements
      ?? [];
    if (achievements.length > 0) {
      saveAchievements(achievements);
    }

    if (cycleAllCourses) {
      await syncAllCourseDetails(client, user);
    } else {
      await saveLanguageDetails(client, user.currentCourseId, user.learningLanguage);
    }

    logSync({
      syncType: "full",
      totalXp,
      success: true,
      durationMs: Date.now() - startedAtMs,
      cycleAll: cycleAllCourses,
    });
    return { type: "full", changed: true, totalXp, timestamp: now };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSync({
      syncType: "full",
      totalXp,
      success: false,
      errorMessage: msg,
      durationMs: Date.now() - startedAtMs,
      cycleAll: cycleAllCourses,
    });
    return { type: "full", changed: false, totalXp, error: msg, timestamp: now };
  } finally {
    clearCurrentSync();
  }
}

export async function syncIfChanged(
  client: DuolingoClient,
  currentXpHint?: number,
): Promise<SyncResult> {
  const now = new Date().toISOString();
  try {
    const { changed, currentXp } = await quickCheck(client, currentXpHint);
    if (!changed) {
      logSync({ syncType: "quick", totalXp: currentXp, success: true });
      return { type: "skipped", changed: false, totalXp: currentXp, timestamp: now };
    }
    return fullSync(client);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSync({ syncType: "quick", totalXp: 0, success: false, errorMessage: msg });
    return { type: "quick", changed: false, totalXp: 0, error: msg, timestamp: now };
  }
}

function saveProfile(user: DuolingoUser): void {
  upsertProfile({
    user_id: user.id,
    username: user.username,
    name: user.name,
    picture: user.picture,
    bio: user.bio,
    streak: user.streak,
    current_streak_start: user.streakData?.currentStreak?.startDate ?? null,
    current_streak_length: user.streakData?.currentStreak?.length ?? null,
    previous_streak_length: user.streakData?.previousStreak?.length ?? null,
    total_xp: user.totalXp,
    xp_goal: user.xpGoal,
    gems: user.gems,
    lingots: user.lingots,
    has_plus: user.hasPlus ? 1 : 0,
    creation_date: user.creationDate,
    current_course_id: user.currentCourseId,
    learning_language: user.learningLanguage,
    from_language: user.fromLanguage,
    motivation: user.motivation,
  });
}

function saveCourseSnapshots(user: DuolingoUser): void {
  for (const course of user.courses) {
    insertCourseSnapshot(
      course.id,
      course.learningLanguage,
      course.fromLanguage,
      course.title,
      course.xp,
      course.crowns,
      user.streak,
      null,
      null,
    );
  }
}

async function saveXpHistory(client: DuolingoClient): Promise<void> {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setFullYear(startDate.getFullYear() - 1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const data = await client.getXpSummaries(fmt(startDate), fmt(now), tz);

  if (data.summaries) {
    const mapped = data.summaries
      .filter((s: XpSummary) => s.date != null)
      .map((s: XpSummary) => ({
        date: new Date((s.date ?? 0) * 1000).toISOString().split("T")[0],
        gainedXp: s.gainedXp ?? 0,
        frozen: s.frozen ?? false,
        streakExtended: s.streakExtended ?? false,
        dailyGoalXp: s.dailyGoalXp ?? 0,
        numSessions: s.numSessions ?? 0,
        totalSessionTime: s.totalSessionTime ?? 0,
      }));
    upsertXpDaily(mapped);
  }
}

function saveAchievements(achievements: Array<Record<string, unknown> | { name?: string; achievementId?: string; description?: string; tier?: number; isCompleted?: boolean }>): void {
  const mapped = achievements.map((a) => ({
    achievement_id: String(a.achievementId ?? a.name ?? "unknown"),
    name: String(a.name ?? "Unknown"),
    description: a.description ? String(a.description) : undefined,
    tier: typeof a.tier === "number" ? a.tier : undefined,
    is_completed: Boolean(a.isCompleted),
  }));
  upsertAchievements(mapped);
}

async function syncAllCourseDetails(client: DuolingoClient, user: DuolingoUser): Promise<void> {
  const originalCourseId = user.currentCourseId;
  const originalLearning = user.learningLanguage;
  const originalFrom = user.fromLanguage;

  // Sync the currently active course first (no switch needed)
  await saveLanguageDetails(client, user.currentCourseId, user.learningLanguage);

  // Cycle through remaining courses
  for (const course of user.courses) {
    if (course.id === originalCourseId) continue;
    try {
      await client.switchCourse(course.id, course.learningLanguage, course.fromLanguage);
      await new Promise((r) => setTimeout(r, 1000));
      await saveLanguageDetails(client, course.id, course.learningLanguage);
    } catch {
      // skip this course if switch or fetch fails
    }
  }

  // Restore original course
  if (user.courses.length > 1) {
    try {
      await client.switchCourse(originalCourseId, originalLearning, originalFrom);
    } catch {
      // best effort restore
    }
  }
}

/**
 * Maps skillId → levels_finished (0–5) from path section data.
 * 5 = all nodes done with at least one legendary
 * 4 = all nodes done, none legendary
 * 1–3 = partial (ceil of completion ratio × 3), min 1 if any active
 * 0 = not started
 */
function buildPathProgressMap(sections: PathSection[]): Map<string, number> {
  type SkillStats = { legendary: number; passed: number; active: number; total: number };
  const stats = new Map<string, SkillStats>();

  for (const section of sections) {
    for (const unit of section.units) {
      for (const level of unit.levels) {
        if (level.type === "unit_test") continue;
        const skillId = level.pathLevelClientData?.skillId;
        if (!skillId) continue;
        const s = stats.get(skillId) ?? { legendary: 0, passed: 0, active: 0, total: 0 };
        s.total++;
        if (level.state === "legendary") s.legendary++;
        else if (level.state === "passed") s.passed++;
        else if (level.state === "active") s.active++;
        stats.set(skillId, s);
      }
    }
  }

  const result = new Map<string, number>();
  for (const [skillId, s] of stats) {
    const complete = s.legendary + s.passed;
    let score: number;
    if (complete === s.total && s.legendary > 0) {
      score = 5;
    } else if (complete === s.total) {
      score = 4;
    } else if (complete > 0) {
      score = Math.max(1, Math.ceil((complete / s.total) * 3));
    } else if (s.active > 0) {
      score = 1;
    } else {
      score = 0;
    }
    result.set(skillId, score);
  }
  return result;
}

async function saveLanguageDetails(client: DuolingoClient, courseId: string, learningLanguage: string): Promise<void> {
  try {
    const vocab = await client.getVocabulary();
    if (vocab.vocab_overview) {
      snapshotVocab(
        courseId,
        vocab.vocab_overview.map((w) => ({
          word: w.word_string,
          lexeme_id: w.lexeme_id,
          strength_bars: w.strength_bars,
          skill: w.skill,
          pos: w.pos,
          gender: w.gender,
          last_practiced: w.last_practiced,
        })),
      );
    }
  } catch {
    // vocabulary endpoint may be unavailable
  }

  try {
    const [legacy, pathSections] = await Promise.all([
      client.getLegacyUser(),
      client.getPathSectioned().catch(() => []),
    ]);
    const pathProgress = buildPathProgressMap(pathSections);
    const langData = resolveLegacyLanguageData(legacy, learningLanguage);
    if (langData?.skills) {
      snapshotSkills(
        courseId,
        langData.skills.map((s) => ({
          skill_id: s.id,
          skill_name: s.name,
          learned: s.learned,
          strength: s.strength ?? 0,
          words: s.words ?? [],
          levels_finished: pathProgress.get(s.id) ?? s.levels_finished ?? s.finishedLevels ?? 0,
          coords_x: s.coords_x ?? 0,
          coords_y: s.coords_y ?? 0,
          dependencies: s.dependencies ?? [],
        })),
      );
    }
  } catch {
    // legacy endpoint may be unavailable
  }

  try {
    const mistakeCount = await client.getMistakeCount(courseId);
    if (mistakeCount > 0) {
      const db = getDb();
      db.prepare(`
        UPDATE course_snapshots SET mistake_count = ?
        WHERE course_id = ? AND snapshot_time = (
          SELECT MAX(snapshot_time) FROM course_snapshots WHERE course_id = ?
        )
      `).run(mistakeCount, courseId, courseId);
    }
  } catch {
    // mistakes endpoint may be unavailable
  }
}

export async function syncCourseDetails(
  client: DuolingoClient,
  courseId: string,
  learningLanguage: string,
  fromLanguage: string,
): Promise<{ success: boolean; switchedBack: boolean; error?: string; details: string[] }> {
  const details: string[] = [];
  const user = await client.getUser();
  const originalCourseId = user.currentCourseId;
  const originalLearning = user.learningLanguage;
  const originalFrom = user.fromLanguage;
  const needsSwitch = originalCourseId !== courseId;

  try {
    if (needsSwitch) {
      await client.switchCourse(courseId, learningLanguage, fromLanguage);
      details.push(`Switched from ${originalCourseId} to ${courseId}`);
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      details.push(`Already on ${courseId}, no switch needed`);
    }

    try {
      const vocab = await client.getVocabulary();
      if (vocab.vocab_overview && vocab.vocab_overview.length > 0) {
        snapshotVocab(
          courseId,
          vocab.vocab_overview.map((w) => ({
            word: w.word_string,
            lexeme_id: w.lexeme_id,
            strength_bars: w.strength_bars,
            skill: w.skill,
            pos: w.pos,
            gender: w.gender,
            last_practiced: w.last_practiced,
          })),
        );
        details.push(`Saved ${vocab.vocab_overview.length} vocab words`);
      } else {
        details.push(`Vocab endpoint returned empty (language: ${vocab.learning_language}, from: ${vocab.from_language})`);
      }
    } catch (err) {
      details.push(`Vocab failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const legacy = await client.getLegacyUser();
      if (legacy.language_data) {
        const availableLanguages = Object.keys(legacy.language_data);
        details.push(`Legacy API returned language_data keys: ${availableLanguages.join(", ")}`);
        const langData = resolveLegacyLanguageData(legacy, learningLanguage);
        if (langData?.skills && langData.skills.length > 0) {
          snapshotSkills(
            courseId,
            langData.skills.map((s) => ({
              skill_id: s.id,
              skill_name: s.name,
              learned: s.learned,
              strength: s.strength ?? 0,
              words: s.words ?? [],
              levels_finished: s.levels_finished ?? s.finishedLevels ?? 0,
              coords_x: s.coords_x ?? 0,
              coords_y: s.coords_y ?? 0,
              dependencies: s.dependencies ?? [],
            })),
          );
          details.push(`Saved ${langData.skills.length} skills for ${learningLanguage}`);
        } else {
          details.push(
            `No skills found for language "${learningLanguage}" (try keys: ${availableLanguages.join(", ")})`,
          );
        }
      } else {
        details.push("Legacy API returned no language_data");
      }
    } catch (err) {
      details.push(`Legacy failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let switchedBack = false;
    if (needsSwitch) {
      try {
        await client.switchCourse(originalCourseId, originalLearning, originalFrom);
        switchedBack = true;
        details.push(`Switched back to ${originalCourseId}`);
      } catch (err) {
        details.push(`Failed to switch back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, switchedBack: !needsSwitch || switchedBack, details };
  } catch (err) {
    if (needsSwitch) {
      try {
        await client.switchCourse(originalCourseId, originalLearning, originalFrom);
      } catch {
        // best effort
      }
    }
    return {
      success: false,
      switchedBack: true,
      error: err instanceof Error ? err.message : String(err),
      details,
    };
  }
}
