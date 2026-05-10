import Database from "better-sqlite3";

/**
 * Tests `getAppSettings` / `updateAppSettings` and `effectiveNightlyHour`
 * (the resolver in `polling.ts` that consumes the stored value).
 *
 * Pattern matches `queries-windowing.test.ts`: build an in-memory
 * SQLite, `jest.doMock("../db", { getDb: () => db })` to inject it into
 * the modules under test (`app-settings.ts`, `polling.ts`), then
 * `require()` them so their top-level `import { getDb } from "./db"`
 * resolves to our test handle.
 */

type AppSettingsModule = typeof import("../app-settings");
type PollingModule = typeof import("../polling");

function makeDb(seedRow = true, includeTable = true): Database.Database {
  const db = new Database(":memory:");
  if (includeTable) {
    db.exec(`
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nightly_hour INTEGER,
        timezone_override TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    if (seedRow) {
      db.prepare("INSERT INTO app_settings (id) VALUES (1)").run();
    }
  }
  return db;
}

describe("app_settings helpers", () => {
  let db: Database.Database;
  let mod: AppSettingsModule;

  beforeEach(() => {
    jest.resetModules();
    db = makeDb();
    jest.doMock("../db", () => ({ getDb: () => db }));
    mod = require("../app-settings") as AppSettingsModule;
  });

  afterEach(() => {
    db.close();
    jest.dontMock("../db");
  });

  describe("getAppSettings", () => {
    it("returns NULL defaults for the freshly-seeded row", () => {
      expect(mod.getAppSettings()).toEqual({
        nightly_hour: null,
        timezone_override: null,
      });
    });

    it("returns NULL defaults when the table is missing (read-only on un-migrated DB)", () => {
      db.close();
      db = makeDb(false, false);
      expect(mod.getAppSettings()).toEqual({
        nightly_hour: null,
        timezone_override: null,
      });
    });

    it("returns NULL defaults when the row is missing (table exists but un-seeded)", () => {
      db.close();
      db = makeDb(false, true);
      expect(mod.getAppSettings()).toEqual({
        nightly_hour: null,
        timezone_override: null,
      });
    });

    it("reads the stored value back after an update", () => {
      mod.updateAppSettings({ nightly_hour: 7 });
      expect(mod.getAppSettings().nightly_hour).toBe(7);
    });
  });

  describe("updateAppSettings", () => {
    it("updates only the fields present in the partial", () => {
      mod.updateAppSettings({ nightly_hour: 4 });
      mod.updateAppSettings({ timezone_override: "America/Los_Angeles" });
      expect(mod.getAppSettings()).toEqual({
        nightly_hour: 4,
        timezone_override: "America/Los_Angeles",
      });
    });

    it("resets a field to NULL when explicitly set to null", () => {
      mod.updateAppSettings({ nightly_hour: 11 });
      mod.updateAppSettings({ nightly_hour: null });
      expect(mod.getAppSettings().nightly_hour).toBeNull();
    });

    it("is a no-op when the partial is empty", () => {
      mod.updateAppSettings({ nightly_hour: 9 });
      mod.updateAppSettings({});
      expect(mod.getAppSettings().nightly_hour).toBe(9);
    });
  });
});

describe("effectiveNightlyHour", () => {
  let db: Database.Database;
  let polling: PollingModule;

  beforeEach(() => {
    jest.resetModules();
    db = makeDb();
    jest.doMock("../db", () => ({ getDb: () => db }));
    polling = require("../polling") as PollingModule;
  });

  afterEach(() => {
    db.close();
    jest.dontMock("../db");
  });

  it("returns the documented default (23) when the row has NULL nightly_hour", () => {
    expect(polling.effectiveNightlyHour()).toBe(polling.NIGHTLY_HOUR_DEFAULT);
    expect(polling.NIGHTLY_HOUR_DEFAULT).toBe(23);
  });

  it("returns the stored value when it's a valid 0..23 integer", () => {
    db.prepare("UPDATE app_settings SET nightly_hour = ? WHERE id = 1").run(0);
    expect(polling.effectiveNightlyHour()).toBe(0);
    db.prepare("UPDATE app_settings SET nightly_hour = ? WHERE id = 1").run(23);
    expect(polling.effectiveNightlyHour()).toBe(23);
    db.prepare("UPDATE app_settings SET nightly_hour = ? WHERE id = 1").run(7);
    expect(polling.effectiveNightlyHour()).toBe(7);
  });

  it("ignores out-of-range values and falls back to default", () => {
    db.prepare("UPDATE app_settings SET nightly_hour = ? WHERE id = 1").run(-1);
    expect(polling.effectiveNightlyHour()).toBe(polling.NIGHTLY_HOUR_DEFAULT);
    db.prepare("UPDATE app_settings SET nightly_hour = ? WHERE id = 1").run(24);
    expect(polling.effectiveNightlyHour()).toBe(polling.NIGHTLY_HOUR_DEFAULT);
  });

  it("does not throw when the table is missing — returns default", () => {
    db.close();
    db = makeDb(false, false);
    expect(() => polling.effectiveNightlyHour()).not.toThrow();
    expect(polling.effectiveNightlyHour()).toBe(polling.NIGHTLY_HOUR_DEFAULT);
  });
});
