import { NextResponse } from "next/server";
import { getAppSettings, updateAppSettings } from "@/lib/app-settings";
import { effectiveNightlyHour, rescheduleNightly } from "@/lib/polling";
import { isReadOnlyMode } from "@/lib/read-only";

/**
 * GET /api/settings — current app settings (effective values).
 *
 * Returns the *effective* `nightly_hour` (already resolved against the
 * default), not the raw stored value. The UI doesn't need to know
 * whether a value is "explicit" vs "fallthrough"; it just renders the
 * selector at the effective hour. `timezone_override` is the raw
 * stored string (or null) — C4 will surface it.
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
 *  - `timezoneOverride` is stored but the resolver is wired in C4; for
 *    now this just persists the value.
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
      // Don't validate IANA zones here — `tz.ts` already validates and
      // falls back at resolution time. Accepting unknown strings here
      // keeps the API surface narrow and lets the resolver own the
      // validity check.
      update.timezone_override = v.trim();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "settings update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    nightlyHour: effectiveNightlyHour(),
    timezoneOverride: getAppSettings().timezone_override,
  });
}
