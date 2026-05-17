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
  getLatestStoredSkillSnapshots,
  upsertAchievements,
  updateStreakEpochs,
  backfillImpliedFreeze,
  type StoredSkillSnapshot,
} from "./db";
import { resolveLegacyLanguageData } from "./legacy-language-data";
import { clearCurrentSync, setCurrentSync } from "./sync-state";
import { DuolingoUser, LegacySkill, XpSummary } from "./types";
import { formatLocalDate, getResolvedTimezone } from "./tz";
import { tryAcquireAccountSyncGate } from "./sync-lock";
import {
  ActiveCourseConflictError,
  XpConflictError,
  isAccountConflictError,
  type AccountConflictKind,
} from "./sync-conflict";
import { logger } from "./logger";

type SkillSnapshotInput = Parameters<typeof snapshotSkills>[1][number];

export type CourseOrderRecoveryCourse = {
  id: string;
  learningLanguage: string;
  fromLanguage: string;
};

export type CourseOrderRecoveryTarget = {
  capturedAtMs: number;
  originalCourseId: string;
  originalLearningLanguage: string;
  originalFromLanguage: string;
  courses: CourseOrderRecoveryCourse[];
  conflictReason?: AccountConflictKind;
};

export type FullSyncOptions = {
  courseOrderRecoveryTarget?: CourseOrderRecoveryTarget | null;
};

