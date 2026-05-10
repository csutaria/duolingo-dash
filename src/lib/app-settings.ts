import { getDb } from "./db";

/**
 * App-level user-editable settings. Persisted in the single-row
 * `app_settings` table (`id = 1`, seeded by `initSchema`). NULL columns
 * mean "fall through to the built-in default":
 *
 *  - `nightly_hour` NULL → `effectiveNightlyHour()` returns the built-in
 *    nightly default in R.
 *  - `timezone_override` NULL → resolver chain skips the UI override
 *    and falls through to `DUOLINGO_TZ` → Duolingo profile → host.
 *
 * Helpers live in their own module (separate from `db.ts`) so consumers
 * can `jest.doMock("../db", { getDb: () => testDb })` and have these
 * functions reach the mocked handle. (Functions defined inside `db.ts`
 * itself bypass that mock because their internal `getDb()` reference
 * resolves to the real module's binding, not the mock's exports.)
 */
export type AppSettings = {
  nightly_hour: number | null;
  timezone_override: string | null;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  nightly_hour: null,
  timezone_override: null,
};

/**
 * Read the single-row `app_settings`. Returns NULL-filled defaults when
 * the table doesn't exist (read-only instance pointed at a DB whose
 * writer hasn't migrated yet) or when the row is missing.
 */
export function getAppSettings(): AppSettings {
  const db = getDb();
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")
    .get();
  if (!tableExists) return { ...DEFAULT_APP_SETTINGS };
  const row = db
    .prepare("SELECT nightly_hour, timezone_override FROM app_settings WHERE id = 1")
    .get() as AppSettings | undefined;
  return row ?? { ...DEFAULT_APP_SETTINGS };
}

/**
 * Update the single-row `app_settings`. Fields not in `partial` are
 * left alone; pass `null` explicitly to reset a column to its NULL
 * fallthrough. Resolver-cache invalidation for timezone changes is the
 * caller's responsibility (do it at the API boundary, not here, so
 * tests can exercise the helper without mocking `tz.ts`).
 */
export function updateAppSettings(partial: Partial<AppSettings>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if ("nightly_hour" in partial) {
    fields.push("nightly_hour = ?");
    values.push(partial.nightly_hour ?? null);
  }
  if ("timezone_override" in partial) {
    fields.push("timezone_override = ?");
    values.push(partial.timezone_override ?? null);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE app_settings SET ${fields.join(", ")} WHERE id = 1`).run(...values);
}
