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
    CREATE TABLE user_profile (
      id INTEGER PRIMARY KEY,
      total_xp INTEGER NOT NULL DEFAULT 0
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

describe("getCourseXpHistory (_pretrack / ideal anchor)", () => {
  let db: Database.Database;
  let mod: QueriesModule;

  beforeEach(() => {
    jest.resetModules();
    db = makeDb();
    jest.doMock("../db", () => ({ getDb: () => db }));
    mod = require("../queries") as QueriesModule;
  });

  afterEach(() => {
    db.close();
    jest.resetModules();
    jest.dontMock("../db");
  });

  function addDays(base: string, delta: number): string {
    const [y, m, d] = base.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  it("bounded windows: _prior offsets the stack and courses carry window deltas", () => {
    // Pre-window baseline: C1 had 300 XP two days before the 3-day window
    // start. During the window the user practices and C1 ends at 400.
    // Profile and xp_daily are consistent (anchor = 700, ideal grows 100/day).
    const today = todayStr();
    const d1 = addDays(today, -2);
    const d2 = addDays(today, -1);
    const preStart = addDays(today, -5);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 1000)").run();
    db.prepare(
      "INSERT INTO xp_daily (date, gained_xp) VALUES (?, 100), (?, 100), (?, 100)",
    ).run(d1, d2, today);
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 300, 0, 0),
              (?, 'C1', 'es', 'en', 'Spanish', 400, 0, 0)`,
    ).run(`${preStart}T12:00:00`, `${today}T12:00:00`);

    const rows = mod.getCourseXpHistory(3);
    expect(rows).toHaveLength(3);

    // _prior = max(idealAtD0, baselineSum) = max(700, 300) = 700
    // It stays constant across every row (stack offset).
    for (const row of rows) {
      expect(Number(row._prior)).toBe(700);
    }

    // D0 (d1): C1 still at baseline (300) → delta 0. idealAt = 800, total = 800.
    // _pretrack absorbs the xp_daily gain not yet visible in course deltas.
    expect(Number(rows[0].C1)).toBe(0);
    expect(Number(rows[0]._total)).toBe(800);
    expect(Number(rows[0]._pretrack)).toBe(100);
    // D1 (d2): still 300, idealAt = 900, total = 900.
    expect(Number(rows[1].C1)).toBe(0);
    expect(Number(rows[1]._pretrack)).toBe(200);
    // Today: C1 jumps to 400 → delta 100. idealAt = 1000, total = 1000.
    expect(Number(rows[2].C1)).toBe(100);
    expect(Number(rows[2]._pretrack)).toBe(200);
    expect(Number(rows[2]._total)).toBe(1000);

    // Stack invariant: _prior + _pretrack + Σ course_deltas = _total
    for (const row of rows) {
      const sumDeltas = Number(row.C1 ?? 0);
      expect(
        Number(row._prior) + Number(row._pretrack) + sumDeltas,
      ).toBe(Number(row._total));
    }
  });

  it("bounded windows: retroactive baseline on first in-window observation", () => {
    // No pre-window snapshot — course first observed on the last day of
    // the window. The baseline is captured retroactively so the stack
    // stays continuous (no visual wall) and the day's course delta is 0.
    const today = todayStr();
    const d1 = addDays(today, -2);
    const d2 = addDays(today, -1);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 1000)").run();
    db.prepare(
      "INSERT INTO xp_daily (date, gained_xp) VALUES (?, 100), (?, 100), (?, 100)",
    ).run(d1, d2, today);
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 400, 0, 0)`,
    ).run(`${today}T12:00:00`);

    const rows = mod.getCourseXpHistory(3);
    expect(rows).toHaveLength(3);

    // _prior stays at anchor (700) since no pre-window course baseline exists.
    for (const row of rows) {
      expect(Number(row._prior)).toBe(700);
    }
    // Today: C1 delta = 0 (retroactive baseline), _pretrack absorbs the gap.
    expect(Number(rows[2].C1)).toBe(0);
    expect(Number(rows[2]._total)).toBe(1000);
    expect(Number(rows[2]._pretrack)).toBe(300);
  });

  it("falls back gracefully when profile.total_xp is missing", () => {
    const today = todayStr();
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 400, 0, 0)`,
    ).run(`${today}T12:00:00`);

    // Bounded: no profile, so haveIdeal=false. _pretrack stays 0. Course
    // reports delta against the retroactively captured baseline.
    const rows = mod.getCourseXpHistory(1);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]._pretrack)).toBe(0);
    expect(Number(rows[0]._total)).toBe(400);
    expect(Number(rows[0].C1)).toBe(0);
  });

  it("all-time mode extends back to the earliest xp_daily row", () => {
    const today = todayStr();
    const early = addDays(today, -10);
    const mid = addDays(today, -5);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 500)").run();
    db.prepare("INSERT INTO xp_daily (date, gained_xp) VALUES (?, 50)").run(early);
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 100, 0, 0)`,
    ).run(`${mid}T12:00:00`);

    const rows = mod.getCourseXpHistory(undefined, "cumulative");
    // 11 days inclusive: early .. today
    expect(rows).toHaveLength(11);
    expect(rows[0].date).toBe(early);
    expect(rows[rows.length - 1].date).toBe(today);
    // All-time renders courses as their full cumulative values so the
    // chart answers "how big is each language?". _prior stays at 0 and
    // _pretrack carries xp_daily growth that predates course snapshots.
    for (const row of rows) {
      expect(Number(row._prior)).toBe(0);
    }
    // First day: no course snapshot yet, so C1=0. _pretrack covers the
    // anchor (pre-xp_daily XP) plus the early xp_daily gain.
    expect(Number(rows[0].C1)).toBe(0);
    expect(Number(rows[0]._pretrack)).toBe(500);
    expect(Number(rows[0]._total)).toBe(500);
    // After the mid snapshot, C1 reports its cumulative value (100) and
    // _pretrack drops to cover the remaining gap up to _total.
    const midRow = rows.find((r) => r.date === mid)!;
    expect(Number(midRow.C1)).toBe(100);
    expect(Number(midRow._total)).toBe(500);
    expect(Number(midRow._pretrack)).toBe(400);
    // Stack invariant: _prior + _pretrack + Σ courses = _total.
    for (const row of rows) {
      expect(
        Number(row._prior) + Number(row._pretrack) + Number(row.C1 ?? 0),
      ).toBe(Number(row._total));
    }
  });

  it("delta full span: same length as cumulative, non-zero _prior, stack invariant", () => {
    const today = todayStr();
    const early = addDays(today, -10);
    const mid = addDays(today, -5);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 500)").run();
    db.prepare("INSERT INTO xp_daily (date, gained_xp) VALUES (?, 50)").run(early);
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES (?, 'C1', 'es', 'en', 'Spanish', 100, 0, 0)`,
    ).run(`${mid}T12:00:00`);

    const cum = mod.getCourseXpHistory(undefined, "cumulative");
    const del = mod.getCourseXpHistory(undefined, "delta");
    expect(del).toHaveLength(cum.length);
    expect(Number(del[0]._prior)).toBe(450);
    expect(Number(cum[0]._prior)).toBe(0);

    for (const row of del) {
      let sumD = 0;
      for (const k of Object.keys(row)) {
        if (k === "date" || k.startsWith("_")) continue;
        sumD += Number(row[k] ?? 0);
      }
      expect(Number(row._prior) + Number(row._pretrack) + sumD).toBe(
        Number(row._total),
      );
    }
  });
});
