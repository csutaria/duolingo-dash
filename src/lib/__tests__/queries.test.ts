import Database from "better-sqlite3";
import { XP_STATS_SQL } from "../queries";

let db: Database.Database;

function initTestDb() {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_time TEXT NOT NULL DEFAULT (datetime('now')),
      sync_type TEXT NOT NULL,
      total_xp INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT
    );
    CREATE TABLE course_snapshots (
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
    CREATE TABLE xp_daily (
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
    CREATE TABLE vocab_snapshots (
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
    CREATE TABLE skill_snapshots (
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
    CREATE TABLE user_profile (
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
    CREATE TABLE achievements (
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

describe("query logic", () => {
  beforeEach(() => initTestDb());
  afterEach(() => db.close());

  describe("latest course snapshot", () => {
    it("returns only the most recent snapshot per course", () => {
      const ins = db.prepare(`
        INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run("2026-04-17T00:00:00", "DUOLINGO_UK_EN", "uk", "en", "Ukrainian", 1000, 0, 100);
      ins.run("2026-04-18T00:00:00", "DUOLINGO_UK_EN", "uk", "en", "Ukrainian", 1050, 0, 101);
      ins.run("2026-04-17T00:00:00", "DUOLINGO_ES_EN", "es", "en", "Spanish", 5000, 0, 100);
      ins.run("2026-04-18T00:00:00", "DUOLINGO_ES_EN", "es", "en", "Spanish", 5200, 0, 101);

      const rows = db.prepare(`
        SELECT cs.* FROM course_snapshots cs
        INNER JOIN (
          SELECT course_id, MAX(snapshot_time) as max_time
          FROM course_snapshots GROUP BY course_id
        ) latest ON cs.course_id = latest.course_id AND cs.snapshot_time = latest.max_time
        ORDER BY cs.xp DESC
      `).all() as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0].xp).toBe(5200);
      expect(rows[1].xp).toBe(1050);
    });
  });

  describe("vocab decay detection", () => {
    it("detects strength decrease between two snapshots", () => {
      const ins = db.prepare(`
        INSERT INTO vocab_snapshots (snapshot_time, course_id, word, lexeme_id, strength_bars, skill, pos, gender, last_practiced, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run("2026-04-17", "C1", "мама", "L1", 4, "Basics", null, null, null, "2026-01-01");
      ins.run("2026-04-17", "C1", "тато", "L2", 3, "Basics", null, null, null, "2026-01-01");
      ins.run("2026-04-18", "C1", "мама", "L1", 2, "Basics", null, null, null, "2026-01-01");
      ins.run("2026-04-18", "C1", "тато", "L2", 4, "Basics", null, null, null, "2026-01-01");

      const results = db.prepare(`
        WITH latest AS (
          SELECT MAX(snapshot_time) as t FROM vocab_snapshots WHERE course_id = ?
        ),
        previous AS (
          SELECT MAX(snapshot_time) as t FROM vocab_snapshots
          WHERE course_id = ? AND snapshot_time < (SELECT t FROM latest)
        )
        SELECT
          l.word, l.strength_bars as current_strength,
          p.strength_bars as previous_strength,
          l.strength_bars - COALESCE(p.strength_bars, l.strength_bars) as decay
        FROM vocab_snapshots l
        LEFT JOIN vocab_snapshots p ON l.lexeme_id = p.lexeme_id AND p.snapshot_time = (SELECT t FROM previous)
        WHERE l.course_id = ? AND l.snapshot_time = (SELECT t FROM latest)
        ORDER BY decay ASC
      `).all("C1", "C1", "C1") as Array<Record<string, unknown>>;

      expect(results).toHaveLength(2);
      const mama = results.find((r) => r.word === "мама")!;
      const tato = results.find((r) => r.word === "тато")!;
      expect(mama.decay).toBe(-2);
      expect(tato.decay).toBe(1);
    });

    it("returns 0 decay when there is only one snapshot", () => {
      db.prepare(`
        INSERT INTO vocab_snapshots (snapshot_time, course_id, word, lexeme_id, strength_bars, skill, pos, gender, last_practiced, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "C1", "мама", "L1", 3, "Basics", null, null, null, "2026-01-01");

      const results = db.prepare(`
        WITH latest AS (
          SELECT MAX(snapshot_time) as t FROM vocab_snapshots WHERE course_id = ?
        ),
        previous AS (
          SELECT MAX(snapshot_time) as t FROM vocab_snapshots
          WHERE course_id = ? AND snapshot_time < (SELECT t FROM latest)
        )
        SELECT
          l.word, l.strength_bars - COALESCE(p.strength_bars, l.strength_bars) as decay
        FROM vocab_snapshots l
        LEFT JOIN vocab_snapshots p ON l.lexeme_id = p.lexeme_id AND p.snapshot_time = (SELECT t FROM previous)
        WHERE l.course_id = ? AND l.snapshot_time = (SELECT t FROM latest)
      `).all("C1", "C1", "C1") as Array<Record<string, unknown>>;

      expect(results).toHaveLength(1);
      expect(results[0].decay).toBe(0);
    });
  });

  describe("skill decay detection", () => {
    it("detects strength decrease between snapshots", () => {
      const ins = db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run("2026-04-17", "C1", "s1", "Basics", 1, 0.9, "[]", 5, 0, 0, "[]", "2026-01-01");
      ins.run("2026-04-18", "C1", "s1", "Basics", 1, 0.5, "[]", 5, 0, 0, "[]", "2026-01-01");

      const results = db.prepare(`
        WITH latest AS (
          SELECT MAX(snapshot_time) as t FROM skill_snapshots WHERE course_id = ?
        ),
        previous AS (
          SELECT MAX(snapshot_time) as t FROM skill_snapshots
          WHERE course_id = ? AND snapshot_time < (SELECT t FROM latest)
        )
        SELECT
          l.skill_name, l.strength as current_strength, p.strength as previous_strength,
          l.strength - COALESCE(p.strength, l.strength) as decay
        FROM skill_snapshots l
        LEFT JOIN skill_snapshots p ON l.skill_id = p.skill_id AND p.snapshot_time = (SELECT t FROM previous)
        WHERE l.course_id = ? AND l.snapshot_time = (SELECT t FROM latest)
      `).all("C1", "C1", "C1") as Array<Record<string, unknown>>;

      expect(results).toHaveLength(1);
      expect(results[0].current_strength).toBeCloseTo(0.5);
      expect(results[0].decay).toBeCloseTo(-0.4);
    });
  });

  describe("XP stats aggregation", () => {
    it("computes correct aggregate stats", () => {
      const ins = db.prepare(`
        INSERT INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run("2026-04-16", 30, 0, 1, 10, 2, 300);
      ins.run("2026-04-17", 0, 1, 0, 10, 0, 0);
      ins.run("2026-04-18", 50, 0, 1, 10, 3, 600);

      const stats = db.prepare(XP_STATS_SQL).get() as Record<string, unknown>;

      expect(stats.total_days).toBe(2);
      expect(stats.total_xp).toBe(80);
      expect(stats.avg_daily_xp).toBe(40);
      expect(stats.best_day_xp).toBe(50);
      expect(stats.total_sessions).toBe(5);
      expect(stats.total_time_seconds).toBe(900);
      expect(stats.freeze_days).toBe(1);
      expect(stats.streak_days).toBe(2);
    });
  });

  describe("vocab from skills fallback", () => {
    it("returns vocab derived from skill word lists when vocab_snapshots is empty", () => {
      db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "C1", "s1", "Basics", 1, 0.75, '["hola","mundo"]', 5, 0, 0, "[]", "2026-01-01");

      const vocabFromVocab = db.prepare(
        "SELECT * FROM vocab_snapshots WHERE course_id = ?"
      ).all("C1");
      expect(vocabFromVocab).toHaveLength(0);

      const skills = db.prepare(`
        SELECT skill_name, strength, words_json, first_seen FROM skill_snapshots
        WHERE course_id = ? AND words_json IS NOT NULL
      `).all("C1") as Array<Record<string, unknown>>;

      const words: Array<Record<string, unknown>> = [];
      for (const skill of skills) {
        const skillWords: string[] = JSON.parse(String(skill.words_json));
        for (const word of skillWords) {
          words.push({
            word,
            strength_bars: Math.round(Number(skill.strength) * 4),
            skill: String(skill.skill_name),
          });
        }
      }

      expect(words).toHaveLength(2);
      expect(words[0]).toEqual({ word: "hola", strength_bars: 3, skill: "Basics" });
      expect(words[1]).toEqual({ word: "mundo", strength_bars: 3, skill: "Basics" });
    });
  });

  describe("course comparison", () => {
    it("joins latest course data with skill and vocab counts", () => {
      db.prepare(`
        INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "C1", "uk", "en", "Ukrainian", 1050, 0, 101);

      db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "C1", "s1", "Basics", 1, 0.8, '["a","b"]', 5, 0, 0, "[]", "2026-01-01");

      db.prepare(`
        INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength, words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("2026-04-18", "C1", "s2", "Food", 0, 0.0, '["c"]', 0, 0, 1, "[]", "2026-01-01");

      const rows = db.prepare(`
        WITH skill_counts AS (
          SELECT course_id,
            COUNT(*) as total_skills,
            SUM(CASE WHEN learned = 1 THEN 1 ELSE 0 END) as learned_skills,
            AVG(strength) as avg_strength
          FROM skill_snapshots s
          INNER JOIN (SELECT course_id as cid, MAX(snapshot_time) as t FROM skill_snapshots GROUP BY course_id) m
            ON s.course_id = m.cid AND s.snapshot_time = m.t
          GROUP BY course_id
        )
        SELECT cs.title, sc.total_skills, sc.learned_skills, sc.avg_strength
        FROM course_snapshots cs
        LEFT JOIN skill_counts sc ON cs.course_id = sc.course_id
        WHERE cs.course_id = 'C1'
        ORDER BY cs.snapshot_time DESC LIMIT 1
      `).get() as Record<string, unknown>;

      expect(rows.total_skills).toBe(2);
      expect(rows.learned_skills).toBe(1);
      expect(rows.avg_strength).toBeCloseTo(0.4);
    });
  });
});
