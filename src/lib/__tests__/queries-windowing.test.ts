import Database from "better-sqlite3";
import { registerLocalDateFn } from "../db";

/**
 * Regression tests for the "days = N returns exactly N calendar days
 * including today" convention.
 *
 * The previous implementation computed `start = today - N` and walked
 * inclusively to today, producing N+1 rows. This test pins the N-row
 * invariant for `getCourseXpHistory` and `getCourseXpDailyHistory`.
 */

type QueriesModule = typeof import("../queries");

function makeDb(register: (db: Database.Database) => void = registerLocalDateFn): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  // Queries depend on the LOCAL_DATE UDF normally registered in
  // db.ts:getDb(); replicate that for in-memory test DBs. Allow the
  // caller to inject the fresh-module variant when running under
  // module-reset (timezone tests need the UDF closed over the
  // currently active tz module).
  register(db);
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

/**
 * Timezone-correctness regression tests.
 *
 * The dashboard stores `course_snapshots.snapshot_time` in UTC. Day
 * bucketing must follow the resolved server zone (R), not raw UTC,
 * or evening-PT practice (which lands on the next UTC day) gets
 * misattributed to the following local day's window.
 *
 * The original report: 6–9 PM PT practice on Apr 25 produced ~1415
 * XP, correctly attributed by Duolingo to Apr 25. The dashboard's
 * `getCourseXpHistory(1)` for the Apr 26 (PT) window showed those XP
 * as a same-day delta because the snapshot timestamps fell on
 * 2026-04-26 in UTC.
 */
describe("timezone-aware day bucketing", () => {
  const ORIGINAL_ENV = process.env.DUOLINGO_TZ;
  let db: Database.Database;
  let mod: QueriesModule;

  function setupAt(zone: string, nowMs: number): void {
    process.env.DUOLINGO_TZ = zone;
    jest.resetModules();
    jest.useFakeTimers({ now: nowMs, doNotFake: ["nextTick", "setImmediate"] });
    // Require everything fresh from the same module graph so the
    // tz module read by `db.ts` (for LOCAL_DATE) is the same one
    // `queries.ts` consults for "today" — and so the resolver
    // cache reflects the new env var.
    const dbMod = require("../db") as typeof import("../db");
    db = makeDb(dbMod.registerLocalDateFn);
    jest.doMock("../db", () => ({
      ...dbMod,
      getDb: () => db,
      getLastSync: () => null,
      getLastFullSync: () => null,
    }));
    mod = require("../queries") as QueriesModule;
    const tzMod = require("../tz") as typeof import("../tz");
    tzMod._resetForTests();
  }

  afterEach(() => {
    db?.close();
    jest.useRealTimers();
    jest.resetModules();
    jest.dontMock("../db");
    if (ORIGINAL_ENV == null) delete process.env.DUOLINGO_TZ;
    else process.env.DUOLINGO_TZ = ORIGINAL_ENV;
  });

  it("PT: evening-PT practice on Apr 25 stays in Apr 25's bucket (1d window for Apr 26 = 0)", () => {
    // Pretend "now" is Apr 26 2026, 09:00 PT (= 16:00 UTC).
    const nowMs = Date.UTC(2026, 3, 26, 16, 0, 0);
    setupAt("America/Los_Angeles", nowMs);

    // Two snapshots on Apr 25 evening PT:
    //   18:30 PT = 2026-04-26 01:30 UTC  (300 XP)
    //   21:00 PT = 2026-04-26 04:00 UTC  (400 XP) ← latest pre-window
    // No snapshot on Apr 26 PT yet.
    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 1000)").run();
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES
         ('2026-04-26T01:30:00', 'C1', 'es', 'en', 'Spanish', 300, 0, 0),
         ('2026-04-26T04:00:00', 'C1', 'es', 'en', 'Spanish', 400, 0, 0)`,
    ).run();

    // 1-day window for "today" (Apr 26 PT) — both queries should
    // report 0 same-day delta because the practice happened on
    // Apr 25 PT, not Apr 26 PT.
    const xpRows = mod.getCourseXpHistory(1);
    expect(xpRows).toHaveLength(1);
    expect(xpRows[0].date).toBe("2026-04-26");
    expect(Number(xpRows[0].C1)).toBe(0);

    const dailyRows = mod.getCourseXpDailyHistory(1);
    expect(dailyRows).toHaveLength(1);
    expect(dailyRows[0].date).toBe("2026-04-26");
    expect(Number(dailyRows[0].C1)).toBe(0);

    // Also: the underlying LOCAL_DATE bucketing pins these snapshots
    // to Apr 25 in PT.
    const buckets = db
      .prepare(
        "SELECT LOCAL_DATE(snapshot_time) as d FROM course_snapshots ORDER BY snapshot_time ASC",
      )
      .all() as Array<{ d: string }>;
    expect(buckets.map((r) => r.d)).toEqual(["2026-04-25", "2026-04-25"]);
  });

  it("UTC host: same data buckets to Apr 26 (raw UTC dates)", () => {
    // Sanity check: the UDF reflects the resolved zone. Under R=UTC
    // the same instants land on Apr 26.
    const nowMs = Date.UTC(2026, 3, 26, 16, 0, 0);
    setupAt("UTC", nowMs);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 1000)").run();
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES
         ('2026-04-26T01:30:00', 'C1', 'es', 'en', 'Spanish', 300, 0, 0),
         ('2026-04-26T04:00:00', 'C1', 'es', 'en', 'Spanish', 400, 0, 0)`,
    ).run();

    const buckets = db
      .prepare(
        "SELECT LOCAL_DATE(snapshot_time) as d FROM course_snapshots ORDER BY snapshot_time ASC",
      )
      .all() as Array<{ d: string }>;
    expect(buckets.map((r) => r.d)).toEqual(["2026-04-26", "2026-04-26"]);
  });

  it("IST: snapshot taken just before midnight UTC stays in 'today' (IST)", () => {
    // 23:30 UTC on 2026-04-25 = 05:00 IST on 2026-04-26.
    // Under R=Asia/Kolkata, that snapshot must bucket to Apr 26.
    const nowMs = Date.UTC(2026, 3, 26, 6, 30, 0); // 12:00 IST
    setupAt("Asia/Kolkata", nowMs);

    db.prepare("INSERT INTO user_profile (id, total_xp) VALUES (1, 500)").run();
    db.prepare(
      `INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
       VALUES ('2026-04-25T23:30:00', 'C1', 'es', 'en', 'Spanish', 100, 0, 0)`,
    ).run();

    const buckets = db
      .prepare(
        "SELECT LOCAL_DATE(snapshot_time) as d FROM course_snapshots ORDER BY snapshot_time ASC",
      )
      .all() as Array<{ d: string }>;
    expect(buckets).toEqual([{ d: "2026-04-26" }]);
  });
});

