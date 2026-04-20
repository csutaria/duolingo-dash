import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const BASE_SYNC_LOG_DDL = `
  CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_time TEXT NOT NULL DEFAULT (datetime('now')),
    sync_type TEXT NOT NULL,
    total_xp INTEGER,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT
  );
`;

function freshRawDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(BASE_SYNC_LOG_DDL);
  return db;
}

function columnNames(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info(sync_log)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

describe("migrateSyncLog (pure, in-memory)", () => {
  it("adds duration_ms and cycle_all when missing", () => {
    const db = freshRawDb();
    const { migrateSyncLog } = require("../db") as typeof import("../db");

    expect(columnNames(db)).not.toEqual(
      expect.arrayContaining(["duration_ms", "cycle_all"]),
    );

    migrateSyncLog(db);

    expect(columnNames(db)).toEqual(
      expect.arrayContaining(["duration_ms", "cycle_all"]),
    );
    db.close();
  });

  it("is idempotent — running twice does not throw or duplicate columns", () => {
    const db = freshRawDb();
    const { migrateSyncLog } = require("../db") as typeof import("../db");

    migrateSyncLog(db);
    expect(() => migrateSyncLog(db)).not.toThrow();

    const cols = columnNames(db);
    expect(cols.filter((c) => c === "duration_ms")).toHaveLength(1);
    expect(cols.filter((c) => c === "cycle_all")).toHaveLength(1);
    db.close();
  });

  it("gives pre-existing rows cycle_all = 0 via column default", () => {
    const db = freshRawDb();
    db.prepare(
      "INSERT INTO sync_log (sync_time, sync_type, total_xp, success) VALUES (?, ?, ?, ?)",
    ).run(new Date().toISOString(), "full", 100, 1);

    const { migrateSyncLog } = require("../db") as typeof import("../db");
    migrateSyncLog(db);

    const row = db.prepare("SELECT cycle_all, duration_ms FROM sync_log").get() as {
      cycle_all: number;
      duration_ms: number | null;
    };
    expect(row.cycle_all).toBe(0);
    expect(row.duration_ms).toBeNull();
    db.close();
  });
});

describe("logSync + getMedianDurationMs (against a real db.ts instance)", () => {
  let tmpDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-dash-test-"));
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    process.chdir(tmpDir);
    jest.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function loadDbModule() {
    return require("../db") as typeof import("../db");
  }

  describe("logSync", () => {
    it("persists durationMs and cycleAll for full syncs", () => {
      const { logSync, getDb } = loadDbModule();

      logSync({
        syncType: "full",
        totalXp: 1234,
        success: true,
        durationMs: 5000,
        cycleAll: true,
      });

      const row = getDb().prepare("SELECT * FROM sync_log").get() as Record<string, unknown>;
      expect(row.sync_type).toBe("full");
      expect(row.total_xp).toBe(1234);
      expect(row.success).toBe(1);
      expect(row.duration_ms).toBe(5000);
      expect(row.cycle_all).toBe(1);
      expect(row.error_message).toBeNull();
    });

    it("defaults duration_ms=NULL and cycle_all=0 for quick syncs", () => {
      const { logSync, getDb } = loadDbModule();

      logSync({ syncType: "quick", totalXp: 99, success: true });

      const row = getDb().prepare("SELECT * FROM sync_log").get() as Record<string, unknown>;
      expect(row.sync_type).toBe("quick");
      expect(row.duration_ms).toBeNull();
      expect(row.cycle_all).toBe(0);
    });

    it("records failed syncs with error message and duration", () => {
      const { logSync, getDb } = loadDbModule();

      logSync({
        syncType: "full",
        totalXp: 0,
        success: false,
        errorMessage: "kaboom",
        durationMs: 42,
        cycleAll: false,
      });

      const row = getDb().prepare("SELECT * FROM sync_log").get() as Record<string, unknown>;
      expect(row.success).toBe(0);
      expect(row.error_message).toBe("kaboom");
      expect(row.duration_ms).toBe(42);
      expect(row.cycle_all).toBe(0);
    });
  });

  describe("getMedianDurationMs", () => {
    function seedFullSync(
      db: Database.Database,
      opts: { durationMs: number | null; cycleAll: boolean; success?: boolean },
    ) {
      db.prepare(
        "INSERT INTO sync_log (sync_time, sync_type, total_xp, success, duration_ms, cycle_all) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        new Date().toISOString(),
        "full",
        100,
        opts.success === false ? 0 : 1,
        opts.durationMs,
        opts.cycleAll ? 1 : 0,
      );
    }

    it("returns null when no matching rows", () => {
      const { getMedianDurationMs } = loadDbModule();
      expect(getMedianDurationMs(false, 3)).toBeNull();
      expect(getMedianDurationMs(true, 3)).toBeNull();
    });

    it("returns the median of the most recent N single-course full syncs", () => {
      const { getDb, getMedianDurationMs } = loadDbModule();
      const db = getDb();

      seedFullSync(db, { durationMs: 9000, cycleAll: false });
      seedFullSync(db, { durationMs: 1000, cycleAll: false });
      seedFullSync(db, { durationMs: 2000, cycleAll: false });
      seedFullSync(db, { durationMs: 3000, cycleAll: false });

      // Last 3 by id desc are {3000, 2000, 1000} → sorted {1000, 2000, 3000} → median 2000.
      expect(getMedianDurationMs(false, 3)).toBe(2000);
    });

    it("filters by cycle_all without cross-contamination", () => {
      const { getDb, getMedianDurationMs } = loadDbModule();
      const db = getDb();

      seedFullSync(db, { durationMs: 1000, cycleAll: false });
      seedFullSync(db, { durationMs: 2000, cycleAll: false });
      seedFullSync(db, { durationMs: 60000, cycleAll: true });
      seedFullSync(db, { durationMs: 80000, cycleAll: true });
      seedFullSync(db, { durationMs: 100000, cycleAll: true });

      // cycle_all=false rows are [1000, 2000] → sorted [1000, 2000] → index 1 → 2000.
      expect(getMedianDurationMs(false, 3)).toBe(2000);
      // cycle_all=true rows are [60000, 80000, 100000] → median 80000.
      expect(getMedianDurationMs(true, 3)).toBe(80000);
    });

    it("excludes failed syncs even if they have a duration", () => {
      const { getDb, getMedianDurationMs } = loadDbModule();
      const db = getDb();

      seedFullSync(db, { durationMs: 1000, cycleAll: false, success: false });
      seedFullSync(db, { durationMs: 2000, cycleAll: false, success: false });
      seedFullSync(db, { durationMs: 3000, cycleAll: false, success: true });

      expect(getMedianDurationMs(false, 3)).toBe(3000);
    });

    it("excludes rows with null duration_ms", () => {
      const { getDb, getMedianDurationMs } = loadDbModule();
      const db = getDb();

      seedFullSync(db, { durationMs: null, cycleAll: false });
      seedFullSync(db, { durationMs: null, cycleAll: false });
      seedFullSync(db, { durationMs: 5000, cycleAll: false });

      expect(getMedianDurationMs(false, 3)).toBe(5000);
    });
  });
});
