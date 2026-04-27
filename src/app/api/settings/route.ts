import { NextResponse } from "next/server";
import { getAppSettings, updateAppSettings } from "@/lib/app-settings";
import { effectiveNightlyHour, rescheduleNightly } from "@/lib/polling";
import { isReadOnlyMode } from "@/lib/read-only";
import { invalidateResolvedTimezone } from "@/lib/tz";

/**
 * Returns true if `zone` is an IANA timezone identifier accepted by the
 * runtime's ICU. Validates by constructing an `Intl.DateTimeFormat`;
 * invalid zones throw `RangeError`. This is the single validation gate
 * for the override — `tz.ts` itself never validates, so we have to
 * reject bogus values here before they reach the resolver.
 */
function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/settings — current app settings (effective values).
 *
 * Returns the *effective* `nightly_hour` (already resolved against the
 * default), not the raw stored value. The UI doesn't need to know
 * whether a value is "explicit" vs "fallthrough"; it just renders the
 * selector at the effective hour. `timezoneOverride` is the raw stored
 * string (or null) — distinct from the *resolved* zone reported by
 * `/api/status` (`resolvedTimezone` + `resolvedTimezoneSource`), which
 * is what the rest of the chain produced.
 */
export function GET() {
  return NextResponse.json({
    nightlyHour: effectiveNightlyHour(),
    timezoneOverride: getAppSettings().timezone_override,
  });
}

/**
 * POST /api/settings — update app settings.
 *
 * Body: `{ nightlyHour?: number | null, timezoneOverride?: string | null }`
 * Only the fields present in the body are touched (matches the
 * `updateAppSettings` partial-update semantics). Pass `null` to reset
 * to default.
 *
 * Side effects on success:
 *  - `nightlyHour` change → `rescheduleNightly()` re-arms the next
 *    setTimeout against the new hour. No process restart needed.
 *  - `timezoneOverride` change (set or reset) → `invalidateResolvedTimezone()`
 *    clears the resolver cache so the next `getResolvedTimezone()` call
 *    sees the new value. Subsequent buckets, scheduling, and `/api/status`
 *    pick up R immediately.
 *
 * Validation:
 *  - `nightlyHour`: integer 0..23 or null (reset).
 *  - `timezoneOverride`: a valid IANA zone string (validated via
 *    `Intl.DateTimeFormat`), or null / empty / whitespace (reset).
 *    Invalid zone strings get a 400 — the resolver itself never
 *    validates, so this is the only gate.
 *
 * Returns 503 in read-only mode (consistent with the other write
 * routes), 400 on validation failure, 200 with the new effective values
 * on success.
 */
export async function POST(request: Request) {
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read-only" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const update: { nightly_hour?: number | null; timezone_override?: string | null } = {};

  if ("nightlyHour" in body) {
    const v = body.nightlyHour;
    if (v === null) {
      update.nightly_hour = null;
    } else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23) {
      update.nightly_hour = v;
    } else {
      return NextResponse.json(
        { error: "nightlyHour must be an integer 0..23 or null" },
        { status: 400 },
      );
    }
  }

  if ("timezoneOverride" in body) {
    const v = body.timezoneOverride;
    if (v === null || (typeof v === "string" && v.trim().length === 0)) {
      update.timezone_override = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (!isValidIanaZone(trimmed)) {
        return NextResponse.json(
          {
            error: `timezoneOverride must be a valid IANA timezone (got "${trimmed}")`,
          },
          { status: 400 },
        );
      }
      update.timezone_override = trimmed;
    } else {
      return NextResponse.json(
        { error: "timezoneOverride must be a string or null" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "no recognized fields in body (expected nightlyHour, timezoneOverride)" },
      { status: 400 },
    );
  }

  try {
    updateAppSettings(update);
    if ("nightly_hour" in update) {
      rescheduleNightly();
    }
    if ("timezone_override" in update) {
      // Clear the resolver cache so the next `getResolvedTimezone()`
      // sees the new override (or, on reset, falls through to env →
      // profile → host). Cheap; no scheduling work.
      invalidateResolvedTimezone();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "settings update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    nightlyHour: effectiveNightlyHour(),
    timezoneOverride: getAppSettings().timezone_override,
  });
}
