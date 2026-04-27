import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  formatLocalDate,
  invalidateResolvedTimezone,
  setProfileTimezoneLoader,
  setSettingsTimezoneLoader,
} from "./tz";
import { isReadOnlyMode } from "./read-only";
import { getAppSettings } from "./app-settings";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const DB_PATH = path.join(process.cwd(), "data", DEMO_MODE ? "mock.db" : "duolingo.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const readOnly = isReadOnlyMode();
  if (readOnly) {
    // Read-only instance: assume the writer process has already created
    // the file and run migrations. Opening with `fileMustExist: true`
    // surfaces a clear error if pointed at a missing DB instead of
    // silently creating an empty one. We still need to register the
    // `LOCAL_DATE` UDF on this connection (UDF registration is
    // per-connection, not a write) so chart queries work.
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  registerLocalDateFn(db);
  setProfileTimezoneLoader(getStoredProfileTimezone);
  // The settings loader is wired *after* `getDb()` returns the live
  // handle, but `getAppSettings()` calls `getDb()` itself — that's a
  // self-reference that resolves cleanly because the module-level `db`
  // binding is already populated above. The loader is read lazily at
  // resolver-resolve time, not now, so calling it here would be
  // premature anyway.
  setSettingsTimezoneLoader(() => getAppSettings().timezone_override);
  return db;
}

/**
 * Register a `LOCAL_DATE(utc_string)` SQLite function that buckets a
 * UTC-stored timestamp by calendar date in the resolved server zone
 * (R). Marked non-deterministic so SQLite doesn't memoize across
 * resolver-cache invalidations (e.g. when the Duolingo profile zone
 * is updated by sync).
 *
 * Storage is UTC; this UDF is the read-side bridge into R.
 *
 * Exported so tests that create their own in-memory DBs (bypassing
 * `getDb()`) can register the same function on their handle.
 */
export function registerLocalDateFn(db: Database.Database): void {
  // `varargs: false, deterministic: false` — see better-sqlite3 docs.
  db.function("LOCAL_DATE", { deterministic: false }, ((utc: unknown) => {
    if (utc == null) return null;
    const s = String(utc);
    if (!s) return null;
    const iso = s.includes("T") ? s : s.replace(" ", "T");
    const withZ = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
    const d = new Date(withZ);
    if (Number.isNaN(d.getTime())) return null;
    return formatLocalDate(d);
  }) as (...args: unknown[]) => unknown);
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS streak_epochs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      streak_start_date TEXT NOT NULL UNIQUE,
      streak_end_date TEXT,
      streak_length INTEGER,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // App-level prefs. Single-row, `id = 1`. NULL columns mean "fall through
  // to defaults" — the resolver chains live in the consumer (e.g.
  // `effectiveNightlyHour()` in `polling.ts`, `setSettingsTimezoneLoader`
  // in `tz.ts`). `timezone_override` is reserved for C4 and ignored until
  // the resolver is wired up.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nightly_hour INTEGER,
      timezone_override TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_settings (id) VALUES (1);
  `);

  migrateSyncLog(db);
  migrateStreakTracking(db);
  migrateUserProfileTimezone(db);
  migrateXpDailyDateLabels(db);
}

/**
 * One-shot migration to drop `xp_daily` rows that were written under
 * the previous (incorrect) date-formatting code, where
 * `xp_daily.date` was computed as `formatLocalDate(s.date * 1000, R)`.
 *
 * Duolingo's `xp_summaries` endpoint encodes `s.date` as
 * `Date.UTC(year, month, day)` — i.e. midnight UTC of the calendar
 * day label. Reading that instant through any negative-offset zone
 * (PT, EST, etc.) shifts the formatted string back by one day.
 * Positive-offset zones (IST, UTC+...) and UTC itself round-trip
 * correctly, so the bug only manifested for users in the Americas.
 *
 * Gated on `PRAGMA user_version`. Bump 0 -> 1 wipes the cache once;
 * the next full sync (`saveXpHistory`) re-fetches a year of summaries
 * with the corrected `formatLocalDate(_, "UTC")` keying.
 *
 * Idempotent: a second startup sees `user_version = 1` and skips.
 *
 * Read-only followers never hit this path because `initSchema` is
 * skipped when `isReadOnlyMode()` is true.
 *
 * @internal exported for tests
 */
export function migrateXpDailyDateLabels(db: Database.Database): void {
  const row = db.pragma("user_version", { simple: true }) as number;
  if (row >= 1) return;
  db.exec("DELETE FROM xp_daily");
  db.pragma("user_version = 1");
}

/** @internal exported for tests */
export function migrateStreakTracking(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(xp_daily)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "implied_freeze")) {
    db.exec("ALTER TABLE xp_daily ADD COLUMN implied_freeze INTEGER NOT NULL DEFAULT 0");
  }
}

/** @internal exported for tests */
export function migrateSyncLog(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(sync_log)").all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has("duration_ms")) {
    db.exec("ALTER TABLE sync_log ADD COLUMN duration_ms INTEGER");
  }
  if (!has("cycle_all")) {
    db.exec("ALTER TABLE sync_log ADD COLUMN cycle_all INTEGER NOT NULL DEFAULT 0");
  }
}

/** @internal exported for tests */
export function migrateUserProfileTimezone(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(user_profile)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "timezone")) {
    db.exec("ALTER TABLE user_profile ADD COLUMN timezone TEXT");
  }
}

export function updateStreakEpochs(
  currentStreakStart: string,
  previousStreakLength: number | null,
): void {
  const db = getDb();
  // `currentStreakStart` from Duolingo and `streak_epochs` rows are
  // both keyed in R-ish calendar dates; comparing against UTC's
  // `today` leaks a half-day boundary on hosts where R != UTC. Use
  // R-today instead.
  const today = formatLocalDate(new Date());

  // Never act on a streak_start that is today — intra-day sync before practice
  if (currentStreakStart >= today) return;

  const open = db
    .prepare(
      "SELECT id, streak_start_date FROM streak_epochs WHERE streak_end_date IS NULL ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number; streak_start_date: string } | undefined;

  if (!open) {
    // First sync ever — record the initial epoch
    db.prepare("INSERT OR IGNORE INTO streak_epochs (streak_start_date) VALUES (?)").run(
      currentStreakStart,
    );
    return;
  }

  if (open.streak_start_date === currentStreakStart) return; // Same streak, nothing to do

  // Streak changed: close old epoch, open new one (one day before the
  // new start). Pure date-string arithmetic — no host-zone influence.
  const [y, m, d] = currentStreakStart.split("-").map(Number);
  const endMs = Date.UTC(y, m - 1, d) - 86400000;
  const endDt = new Date(endMs);
  const endDate = `${endDt.getUTCFullYear()}-${String(endDt.getUTCMonth() + 1).padStart(2, "0")}-${String(endDt.getUTCDate()).padStart(2, "0")}`;

  db.prepare(
    "UPDATE streak_epochs SET streak_end_date = ?, streak_length = ? WHERE id = ?",
  ).run(endDate, previousStreakLength ?? null, open.id);

  db.prepare("INSERT OR IGNORE INTO streak_epochs (streak_start_date) VALUES (?)").run(
    currentStreakStart,
  );
}

export function backfillImpliedFreeze(currentStreakStart: string): void {
  const db = getDb();
  // `xp_daily.date` is keyed off Duolingo's wire calendar-day label
  // (their profile TZ, encoded midnight-UTC; see api-map.md ③), and
  // we want to compare against "today in R" for the streak cutoff —
  // these align when R == profile zone, which is the steady-state
  // configuration. `DATE('now')` returns a UTC date and would
  // mis-bucket the boundary day for hosts where R != UTC.
  // `LOCAL_DATE(datetime('now'))` converts UTC-now to R-calendar.
  db.prepare(`
    UPDATE xp_daily SET implied_freeze = 1
    WHERE date >= ?
      AND date < LOCAL_DATE(datetime('now'))
      AND gained_xp = 0
      AND streak_extended = 0
      AND frozen = 0
      AND implied_freeze = 0
  `).run(currentStreakStart);
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

export function logSync(args: {
  syncType: "quick" | "full";
  totalXp: number;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  cycleAll?: boolean;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_log (sync_time, sync_type, total_xp, success, error_message, duration_ms, cycle_all)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    args.syncType,
    args.totalXp,
    args.success ? 1 : 0,
    args.errorMessage ?? null,
    args.durationMs ?? null,
    args.cycleAll ? 1 : 0,
  );
}

export function getMedianDurationMs(cycleAll: boolean, limit = 3): number | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT duration_ms FROM sync_log
       WHERE sync_type = 'full' AND success = 1
         AND cycle_all = ?
         AND duration_ms IS NOT NULL
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(cycleAll ? 1 : 0, limit) as Array<{ duration_ms: number | null }>;
  const durations = rows
    .map((r) => r.duration_ms)
    .filter((d): d is number => typeof d === "number" && d > 0);
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Read the Duolingo profile timezone persisted at last sync.
 * Returns null when unset or before first sync with timezone data.
 */
export function getStoredProfileTimezone(): string | null {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(user_profile)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "timezone")) return null;
  const row = db.prepare("SELECT timezone FROM user_profile WHERE id = 1").get() as
    | { timezone: string | null }
    | undefined;
  return row?.timezone ?? null;
}

export function upsertProfile(data: Record<string, unknown>): void {
  const db = getDb();
  const tzRaw = data.timezone;
  const timezone =
    typeof tzRaw === "string" && tzRaw.trim().length > 0 ? tzRaw.trim() : null;
  db.prepare(`
    INSERT INTO user_profile (id, user_id, username, name, picture, bio, streak,
      current_streak_start, current_streak_length, previous_streak_length,
      total_xp, xp_goal, gems, lingots, has_plus, creation_date,
      current_course_id, learning_language, from_language, motivation, timezone, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      motivation=excluded.motivation, timezone=excluded.timezone, updated_at=datetime('now')
  `).run(
    data.user_id, data.username, data.name, data.picture, data.bio, data.streak,
    data.current_streak_start, data.current_streak_length, data.previous_streak_length,
    data.total_xp, data.xp_goal, data.gems, data.lingots, data.has_plus,
    data.creation_date, data.current_course_id, data.learning_language,
    data.from_language, data.motivation,
    timezone,
  );
  invalidateResolvedTimezone();
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
