import { getDb, getLastSync, getLastFullSync } from "./db";

export function getProfile() {
  const db = getDb();
  return db.prepare("SELECT * FROM user_profile WHERE id = 1").get() as Record<string, unknown> | undefined;
}

export function getCourseLatest() {
  const db = getDb();
  return db.prepare(`
    SELECT cs.* FROM course_snapshots cs
    INNER JOIN (
      SELECT course_id, MAX(snapshot_time) as max_time
      FROM course_snapshots GROUP BY course_id
    ) latest ON cs.course_id = latest.course_id AND cs.snapshot_time = latest.max_time
    ORDER BY cs.xp DESC
  `).all() as Array<Record<string, unknown>>;
}

export function getCourseHistory(courseId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT snapshot_time, xp, crowns, streak, level, mistake_count
    FROM course_snapshots WHERE course_id = ?
    ORDER BY snapshot_time ASC
  `).all(courseId) as Array<Record<string, unknown>>;
}

export function getXpDaily(days?: number) {
  const db = getDb();
  if (days) {
    return db.prepare(`
      SELECT * FROM xp_daily
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(days) as Array<Record<string, unknown>>;
  }
  return db.prepare("SELECT * FROM xp_daily ORDER BY date ASC").all() as Array<Record<string, unknown>>;
}

/** `getXpStats()` — semantics in `docs/api-map.md` (Local SQLite). */
export const XP_STATS_SQL = `
  SELECT
    SUM(CASE WHEN gained_xp > 0 AND frozen = 0 THEN 1 ELSE 0 END) as total_days,
    SUM(gained_xp) as total_xp,
    AVG(CASE WHEN gained_xp > 0 AND frozen = 0 THEN gained_xp END) as avg_daily_xp,
    MAX(CASE WHEN frozen = 0 THEN gained_xp END) as best_day_xp,
    SUM(num_sessions) as total_sessions,
    SUM(total_session_time) as total_time_seconds,
    SUM(CASE WHEN frozen = 1 THEN 1 ELSE 0 END) as freeze_days,
    SUM(CASE WHEN streak_extended = 1 THEN 1 ELSE 0 END) as streak_days
  FROM xp_daily
`;

export function getXpStats() {
  const db = getDb();
  return db.prepare(XP_STATS_SQL).get() as Record<string, unknown>;
}

export function getVocabLatest(courseId: string) {
  const db = getDb();
  const fromVocab = db.prepare(`
    SELECT v.* FROM vocab_snapshots v
    INNER JOIN (
      SELECT MAX(snapshot_time) as max_time FROM vocab_snapshots WHERE course_id = ?
    ) latest ON v.snapshot_time = latest.max_time
    WHERE v.course_id = ?
    ORDER BY v.strength_bars ASC, v.last_practiced ASC
  `).all(courseId, courseId) as Array<Record<string, unknown>>;

  if (fromVocab.length > 0) return fromVocab;

  return getVocabFromSkills(courseId);
}

export function getVocabFromSkills(courseId: string) {
  const db = getDb();
  const skills = db.prepare(`
    SELECT s.skill_name, s.strength, s.words_json, s.first_seen FROM skill_snapshots s
    INNER JOIN (
      SELECT MAX(snapshot_time) as max_time FROM skill_snapshots WHERE course_id = ?
    ) latest ON s.snapshot_time = latest.max_time
    WHERE s.course_id = ? AND s.words_json IS NOT NULL
  `).all(courseId, courseId) as Array<Record<string, unknown>>;

  const words: Array<Record<string, unknown>> = [];
  for (const skill of skills) {
    const skillWords: string[] = JSON.parse(String(skill.words_json || "[]"));
    for (const word of skillWords) {
      words.push({
        word: word,
        lexeme_id: `${courseId}_${word}`,
        strength_bars: Math.round(Number(skill.strength || 0) * 4),
        skill: String(skill.skill_name),
        pos: null,
        gender: null,
        last_practiced: null,
        first_seen: skill.first_seen,
        source: "skills",
      });
    }
  }
  return words;
}

