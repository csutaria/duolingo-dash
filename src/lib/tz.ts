/**
 * Resolved server timezone (R) used as the single source of truth for
 * day-boundary decisions across the codebase: bucketing snapshots by
 * local calendar date, formatting Duolingo `xp_daily.date`, scheduling
 * the nightly tick, and computing "today" in queries.
 *
 * Storage stays UTC-native. Every read-side bucketing decision flows
 * through this resolver; that keeps us host-portable (UTC-host or
 * traveler) and matches Duolingo's `xp_daily.date` (which is keyed by
 * the user's profile timezone on Duolingo's side).
 *
 * Priority (highest first):
 *   1. UI override (`app_settings.timezone_override`) via `setSettingsTimezoneLoader`.
 *   2. `DUOLINGO_TZ` env var.
 *   3. Duolingo profile timezone (`getStoredProfileTimezone` via `setProfileTimezoneLoader`).
 *   4. `Intl.DateTimeFormat().resolvedOptions().timeZone` (Node host).
 *
 * The settings and profile loaders are wired via setter functions to
 * avoid a hard import cycle with `db.ts`. Callers that mutate either
 * source must call `invalidateResolvedTimezone()` to clear the cache.
 *
 * Validation: the resolver itself never throws and never validates
 * IANA names. The API write boundary (`POST /api/settings`) is
 * responsible for rejecting bogus zone strings, so a value that lands
 * in the DB is trusted here. If a hand-edited DB ever stores an
 * invalid zone, the next `Intl.DateTimeFormat({ timeZone })` call
 * downstream will throw — but that surface is already caught.
 */

export type TimezoneSource = "settings" | "env" | "profile" | "system";

type ZoneLoader = () => string | null;

let settingsLoader: ZoneLoader | null = null;
let profileLoader: ZoneLoader | null = null;
let cachedZone: string | null = null;
let cachedSource: TimezoneSource | null = null;

/**
 * Register the function that returns the user's UI timezone override
 * (`app_settings.timezone_override`). Called from `db.ts` at init,
 * mirroring `setProfileTimezoneLoader`. If unregistered, the resolver
 * falls through to env → profile → system.
 */
export function setSettingsTimezoneLoader(loader: ZoneLoader | null): void {
  settingsLoader = loader;
  cachedZone = null;
  cachedSource = null;
}

/**
 * Register the function that returns the stored Duolingo profile
 * timezone. Called once at module init from `db.ts` (after the DB
 * handle is ready) to avoid an import cycle. If never registered,
 * the resolver falls back through env -> system as if no profile
 * value existed.
 */
export function setProfileTimezoneLoader(loader: ZoneLoader | null): void {
  profileLoader = loader;
  cachedZone = null;
  cachedSource = null;
}

/**
 * Drop the resolver cache. Call after any operation that may have
 * changed the inputs:
 *  - profile upsert during sync,
 *  - UI override write via `POST /api/settings`.
 */
export function invalidateResolvedTimezone(): void {
  cachedZone = null;
  cachedSource = null;
}

function resolve(): { zone: string; source: TimezoneSource } {
  if (settingsLoader) {
    try {
      const settings = settingsLoader();
      if (settings && settings.trim().length > 0) {
        return { zone: settings.trim(), source: "settings" };
      }
    } catch {
      // Settings loader failures (DB missing app_settings table on a
      // read-only follower pointed at an un-migrated DB) fall through
      // silently. Resolver must never throw.
    }
  }

  const env = process.env.DUOLINGO_TZ?.trim();
  if (env) return { zone: env, source: "env" };

  if (profileLoader) {
    try {
      const profile = profileLoader();
      if (profile && profile.trim().length > 0) {
        return { zone: profile.trim(), source: "profile" };
      }
    } catch {
      // Profile loader failures (DB not ready, schema mismatch) fall
      // through to system. Resolver must never throw.
    }
  }

  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // `Intl` may return "UTC" or, very rarely on misconfigured hosts,
  // an empty string. UTC is a valid IANA zone and a fine fallback.
  return { zone: system || "UTC", source: "system" };
}

export function getResolvedTimezone(): string {
  if (cachedZone == null) {
    const r = resolve();
    cachedZone = r.zone;
    cachedSource = r.source;
  }
  return cachedZone;
}

export function getResolvedTimezoneSource(): TimezoneSource {
  if (cachedSource == null) {
    const r = resolve();
    cachedZone = r.zone;
    cachedSource = r.source;
  }
  return cachedSource;
}

/**
 * Format an instant as `YYYY-MM-DD` in the given IANA zone (default:
 * resolved zone). Uses `en-CA` locale because it produces ISO-style
 * date strings; safe for use as SQL date literals.
 */
export function formatLocalDate(d: Date | number, tz?: string): string {
  const date = typeof d === "number" ? new Date(d) : d;
  const zone = tz ?? getResolvedTimezone();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Format an instant as `{ year, month, day, hour, minute, second }`
 * numeric parts in the given zone. Used by the nightly scheduler so
 * "next 02:00 in R" survives DST transitions.
 */
export function getLocalParts(
  d: Date | number,
  tz?: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const date = typeof d === "number" ? new Date(d) : d;
  const zone = tz ?? getResolvedTimezone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === "year" || p.type === "month" || p.type === "day"
      || p.type === "hour" || p.type === "minute" || p.type === "second") {
      // `hour: "2-digit", hour12: false` may emit "24" at midnight on
      // some ICU builds; normalize to 0.
      const v = parseInt(p.value, 10);
      out[p.type] = p.type === "hour" && v === 24 ? 0 : v;
    }
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/**
 * Compute the UNIX epoch ms of `year-month-day hour:00:00` in the
 * given zone. Implemented by binary-search-free "guess-and-correct":
 * compute a UTC guess, measure its offset in zone, and adjust.
 *
 * DST-safe within ~1 second.
 */
export function epochMsForLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz?: string,
): number {
  const zone = tz ?? getResolvedTimezone();
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const parts = getLocalParts(guess, zone);
  const guessAsLocal = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMs = guess - guessAsLocal;
  return guess + offsetMs;
}

/** @internal tests */
export function _resetForTests(): void {
  settingsLoader = null;
  profileLoader = null;
  cachedZone = null;
  cachedSource = null;
}
