import Database from "better-sqlite3";

/**
 * Regression tests for the "days = N returns exactly N calendar days
 * including today" convention.
 *
 * The previous implementation computed `start = today - N` and walked
 * inclusively to today, producing N+1 rows. This test pins the N-row
 * invariant for `getCourseXpHistory` and `getCourseXpDailyHistory`.
 */

type QueriesModule = typeof import("../queries");

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE course_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL,
      course_id TEXT NOT NULL,
      learning_language TEXT NOT NULL,
      from_language TEXT NOT NULL,
      title TEXT NOT NULL,
      xp INTEGER NOT NULL,
      crowns INTEGER NOT NULL,
      streak INTEGER NOT NULL
    );
    CREATE TABLE xp_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      gained_xp INTEGER NOT NULL,
      frozen INTEGER NOT NULL DEFAULT 0,
      streak_extended INTEGER NOT NULL DEFAULT 0,
      daily_goal_xp INTEGER NOT NULL DEFAULT 10,
      num_sessions INTEGER NOT NULL DEFAULT 0,
      total_session_time INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("query windowing (days = N returns N days)", () => {
  let db: Database.Database;
  let mod: QueriesModule;

  beforeEach(() => {
    jest.resetModules();
    db = makeDb();

    // Seed a single snapshot today so the functions have a course ID to
    // iterate. The exact xp doesn't matter for row-count assertions.
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 100, 0, 0)`,
    ).run(`${todayStr()}T12:00:00`);

    jest.doMock("../db", () => ({ getDb: () => db }));
    mod = require("../queries") as QueriesModule;
  });

  afterEach(() => {
    db.close();
    jest.resetModules();
    jest.dontMock("../db");
  });

  describe("getCourseXpHistory", () => {
    it("days=1 returns exactly 1 row ending today", () => {
      const rows = mod.getCourseXpHistory(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(todayStr());
    });

    it("days=7 returns exactly 7 rows ending today", () => {
      const rows = mod.getCourseXpHistory(7);
      expect(rows).toHaveLength(7);
      expect(rows[rows.length - 1].date).toBe(todayStr());
    });

    it("days=30 returns exactly 30 rows ending today", () => {
      const rows = mod.getCourseXpHistory(30);
      expect(rows).toHaveLength(30);
      expect(rows[rows.length - 1].date).toBe(todayStr());
    });
  });

  describe("getCourseXpDailyHistory", () => {
    it("days=1 returns exactly 1 row ending today", () => {
      const rows = mod.getCourseXpDailyHistory(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(todayStr());
    });

    it("days=7 returns exactly 7 rows ending today", () => {
      const rows = mod.getCourseXpDailyHistory(7);
      expect(rows).toHaveLength(7);
      expect(rows[rows.length - 1].date).toBe(todayStr());
    });

    it("days=30 returns exactly 30 rows ending today", () => {
      const rows = mod.getCourseXpDailyHistory(30);
      expect(rows).toHaveLength(30);
      expect(rows[rows.length - 1].date).toBe(todayStr());
    });
  });
});
