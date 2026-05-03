import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const { seed } = jest.requireActual("../../../scripts/seed-mock") as {
  seed: (outPath?: string) => string;
};

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function sumDailyXp(db: Database.Database, start: string, end: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(gained_xp), 0) AS total FROM xp_daily WHERE date >= ? AND date <= ?",
    )
    .get(start, end) as { total: number };
  return row.total;
}

function courseDeltaForWindow(db: Database.Database, start: string, end: string): number {
  const courseIds = (
    db.prepare("SELECT DISTINCT course_id FROM course_snapshots").all() as Array<{
      course_id: string;
    }>
  ).map((row) => row.course_id);

  let total = 0;
  for (const courseId of courseIds) {
    const baseline = db
      .prepare(
        `
          SELECT xp FROM course_snapshots
          WHERE course_id = ? AND substr(snapshot_time, 1, 10) < ?
          ORDER BY snapshot_time DESC
          LIMIT 1
        `,
      )
      .get(courseId, start) as { xp: number } | undefined;
    const latest = db
      .prepare(
        `
          SELECT xp FROM course_snapshots
          WHERE course_id = ? AND substr(snapshot_time, 1, 10) <= ?
          ORDER BY snapshot_time DESC
          LIMIT 1
        `,
      )
      .get(courseId, end) as { xp: number } | undefined;
    total += Math.max(0, (latest?.xp ?? 0) - (baseline?.xp ?? 0));
  }
  return total;
}

function snapshotIntervalDeltas(db: Database.Database): Array<{
  olderDate: string;
  newerDate: string;
  dailyXp: number;
  courseDelta: number;
}> {
  const dates = (
    db
      .prepare(
        "SELECT DISTINCT substr(snapshot_time, 1, 10) AS date FROM course_snapshots ORDER BY date ASC",
      )
      .all() as Array<{ date: string }>
  ).map((row) => row.date);

  return dates.slice(1).map((newerDate, index) => {
    const olderDate = dates[index];
    const dailyXp = sumDailyXp(db, addDays(olderDate, 1), newerDate);
    const courseDelta = courseDeltaForWindow(db, addDays(olderDate, 1), newerDate);
    return { olderDate, newerDate, dailyXp, courseDelta };
  });
}

describe("mock screenshot seed", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-dash-seed-"));
    dbPath = path.join(tmpDir, "mock.db");
    seed(dbPath);
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps account-wide daily XP consistent with tracked course gains", () => {
    const today = (
      db.prepare("SELECT MAX(date) AS date FROM xp_daily").get() as { date: string }
    ).date;

    for (const days of [1, 3, 7, 30, 90]) {
      const start = addDays(today, -(days - 1));
      const dailyXp = sumDailyXp(db, start, today);
      const courseDelta = courseDeltaForWindow(db, start, today);
      expect(dailyXp).toBeGreaterThanOrEqual(courseDelta);
      expect(dailyXp - courseDelta).toBeGreaterThan(0);
    }

    for (const interval of snapshotIntervalDeltas(db)) {
      expect(interval.dailyXp).toBeGreaterThanOrEqual(interval.courseDelta);
      if (interval.courseDelta > 0) {
        expect(interval.dailyXp - interval.courseDelta).toBeGreaterThan(0);
      }
    }
  });

  it("preserves the screenshot streak story and pre-tracking gap", () => {
    const today = (
      db.prepare("SELECT MAX(date) AS date FROM xp_daily").get() as { date: string }
    ).date;

    const profile = db.prepare("SELECT * FROM user_profile WHERE id = 1").get() as {
      current_streak_start: string;
      current_streak_length: number;
      previous_streak_length: number;
      total_xp: number;
    };
    expect(profile.current_streak_start).toBe(addDays(today, -20));
    expect(profile.current_streak_length).toBe(21);
    expect(profile.previous_streak_length).toBe(95);

    const latestCourseXp = (
      db
        .prepare(
          `
            SELECT COALESCE(SUM(xp), 0) AS total
            FROM course_snapshots cs
            INNER JOIN (
              SELECT course_id, MAX(snapshot_time) AS max_time
              FROM course_snapshots
              GROUP BY course_id
            ) latest ON cs.course_id = latest.course_id AND cs.snapshot_time = latest.max_time
          `,
        )
        .get() as { total: number }
    ).total;
    expect(profile.total_xp).toBeGreaterThan(latestCourseXp);

    const closedEpoch = db
      .prepare(
        "SELECT * FROM streak_epochs WHERE streak_start_date = ? AND streak_end_date = ?",
      )
      .get(addDays(today, -120), addDays(today, -25)) as
      | { streak_length: number }
      | undefined;
    expect(closedEpoch?.streak_length).toBe(95);

    const currentEpoch = db
      .prepare("SELECT * FROM streak_epochs WHERE streak_start_date = ?")
      .get(addDays(today, -20)) as { streak_end_date: string | null } | undefined;
    expect(currentEpoch?.streak_end_date).toBeNull();

    const zeroStoryDays = [25, 24, 23, 22, 21, 15, 7, 4].map((daysAgo) => {
      return db
        .prepare(
          `
            SELECT date, gained_xp, frozen, streak_extended, implied_freeze
            FROM xp_daily
            WHERE date = ?
          `,
        )
        .get(addDays(today, -daysAgo)) as {
        date: string;
        gained_xp: number;
        frozen: number;
        streak_extended: number;
        implied_freeze: number;
      };
    });

    expect(zeroStoryDays.map((row) => row.gained_xp)).toEqual(Array(8).fill(0));
    expect(zeroStoryDays[0]).toMatchObject({ frozen: 0, streak_extended: 0, implied_freeze: 0 });
    expect(zeroStoryDays.slice(1, 5).map((row) => row.frozen)).toEqual([0, 0, 0, 0]);
    expect(zeroStoryDays[5]).toMatchObject({ implied_freeze: 1 });
    expect(zeroStoryDays[6]).toMatchObject({ frozen: 1 });
    expect(zeroStoryDays[7]).toMatchObject({ implied_freeze: 1 });
  });
});
