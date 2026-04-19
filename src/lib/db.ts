import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const DB_PATH = path.join(process.cwd(), "data", DEMO_MODE ? "mock.db" : "duolingo.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_time TEXT NOT NULL DEFAULT (datetime('now')),
      sync_type TEXT NOT NULL, -- 'quick' or 'full'
      total_xp INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS course_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL DEFAULT (datetime('now')),
      course_id TEXT NOT NULL,
      learning_language TEXT NOT NULL,
      from_language TEXT NOT NULL,
      title TEXT NOT NULL,
      xp INTEGER NOT NULL,
      crowns INTEGER NOT NULL,
      streak INTEGER NOT NULL,
      level INTEGER,
      mistake_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_course_snapshots_course
      ON course_snapshots(course_id, snapshot_time);

    CREATE TABLE IF NOT EXISTS xp_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      gained_xp INTEGER NOT NULL,
      frozen INTEGER NOT NULL DEFAULT 0,
      streak_extended INTEGER NOT NULL DEFAULT 0,
      daily_goal_xp INTEGER NOT NULL,
      num_sessions INTEGER NOT NULL DEFAULT 0,
      total_session_time INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date)
    );
    CREATE INDEX IF NOT EXISTS idx_xp_daily_date ON xp_daily(date);

    CREATE TABLE IF NOT EXISTS vocab_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL DEFAULT (datetime('now')),
      course_id TEXT NOT NULL,
      word TEXT NOT NULL,
      lexeme_id TEXT NOT NULL,
      strength_bars INTEGER NOT NULL,
      skill TEXT,
      pos TEXT,
      gender TEXT,
      last_practiced TEXT,
      first_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_course
      ON vocab_snapshots(course_id, snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_vocab_word
      ON vocab_snapshots(course_id, word, snapshot_time);

    CREATE TABLE IF NOT EXISTS skill_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL DEFAULT (datetime('now')),
      course_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      learned INTEGER NOT NULL DEFAULT 0,
      strength REAL NOT NULL DEFAULT 0,
      words_json TEXT,
      levels_finished INTEGER NOT NULL DEFAULT 0,
      coords_x INTEGER NOT NULL DEFAULT 0,
      coords_y INTEGER NOT NULL DEFAULT 0,
      dependencies_json TEXT,
      first_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_course
      ON skill_snapshots(course_id, snapshot_time);
    CREATE INDEX IF NOT EXISTS idx_skill_id
      ON skill_snapshots(course_id, skill_id, snapshot_time);

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      bio TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      current_streak_start TEXT,
      current_streak_length INTEGER,
      previous_streak_length INTEGER,
      total_xp INTEGER NOT NULL DEFAULT 0,
      xp_goal INTEGER NOT NULL DEFAULT 0,
      gems INTEGER NOT NULL DEFAULT 0,
      lingots INTEGER NOT NULL DEFAULT 0,
      has_plus INTEGER NOT NULL DEFAULT 0,
      creation_date INTEGER,
      current_course_id TEXT,
      learning_language TEXT,
      from_language TEXT,
      motivation TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achievement_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      tier INTEGER,
      is_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getLastSyncXp(): number | null {
  const db = getDb();
  const row = db
    .prepare("SELECT total_xp FROM sync_log WHERE success = 1 ORDER BY id DESC LIMIT 1")
    .get() as { total_xp: number } | undefined;
  return row?.total_xp ?? null;
}

export function getLastFullSync(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT sync_time FROM sync_log WHERE sync_type = 'full' AND success = 1 ORDER BY id DESC LIMIT 1",
    )
    .get() as { sync_time: string } | undefined;
  return row?.sync_time ?? null;
}

export function getLastSync(): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT sync_time FROM sync_log WHERE success = 1 ORDER BY id DESC LIMIT 1")
    .get() as { sync_time: string } | undefined;
  return row?.sync_time ?? null;
}

export function logSync(
  syncType: "quick" | "full",
  totalXp: number,
  success: boolean,
  errorMessage?: string,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO sync_log (sync_time, sync_type, total_xp, success, error_message) VALUES (?, ?, ?, ?, ?)",
  ).run(new Date().toISOString(), syncType, totalXp, success ? 1 : 0, errorMessage ?? null);
}