export function getVocabHistory(courseId: string, lexemeId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT snapshot_time, strength_bars, last_practiced
    FROM vocab_snapshots WHERE course_id = ? AND lexeme_id = ?
    ORDER BY snapshot_time ASC
  `).all(courseId, lexemeId) as Array<Record<string, unknown>>;
}

export function getVocabDecay(courseId: string) {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT MAX(snapshot_time) as t FROM vocab_snapshots WHERE course_id = ?
    ),
    previous AS (
      SELECT MAX(snapshot_time) as t FROM vocab_snapshots
      WHERE course_id = ? AND snapshot_time < (SELECT t FROM latest)
    )
    SELECT
      l.word, l.lexeme_id, l.strength_bars as current_strength,
      p.strength_bars as previous_strength,
      l.strength_bars - COALESCE(p.strength_bars, l.strength_bars) as decay,
      l.skill, l.pos, l.first_seen, l.last_practiced
    FROM vocab_snapshots l
    LEFT JOIN vocab_snapshots p ON l.lexeme_id = p.lexeme_id AND p.snapshot_time = (SELECT t FROM previous)
    WHERE l.course_id = ? AND l.snapshot_time = (SELECT t FROM latest)
    ORDER BY decay ASC, l.strength_bars ASC
  `).all(courseId, courseId, courseId) as Array<Record<string, unknown>>;
}

export function getSkillsLatest(courseId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT s.* FROM skill_snapshots s
    INNER JOIN (
      SELECT MAX(snapshot_time) as max_time FROM skill_snapshots WHERE course_id = ?
    ) latest ON s.snapshot_time = latest.max_time
    WHERE s.course_id = ?
    ORDER BY s.coords_y ASC, s.coords_x ASC
  `).all(courseId, courseId) as Array<Record<string, unknown>>;
}

export function getSkillHistory(courseId: string, skillId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT snapshot_time, strength, learned, levels_finished
    FROM skill_snapshots WHERE course_id = ? AND skill_id = ?
    ORDER BY snapshot_time ASC
  `).all(courseId, skillId) as Array<Record<string, unknown>>;
}