export interface SyncResult {
  type: "quick" | "full" | "skipped";
  changed: boolean;
  totalXp: number;
  error?: string;
  warnings?: string[];
  courseOrderRecoveryTarget?: CourseOrderRecoveryTarget | null;
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

export async function fullSync(
  client: DuolingoClient,
  cycleAllCourses = false,
  options: FullSyncOptions = {},
): Promise<SyncResult> {
  const now = new Date().toISOString();
  const startedAtMs = Date.now();
  let totalXp = 0;
  let courseOrderRecoveryTarget: CourseOrderRecoveryTarget | undefined;
  let courseOrderMayHaveMutated = false;
  let clearCourseOrderRecoveryTarget = false;

  setCurrentSync(cycleAllCourses ? "cycle" : "single");
  logger.info("sync start", { cycleAll: cycleAllCourses });

  try {
    const user = await client.getUser();
    totalXp = user.totalXp;

    saveProfile(user);
    saveCourseSnapshots(user);
    await saveXpHistory(client);

    const streakStart = user.streakData?.currentStreak?.startDate ?? null;
    if (streakStart) {
      updateStreakEpochs(streakStart, user.streakData?.previousStreak?.length ?? null);
      backfillImpliedFreeze(streakStart);
    }

    const achievements = user._achievements
      ?? (user as unknown as Record<string, unknown>).achievements as typeof user._achievements
      ?? [];
    if (achievements.length > 0) {
      saveAchievements(achievements);
    }

    let warnings: string[] = [];
    if (cycleAllCourses) {
      const targetResolution = resolveCourseOrderRecoveryTarget(
        user,
        options.courseOrderRecoveryTarget,
      );
      courseOrderRecoveryTarget = targetResolution.target;
      clearCourseOrderRecoveryTarget = targetResolution.clearRequestedTarget;
      if (targetResolution.warning) {
        warnings.push(targetResolution.warning);
      }
      warnings.push(
        ...(await syncAllCourseDetails(
          client,
          user,
          targetResolution.useRecoveryTarget ? targetResolution.target : null,
          () => {
            courseOrderMayHaveMutated = true;
          },
        )),
      );
    } else {
      const guard = createActiveCourseGuard(client, user.currentCourseId, user.totalXp);
      await saveLanguageDetails(client, user.currentCourseId, user.learningLanguage, guard);
    }

    logSync({
      syncType: "full",
      totalXp,
      success: true,
      durationMs: Date.now() - startedAtMs,
      cycleAll: cycleAllCourses,
    });
    logger.info("sync complete", { cycleAll: cycleAllCourses, totalXp });
    return { type: "full", changed: true, totalXp, warnings: warnings.length ? warnings : undefined, timestamp: now };
  } catch (err) {
    if (isAccountConflictError(err)) {
      logSync({
        syncType: "full",
        totalXp,
        success: false,
        errorMessage: err.message,
        durationMs: Date.now() - startedAtMs,
        cycleAll: cycleAllCourses,
      });
      logger.warn("sync aborted: account conflict", {
        cycleAll: cycleAllCourses,
        kind: err.kind,
        details: err.details,
      });
      return {
        type: "skipped",
        changed: false,
        totalXp,
        error: err.message,
        warnings: err.details,
        courseOrderRecoveryTarget: courseOrderMayHaveMutated && courseOrderRecoveryTarget
          ? withConflictReason(courseOrderRecoveryTarget, err.kind)
          : clearCourseOrderRecoveryTarget
            ? null
            : undefined,
        timestamp: now,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logSync({
      syncType: "full",
      totalXp,
      success: false,
      errorMessage: msg,
      durationMs: Date.now() - startedAtMs,
      cycleAll: cycleAllCourses,
    });
    logger.warn("sync failed", { cycleAll: cycleAllCourses, error: msg });
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
    const gate = await tryAcquireAccountSyncGate(client);
    if (!gate.acquired) {
      return {
        type: "skipped",
        changed: false,
        totalXp: currentXp,
        error: gate.reason,
        timestamp: now,
      };
    }
    try {
      return await fullSync(client);
    } finally {
      await gate.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSync({ syncType: "quick", totalXp: 0, success: false, errorMessage: msg });
    return { type: "quick", changed: false, totalXp: 0, error: msg, timestamp: now };
  }
}

function saveProfile(user: DuolingoUser): void {
  const tz =
    typeof user.timezone === "string" && user.timezone.trim().length > 0
      ? user.timezone.trim()
      : null;
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
    timezone: tz,
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
  // We pass R as the `timezone` query param so the request window
  // bounds are interpreted in the same calendar Duolingo uses to
  // decide which days to include. The wire encoding of each
  // `summaries[].date` is independent of this param (see the comment
  // on the `formatLocalDate(_, "UTC")` call below).
  const tz = getResolvedTimezone();

  // Range bounds in R-calendar dates. `toISOString().split('T')[0]`
  // is UTC and would skew by up to ±1 day for hosts where R != UTC.
  const data = await client.getXpSummaries(
    formatLocalDate(startDate, tz),
    formatLocalDate(now, tz),
    tz,
  );

  if (data.summaries) {
    const mapped = data.summaries
      .filter((s: XpSummary) => s.date != null)
      .map((s: XpSummary) => ({
        // Duolingo encodes `s.date` as `Date.UTC(year, month, day)`
        // — i.e. midnight UTC of the calendar-day label. Verified by
        // hitting `xp_summaries` with `timezone=America/Los_Angeles`,
        // `=UTC`, and `=Asia/Kolkata` for the same user/window: the
        // `date` field is byte-for-byte identical across all three.
        // The `timezone` query param affects which days are *included*
        // in the response (server-side bucketing on Duolingo's end via
        // their stored profile zone), not the wire encoding of `date`.
        //
        // Read it back as a UTC calendar date to recover the label
        // Duolingo sent. Reading it through R (e.g. PT) shifts the
        // label backward by one day for any negative-offset zone,
        // because midnight-UTC viewed in PT is 17:00 of the prior
        // local day. (IST and other positive-offset zones happened to
        // round-trip correctly, which is why the original IST-based
        // regression test never caught this.)
        date: formatLocalDate((s.date ?? 0) * 1000, "UTC"),
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

function createCourseOrderRecoveryTarget(user: DuolingoUser): CourseOrderRecoveryTarget {
  return {
    capturedAtMs: Date.now(),
    originalCourseId: user.currentCourseId,
    originalLearningLanguage: user.learningLanguage,
    originalFromLanguage: user.fromLanguage,
    courses: user.courses.map((course) => ({
      id: course.id,
      learningLanguage: course.learningLanguage,
      fromLanguage: course.fromLanguage,
    })),
  };
}

function withConflictReason(
  target: CourseOrderRecoveryTarget,
  conflictReason: AccountConflictKind,
): CourseOrderRecoveryTarget {
  return { ...target, conflictReason };
}

function courseIds(courses: CourseOrderRecoveryCourse[]): string[] {
  return courses.map((course) => course.id);
}

function hasCompatibleCourseSet(
  user: DuolingoUser,
  target: CourseOrderRecoveryTarget,
): boolean {
  if (!target.courses.some((course) => course.id === target.originalCourseId)) {
    return false;
  }
  const currentIds = new Set(user.courses.map((course) => course.id));
  const targetIds = new Set(target.courses.map((course) => course.id));
  if (currentIds.size !== user.courses.length || targetIds.size !== target.courses.length) {
    return false;
  }
  if (currentIds.size !== targetIds.size) {
    return false;
  }
  for (const id of currentIds) {
    if (!targetIds.has(id)) return false;
  }
  return true;
}

function resolveCourseOrderRecoveryTarget(
  user: DuolingoUser,
  requestedTarget?: CourseOrderRecoveryTarget | null,
): {
  target: CourseOrderRecoveryTarget;
  useRecoveryTarget: boolean;
  clearRequestedTarget: boolean;
  warning?: string;
} {
  const freshTarget = createCourseOrderRecoveryTarget(user);
  if (!requestedTarget) {
    return { target: freshTarget, useRecoveryTarget: false, clearRequestedTarget: false };
  }

  if (hasCompatibleCourseSet(user, requestedTarget)) {
    logger.info("course order recovery target accepted", {
      originalCourseId: requestedTarget.originalCourseId,
      courseIds: courseIds(requestedTarget.courses),
      capturedAtMs: requestedTarget.capturedAtMs,
      conflictReason: requestedTarget.conflictReason ?? null,
    });
    return { target: requestedTarget, useRecoveryTarget: true, clearRequestedTarget: false };
  }

  const warning = "Stored course-order recovery target no longer matches current course set; using current order";
  logger.warn("course order recovery target incompatible", {
    targetCourseIds: courseIds(requestedTarget.courses),
    currentCourseIds: user.courses.map((course) => course.id),
    targetOriginalCourseId: requestedTarget.originalCourseId,
    currentCourseId: user.currentCourseId,
  });
  return { target: freshTarget, useRecoveryTarget: false, clearRequestedTarget: true, warning };
}

function buildCourseOrderVisitSequence(target: CourseOrderRecoveryTarget): CourseOrderRecoveryCourse[] {
  const original = target.courses.find((course) => course.id === target.originalCourseId);
  if (!original) return [];
  const sequence: CourseOrderRecoveryCourse[] = [];
  for (let i = target.courses.length - 1; i >= 0; i--) {
    const course = target.courses[i];
    if (course.id !== target.originalCourseId) {
      sequence.push(course);
    }
  }
  sequence.push({
    id: target.originalCourseId,
    learningLanguage: target.originalLearningLanguage,
    fromLanguage: target.originalFromLanguage,
  });
  return sequence;
}

async function syncAllCourseDetails(
  client: DuolingoClient,
  user: DuolingoUser,
  recoveryTarget: CourseOrderRecoveryTarget | null = null,
  onCourseOrderMutated: () => void = () => {},
): Promise<string[]> {
  if (recoveryTarget) {
    return syncAllCourseDetailsWithRecoveryTarget(
      client,
      user,
      recoveryTarget,
      onCourseOrderMutated,
    );
  }

  const originalCourseId = user.currentCourseId;
  const originalLearning = user.learningLanguage;
  const originalFrom = user.fromLanguage;
  const warnings: string[] = [];
  const guard = createActiveCourseGuard(client, originalCourseId, user.totalXp, warnings);

  // Sync the currently active course first (no switch needed)
  await guard.check("before syncing starting course");
  await saveLanguageDetails(client, user.currentCourseId, user.learningLanguage, guard);

  // Cycle through remaining courses in REVERSE of `user.courses` order.
  // The API-returned `user.courses` mirrors the Duolingo app's own
  // course-selector order, and each `switchCourse` moves its target to
  // the top of that selector (a recency stack). Visiting non-active
  // courses in reverse and then restoring the active one last produces
  // the identity permutation on the selector — the user's existing
  // course order is preserved post-sync.
  for (let i = user.courses.length - 1; i >= 0; i--) {
    const course = user.courses[i];
    if (course.id === originalCourseId) continue;
    try {
      await guard.check(`before switching to ${course.id}`);
      logger.debug("course switch start", { courseId: course.id });
      onCourseOrderMutated();
      await client.switchCourse(course.id, course.learningLanguage, course.fromLanguage);
      guard.expect(course.id);
      await guard.check(`after switching to ${course.id}`);
      await new Promise((r) => setTimeout(r, 1000));
      await saveLanguageDetails(client, course.id, course.learningLanguage, guard);
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      logger.warn("course sync skipped", {
        courseId: course.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // skip this course if switch or fetch fails
    }
  }

  await guard.check("before restoring starting course");

  // Restore original course.
  if (user.courses.length > 1) {
    try {
      logger.debug("course restore start", { courseId: originalCourseId });
      onCourseOrderMutated();
      await client.switchCourse(originalCourseId, originalLearning, originalFrom);
      guard.expect(originalCourseId);
      await guard.check("after restoring starting course");
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      logger.error("course restore failed", { courseId: originalCourseId, error: message });
      throw new Error(`Failed to restore active course: ${message}`);
    }
  }
  return warnings;
}

async function syncAllCourseDetailsWithRecoveryTarget(
  client: DuolingoClient,
  user: DuolingoUser,
  target: CourseOrderRecoveryTarget,
  onCourseOrderMutated: () => void,
): Promise<string[]> {
  const warnings: string[] = [];
  const guard = createActiveCourseGuard(client, user.currentCourseId, user.totalXp, warnings);
  const sequence = buildCourseOrderVisitSequence(target);
  let expectedCourseId = user.currentCourseId;

  logger.info("course order recovery start", {
    originalCourseId: target.originalCourseId,
    courseIds: courseIds(target.courses),
    capturedAtMs: target.capturedAtMs,
    conflictReason: target.conflictReason ?? null,
  });

  for (const course of sequence) {
    try {
      await guard.check(`before course-order recovery switch to ${course.id}`);
      if (expectedCourseId !== course.id) {
        logger.debug("course order recovery switch start", { courseId: course.id });
        onCourseOrderMutated();
        await client.switchCourse(course.id, course.learningLanguage, course.fromLanguage);
        expectedCourseId = course.id;
        guard.expect(course.id);
        await guard.check(`after course-order recovery switch to ${course.id}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      await saveLanguageDetails(client, course.id, course.learningLanguage, guard);
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      logger.warn("course order recovery course skipped", {
        courseId: course.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return warnings;
}

async function readAccountGuardObservation(
  client: DuolingoClient,
): Promise<{ activeCourseId: string; totalXp: number } | null> {
  try {
    const user = await client.getUser();
    return { activeCourseId: user.currentCourseId, totalXp: user.totalXp };
  } catch (err) {
    logger.debug("account guard observation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

type ActiveCourseGuard = {
  expect: (courseId: string) => void;
  check: (context: string) => Promise<void>;
};

function createActiveCourseGuard(
  client: DuolingoClient,
  expectedCourseId: string,
  expectedTotalXp?: number,
  details: string[] = [],
): ActiveCourseGuard {
  let expected = expectedCourseId;
  const expectedXp = expectedTotalXp;
  return {
    expect(courseId: string) {
      expected = courseId;
    },
    async check(context: string): Promise<void> {
      const observation = await readAccountGuardObservation(client);
      if (!observation) return;

      const xpDrifted = expectedXp !== undefined && observation.totalXp !== expectedXp;
      const courseDrifted = observation.activeCourseId !== expected;

      if (xpDrifted) {
        const detail = `XP changed outside this sync ${context}: expected ${expectedXp}, saw ${observation.totalXp}`;
        details.push(detail);
        logger.warn("account XP drift", {
          context,
          expectedXp,
          observedXp: observation.totalXp,
        });
      }

      if (courseDrifted) {
        const detail = `Active course changed outside this sync ${context}: expected ${expected}, saw ${observation.activeCourseId}`;
        details.push(detail);
        logger.warn("active course drift", {
          context,
          expectedCourseId: expected,
          activeCourseId: observation.activeCourseId,
        });
        throw new ActiveCourseConflictError([...details]);
      }

      if (xpDrifted) {
        throw new XpConflictError([...details]);
      }
    },
  };
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

type VocabSnapshotRow = Parameters<typeof snapshotVocab>[1][number];

type CourseDetailDraft = {
  vocab: VocabSnapshotRow[] | null;
  skills: SkillSnapshotInput[] | null;
  mistakeCount: number | null;
};

type CourseDetailSaveResult = {
  skillCount: number | null;
  skillSource: "legacy" | "stored" | null;
};

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function mapLegacySkills(
  skills: LegacySkill[],
  pathProgress: Map<string, number>,
): SkillSnapshotInput[] {
  return skills.map((s) => {
    const levelsFinished = pathProgress.get(s.id) ?? s.levels_finished ?? s.finishedLevels ?? 0;
    return {
      skill_id: s.id,
      skill_name: s.name,
      learned: levelsFinished >= 4 || s.learned,
      strength: s.strength ?? 0,
      words: s.words ?? [],
      levels_finished: levelsFinished,
      coords_x: s.coords_x ?? 0,
      coords_y: s.coords_y ?? 0,
      dependencies: s.dependencies ?? [],
    };
  });
}

function mapStoredSkills(
  skills: StoredSkillSnapshot[],
  pathProgress: Map<string, number>,
): SkillSnapshotInput[] {
  return skills.map((s) => {
    const levelsFinished = pathProgress.get(s.skill_id) ?? Number(s.levels_finished || 0);
    return {
      skill_id: s.skill_id,
      skill_name: s.skill_name,
      learned: levelsFinished >= 4 || Number(s.learned || 0) === 1,
      strength: Number(s.strength || 0),
      words: parseStringArray(s.words_json),
      levels_finished: levelsFinished,
      coords_x: Number(s.coords_x || 0),
      coords_y: Number(s.coords_y || 0),
      dependencies: parseStringArray(s.dependencies_json),
    };
  });
}

function buildSkillSnapshotInputs(
  courseId: string,
  legacySkills: LegacySkill[] | undefined,
  pathProgress: Map<string, number>,
): { source: "legacy" | "stored"; skills: SkillSnapshotInput[] } | null {
  if (legacySkills && legacySkills.length > 0) {
    return { source: "legacy", skills: mapLegacySkills(legacySkills, pathProgress) };
  }

  const storedSkills = getLatestStoredSkillSnapshots(courseId);
  if (storedSkills.length === 0) return null;
  return { source: "stored", skills: mapStoredSkills(storedSkills, pathProgress) };
}

async function saveLanguageDetails(
  client: DuolingoClient,
  courseId: string,
  learningLanguage: string,
  guard?: ActiveCourseGuard,
): Promise<CourseDetailSaveResult> {
  const draft: CourseDetailDraft = { vocab: null, skills: null, mistakeCount: null };
  const result: CourseDetailSaveResult = { skillCount: null, skillSource: null };

  try {
    try {
      await guard?.check(`before ${courseId} vocabulary fetch`);
      const vocab = await client.getVocabulary();
      await guard?.check(`after ${courseId} vocabulary fetch`);
      if (vocab.vocab_overview) {
        draft.vocab = vocab.vocab_overview.map((w) => ({
          word: w.word_string,
          lexeme_id: w.lexeme_id,
          strength_bars: w.strength_bars,
          skill: w.skill,
          pos: w.pos,
          gender: w.gender,
          last_practiced: w.last_practiced,
        }));
      }
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      logger.debug("vocabulary fetch failed", {
        courseId,
        error: err instanceof Error ? err.message : String(err),
      });
      // vocabulary endpoint may be unavailable
    }

    try {
      await guard?.check(`before ${courseId} skill fetch`);
      const [legacy, pathSections] = await Promise.all([
        client.getLegacyUser(),
        client.getPathSectioned().catch(() => []),
      ]);
      await guard?.check(`after ${courseId} skill fetch`);
      const pathProgress = buildPathProgressMap(pathSections);
      const langData = resolveLegacyLanguageData(legacy, learningLanguage);
      const snapshot = buildSkillSnapshotInputs(courseId, langData?.skills, pathProgress);
      if (snapshot) {
        draft.skills = snapshot.skills;
        result.skillCount = snapshot.skills.length;
        result.skillSource = snapshot.source;
      }
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      logger.debug("skill fetch failed", {
        courseId,
        error: err instanceof Error ? err.message : String(err),
      });
      // legacy endpoint may be unavailable
    }

    try {
      await guard?.check(`before ${courseId} mistakes fetch`);
      const mistakeCount = await client.getMistakeCount(courseId);
      await guard?.check(`after ${courseId} mistakes fetch`);
      if (mistakeCount > 0) {
        draft.mistakeCount = mistakeCount;
      }
    } catch (err) {
      if (isAccountConflictError(err)) throw err;
      logger.debug("mistake fetch failed", {
        courseId,
        error: err instanceof Error ? err.message : String(err),
      });
      // mistakes endpoint may be unavailable
    }

    await guard?.check(`before saving ${courseId} details`);
    saveCourseDetailDraft(courseId, draft);
    return result;
  } catch (err) {
    if (isAccountConflictError(err)) {
      logger.warn("course detail writes skipped after account drift", {
        courseId,
        details: err.details,
      });
      throw err;
    }
    logger.debug("course detail save failed", {
      courseId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function saveCourseDetailDraft(courseId: string, draft: CourseDetailDraft): void {
  if (draft.vocab) {
    snapshotVocab(courseId, draft.vocab);
  }
  if (draft.skills) {
    snapshotSkills(courseId, draft.skills);
  }
  if (draft.mistakeCount != null) {
    const db = getDb();
    db.prepare(`
      UPDATE course_snapshots SET mistake_count = ?
      WHERE course_id = ? AND snapshot_time = (
        SELECT MAX(snapshot_time) FROM course_snapshots WHERE course_id = ?
      )
    `).run(draft.mistakeCount, courseId, courseId);
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
  const guard = createActiveCourseGuard(client, originalCourseId, user.totalXp, details);
  let switchedBack = !needsSwitch;

  try {
    if (needsSwitch) {
      await guard.check(`before switching to ${courseId}`);
      logger.debug("manual course switch start", { courseId });
      await client.switchCourse(courseId, learningLanguage, fromLanguage);
      guard.expect(courseId);
      details.push(`Switched from ${originalCourseId} to ${courseId}`);
      await guard.check(`after switching to ${courseId}`);
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      details.push(`Already on ${courseId}, no switch needed`);
    }

    const savedDetails = await saveLanguageDetails(client, courseId, learningLanguage, guard);
    details.push(`Saved course details for ${courseId}`);
    if (savedDetails.skillCount != null && savedDetails.skillSource) {
      const source =
        savedDetails.skillSource === "legacy"
          ? "legacy word map + path status"
          : "stored word map + path status";
      details.push(`Saved ${savedDetails.skillCount} skills for ${learningLanguage} (${source})`);
    }

    if (needsSwitch) {
      try {
        await guard.check("before restoring starting course");
        logger.debug("manual course restore start", { courseId: originalCourseId });
        await client.switchCourse(originalCourseId, originalLearning, originalFrom);
        guard.expect(originalCourseId);
        await guard.check("after restoring starting course");
        switchedBack = true;
        details.push(`Switched back to ${originalCourseId}`);
      } catch (err) {
        if (isAccountConflictError(err)) throw err;
        switchedBack = false;
        details.push(`Failed to switch back: ${err instanceof Error ? err.message : String(err)}`);
        return {
          success: false,
          switchedBack,
          error: "Failed to restore active course",
          details,
        };
      }
    }

    return { success: true, switchedBack, details };
  } catch (err) {
    if (isAccountConflictError(err)) {
      return {
        success: false,
        switchedBack: false,
        error: err.message,
        details: err.details,
      };
    }
    if (needsSwitch) {
      try {
        await guard.check("before restoring starting course after error");
        await client.switchCourse(originalCourseId, originalLearning, originalFrom);
        guard.expect(originalCourseId);
        await guard.check("after restoring starting course after error");
        switchedBack = true;
      } catch (restoreErr) {
        switchedBack = false;
        if (isAccountConflictError(restoreErr)) {
          return {
            success: false,
            switchedBack: false,
            error: restoreErr.message,
            details: restoreErr.details,
          };
        }
      }
    }
    return {
      success: false,
      switchedBack,
      error: err instanceof Error ? err.message : String(err),
      details,
    };
  }
}