export function upsertProfile(data: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_profile (id, user_id, username, name, picture, bio, streak,
      current_streak_start, current_streak_length, previous_streak_length,
      total_xp, xp_goal, gems, lingots, has_plus, creation_date,
      current_course_id, learning_language, from_language, motivation, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username, name=excluded.name, picture=excluded.picture,
      bio=excluded.bio, streak=excluded.streak,
      current_streak_start=excluded.current_streak_start,
      current_streak_length=excluded.current_streak_length,
      previous_streak_length=excluded.previous_streak_length,
      total_xp=excluded.total_xp, xp_goal=excluded.xp_goal,
      gems=excluded.gems, lingots=excluded.lingots, has_plus=excluded.has_plus,
      creation_date=excluded.creation_date, current_course_id=excluded.current_course_id,
      learning_language=excluded.learning_language, from_language=excluded.from_language,
      motivation=excluded.motivation, updated_at=datetime('now')
  `).run(
    data.user_id, data.username, data.name, data.picture, data.bio, data.streak,
    data.current_streak_start, data.current_streak_length, data.previous_streak_length,
    data.total_xp, data.xp_goal, data.gems, data.lingots, data.has_plus,
    data.creation_date, data.current_course_id, data.learning_language,
    data.from_language, data.motivation,
  );
}

export function insertCourseSnapshot(
  courseId: string,
  learningLanguage: string,
  fromLanguage: string,
  title: string,
  xp: number,
  crowns: number,
  streak: number,
  level: number | null,
  mistakeCount: number | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO course_snapshots (course_id, learning_language, from_language, title, xp, crowns, streak, level, mistake_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(courseId, learningLanguage, fromLanguage, title, xp, crowns, streak, level, mistakeCount);
}

export function upsertXpDaily(summaries: Array<{ date: string; gainedXp: number; frozen: boolean; streakExtended: boolean; dailyGoalXp: number; numSessions: number; totalSessionTime: number }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      gained_xp=excluded.gained_xp, frozen=excluded.frozen,
      streak_extended=excluded.streak_extended, daily_goal_xp=excluded.daily_goal_xp,
      num_sessions=excluded.num_sessions, total_session_time=excluded.total_session_time
  `);
  const tx = db.transaction(() => {
    for (const s of summaries) {
      stmt.run(s.date, s.gainedXp, s.frozen ? 1 : 0, s.streakExtended ? 1 : 0, s.dailyGoalXp, s.numSessions, s.totalSessionTime);
    }
  });
  tx();
}

export function snapshotVocab(courseId: string, words: Array<{ word: string; lexeme_id: string; strength_bars: number; skill: string; pos: string; gender: string; last_practiced: string }>): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existingFirstSeen = new Map<string, string>();
  const rows = db.prepare(
    "SELECT lexeme_id, first_seen FROM vocab_snapshots WHERE course_id = ? GROUP BY lexeme_id",
  ).all(courseId) as Array<{ lexeme_id: string; first_seen: string }>;
  for (const r of rows) {
    existingFirstSeen.set(r.lexeme_id, r.first_seen);
  }

  const stmt = db.prepare(`
    INSERT INTO vocab_snapshots (snapshot_time, course_id, word, lexeme_id, strength_bars, skill, pos, gender, last_practiced, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const w of words) {
      const firstSeen = existingFirstSeen.get(w.lexeme_id) ?? now;
      stmt.run(now, courseId, w.word, w.lexeme_id, w.strength_bars, w.skill, w.pos, w.gender, w.last_practiced, firstSeen);
    }
  });
  tx();
}

export function snapshotSkills(courseId: string, skills: Array<{ skill_id: string; skill_name: string; learned: boolean; strength: number; words: string[]; levels_finished: number; coords_x: number; coords_y: number; dependencies: string[] }>): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existingFirstSeen = new Map<string, string>();
  const rows = db.prepare(
    "SELECT skill_id, first_seen FROM skill_snapshots WHERE course_id = ? GROUP BY skill_id",
  ).all(courseId) as Array<{ skill_id: string; first_seen: string }>;
  for (const r of rows) {
    existingFirstSeen.set(r.skill_id, r.first_seen);
  }

  const stmt = db.prepare(`
    INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const s of skills) {
      const firstSeen = existingFirstSeen.get(s.skill_id) ?? now;
      stmt.run(now, courseId, s.skill_id, s.skill_name, s.learned ? 1 : 0, s.strength, JSON.stringify(s.words), s.levels_finished, s.coords_x, s.coords_y, JSON.stringify(s.dependencies), firstSeen);
    }
  });
  tx();
}

export function upsertAchievements(achievements: Array<{ achievement_id: string; name: string; description?: string; tier?: number; is_completed: boolean }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO achievements (achievement_id, name, description, tier, is_completed, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(achievement_id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      tier=excluded.tier, is_completed=excluded.is_completed,
      updated_at=datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const a of achievements) {
      stmt.run(a.achievement_id, a.name, a.description ?? null, a.tier ?? null, a.is_completed ? 1 : 0);
    }
  });
  tx();
}