export function getSkillDecay(courseId: string) {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT MAX(snapshot_time) as t FROM skill_snapshots WHERE course_id = ?
    ),
    previous AS (
      SELECT MAX(snapshot_time) as t FROM skill_snapshots
      WHERE course_id = ? AND snapshot_time < (SELECT t FROM latest)
    )
    SELECT
      l.skill_id, l.skill_name, l.strength as current_strength,
      p.strength as previous_strength,
      l.strength - COALESCE(p.strength, l.strength) as decay,
      l.learned, l.levels_finished, l.words_json, l.first_seen,
      l.coords_x, l.coords_y
    FROM skill_snapshots l
    LEFT JOIN skill_snapshots p ON l.skill_id = p.skill_id AND p.snapshot_time = (SELECT t FROM previous)
    WHERE l.course_id = ? AND l.snapshot_time = (SELECT t FROM latest)
    ORDER BY decay ASC, l.strength ASC
  `).all(courseId, courseId, courseId) as Array<Record<string, unknown>>;
}

export function getCourseXpHistory(days?: number): Array<Record<string, unknown>> {
  const db = getDb();

  const toDateStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const today = new Date();
  const todayStr = toDateStr(today);

  // Determine window start date
  let startStr: string;
  if (days) {
    const s = new Date(today);
    s.setDate(s.getDate() - days);
    startStr = toDateStr(s);
  } else {
    const row = db.prepare(
      "SELECT MIN(DATE(snapshot_time)) as d FROM course_snapshots"
    ).get() as { d: string | null };
    if (!row?.d) return [];
    startStr = row.d;
  }

  // All distinct course IDs — alphabetical for stable color assignment
  const courseIds = (
    db.prepare(
      "SELECT DISTINCT course_id FROM course_snapshots ORDER BY course_id"
    ).all() as Array<{ course_id: string }>
  ).map((r) => r.course_id);

  if (courseIds.length === 0) return [];

  // Baseline: last known xp per course strictly before the window start
  const lastKnown: Record<string, number> = {};
  if (days) {
    (
      db.prepare(`
        SELECT cs.course_id, cs.xp
        FROM course_snapshots cs
        INNER JOIN (
          SELECT course_id, MAX(snapshot_time) as max_t
          FROM course_snapshots
          WHERE DATE(snapshot_time) < ?
          GROUP BY course_id
        ) pre ON cs.course_id = pre.course_id AND cs.snapshot_time = pre.max_t
      `).all(startStr) as Array<{ course_id: string; xp: number }>
    ).forEach((b) => { lastKnown[b.course_id] = b.xp; });
  }

  // All snapshots from startStr onward — dedup to last per (course_id, date)
  const byDay = new Map<string, number>();
  (
    db.prepare(`
      SELECT course_id, DATE(snapshot_time) as date, xp
      FROM course_snapshots
      WHERE DATE(snapshot_time) >= ?
      ORDER BY snapshot_time ASC
    `).all(startStr) as Array<{ course_id: string; date: string; xp: number }>
  ).forEach((r) => { byDay.set(`${r.course_id}\0${r.date}`, r.xp); });

  // Walk date range, forward-filling each course's last known value
  const result: Array<Record<string, unknown>> = [];
  const cur = new Date(`${startStr}T12:00:00`);
  const endMs = new Date(`${todayStr}T12:00:00`).getTime();

  while (cur.getTime() <= endMs) {
    const date = toDateStr(cur);
    for (const courseId of courseIds) {
      const val = byDay.get(`${courseId}\0${date}`);
      if (val !== undefined) lastKnown[courseId] = val;
    }
    const row: Record<string, unknown> = { date };
    let total = 0;
    for (const courseId of courseIds) {
      const val = lastKnown[courseId] ?? 0;
      row[courseId] = val;
      total += val;
    }
    row._total = total;
    result.push(row);
    cur.setDate(cur.getDate() + 1);
  }

  return result;
}

export function getAchievements() {
  const db = getDb();
  return db.prepare("SELECT * FROM achievements ORDER BY is_completed DESC, name ASC").all() as Array<Record<string, unknown>>;
}

export function getSyncStatus() {
  return {
    lastSync: getLastSync(),
    lastFullSync: getLastFullSync(),
  };
}

export function getCourseComparison() {
  const db = getDb();
  return db.prepare(`
    WITH latest AS (
      SELECT cs.course_id, cs.learning_language, cs.from_language, cs.title, cs.xp, cs.crowns,
        ROW_NUMBER() OVER (PARTITION BY cs.course_id ORDER BY cs.snapshot_time DESC) as rn
      FROM course_snapshots cs
    ),
    first AS (
      SELECT cs.course_id, cs.xp as first_xp, cs.snapshot_time as first_seen,
        ROW_NUMBER() OVER (PARTITION BY cs.course_id ORDER BY cs.snapshot_time ASC) as rn
      FROM course_snapshots cs
    ),
    vocab_counts AS (
      SELECT course_id, COUNT(DISTINCT lexeme_id) as word_count
      FROM vocab_snapshots v
      INNER JOIN (SELECT course_id as cid, MAX(snapshot_time) as t FROM vocab_snapshots GROUP BY course_id) m
        ON v.course_id = m.cid AND v.snapshot_time = m.t
      GROUP BY course_id
    ),
    skill_counts AS (
      SELECT course_id,
        COUNT(*) as total_skills,
        SUM(CASE WHEN levels_finished >= 5 THEN 1 ELSE 0 END) as completed_skills,
        SUM(CASE WHEN levels_finished >= 1 AND levels_finished < 5 THEN 1 ELSE 0 END) as in_progress_skills,
        SUM(CASE WHEN levels_finished = 0 THEN 1 ELSE 0 END) as not_started_skills,
        SUM(levels_finished) as total_crowns
      FROM skill_snapshots s
      INNER JOIN (SELECT course_id as cid, MAX(snapshot_time) as t FROM skill_snapshots GROUP BY course_id) m
        ON s.course_id = m.cid AND s.snapshot_time = m.t
      GROUP BY course_id
    )
    SELECT l.course_id, l.learning_language, l.from_language, l.title, l.xp,
      f.first_xp, f.first_seen,
      l.xp - f.first_xp as xp_gained,
      vc.word_count, sc.total_skills, sc.completed_skills, sc.in_progress_skills,
      sc.not_started_skills, sc.total_crowns
    FROM latest l
    LEFT JOIN first f ON l.course_id = f.course_id AND f.rn = 1
    LEFT JOIN vocab_counts vc ON l.course_id = vc.course_id
    LEFT JOIN skill_counts sc ON l.course_id = sc.course_id
    WHERE l.rn = 1
    ORDER BY l.xp DESC
  `).all() as Array<Record<string, unknown>>;
}