/**
 * Sync-side regression: `xp_daily.date` must be formatted in R when
 * persisting Duolingo `xp_summaries` rows. The pre-fix code used
 * `new Date(s.date * 1000).toISOString().split('T')[0]`, which is a
 * UTC date and skews by ±1 day for hosts where R != UTC.
 *
 * This test exercises `formatLocalDate` directly with the same
 * inputs the sync path produces, asserting the IST off-by-one
 * regression is fixed.
 */
describe("xp_daily.date formatting (IST regression)", () => {
  const ORIGINAL_ENV = process.env.DUOLINGO_TZ;

  beforeEach(() => {
    process.env.DUOLINGO_TZ = "Asia/Kolkata";
    jest.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV == null) delete process.env.DUOLINGO_TZ;
    else process.env.DUOLINGO_TZ = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("formats a UTC-second timestamp as the IST calendar day, not UTC", () => {
    const tz = require("../tz") as typeof import("../tz");
    // Duolingo's xp_summaries returns `date` as the unix-second start
    // of the local day in the requested tz. For IST, 2026-04-26 starts
    // at 18:30 UTC on Apr 25.
    const startOfIstDaySec = Math.floor(Date.UTC(2026, 3, 25, 18, 30, 0) / 1000);

    // Old behavior: new Date(_*1000).toISOString().split('T')[0]
    //   -> "2026-04-25" (UTC), wrong — this row is "today" in IST.
    const oldUtcDate = new Date(startOfIstDaySec * 1000)
      .toISOString()
      .split("T")[0];
    expect(oldUtcDate).toBe("2026-04-25");

    // New behavior: formatLocalDate(ms, R) -> "2026-04-26" (IST), right.
    const newDate = tz.formatLocalDate(startOfIstDaySec * 1000, "Asia/Kolkata");
    expect(newDate).toBe("2026-04-26");
  });
});
