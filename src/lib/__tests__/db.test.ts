import Database from "better-sqlite3";

let db: Database.Database;

function initTestDb() {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Replicate schema from db.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_time TEXT NOT NULL DEFAULT (datetime('now')),
      sync_type TEXT NOT NULL,
      total_xp INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS all_course_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_time TEXT NOT NULL
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

  return db;
}

describe("database schema", () => {
  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("xp_daily", () => {
    it("inserts XP data with all fields", () => {
      db.prepare(`
        INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", 50, 0, 1, 10, 3, 600);

      const row = db.prepare("SELECT * FROM xp_daily WHERE date = ?").get("2026-04-18") as Record<string, unknown>;
      expect(row.gained_xp).toBe(50);
      expect(row.num_sessions).toBe(3);
    });

    it("handles zero XP entries (NOT NULL constraint satisfied)", () => {
      expect(() => {
        db.prepare(`
          INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("2026-04-18", 0, 0, 0, 10, 0, 0);
      }).not.toThrow();
    });

    it("rejects null gained_xp", () => {
      expect(() => {
        db.prepare(`
          INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("2026-04-18", null, 0, 0, 10, 0, 0);
      }).toThrow();
    });

    it("upserts on duplicate date", () => {
      db.prepare(`
        INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", 50, 0, 1, 10, 3, 600);

      db.prepare(`
        INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET gained_xp=excluded.gained_xp
      `).run("2026-04-18", 100, 0, 1, 10, 5, 1200);

      const row = db.prepare("SELECT * FROM xp_daily WHERE date = ?").get("2026-04-18") as Record<string, unknown>;
      expect(row.gained_xp).toBe(100);
    });
  });

  describe("vocab from skills fallback", () => {
    it("extracts words from skill snapshots", () => {
      db.prepare(`
        INSERT INTO skill_snapshots (course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("DUOLINGO_UK_EN", "s1", "Alphabet 1", 1, 0.75, '["мама","тато","там"]', 5, 0, 0, "[]", "2026-04-18");

      const skills = db.prepare(`
        SELECT skill_name, strength, words_json, first_seen FROM skill_snapshots WHERE course_id = ?
      `).all("DUOLINGO_UK_EN") as Array<Record<string, unknown>>;

      const words: Array<Record<string, unknown>> = [];
      for (const skill of skills) {
        const skillWords: string[] = JSON.parse(String(skill.words_json || "[]"));
        for (const word of skillWords) {
          words.push({
            word,
            strength_bars: Math.round(Number(skill.strength || 0) * 4),
            skill: String(skill.skill_name),
          });
        }
      }

      expect(words).toHaveLength(3);
      expect(words[0].word).toBe("мама");
      expect(words[0].strength_bars).toBe(3);
      expect(words[0].skill).toBe("Alphabet 1");
    });
  });

  describe("skill snapshots", () => {
    it("preserves first_seen across multiple snapshots", () => {
      const firstTime = "2026-01-01T00:00:00.000Z";
      db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-01-01", "DUOLINGO_UK_EN", "s1", "Basics", 0, 0, "[]", 0, 0, 0, "[]", firstTime);

      db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "DUOLINGO_UK_EN", "s1", "Basics", 1, 0.8, "[]", 5, 0, 0, "[]", firstTime);

      const rows = db.prepare(
        "SELECT first_seen FROM skill_snapshots WHERE skill_id = 's1' ORDER BY snapshot_time"
      ).all() as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0].first_seen).toBe(firstTime);
      expect(rows[1].first_seen).toBe(firstTime);
    });
  });

  describe("course snapshots", () => {
    it("records multiple snapshots for the same course", () => {
      const insert = db.prepare(`
        INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run("2026-04-17", "DUOLINGO_UK_EN", "uk", "en", "Ukrainian", 1000, 0, 100);
      insert.run("2026-04-18", "DUOLINGO_UK_EN", "uk", "en", "Ukrainian", 1050, 0, 101);

      const rows = db.prepare(
        "SELECT * FROM course_snapshots WHERE course_id = ? ORDER BY snapshot_time"
      ).all("DUOLINGO_UK_EN") as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[1].xp).toBe(1050);
    });
  });
});
