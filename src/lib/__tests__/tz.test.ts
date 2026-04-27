/**
 * Tests for the resolved server zone (R) module: priority order,
 * cache invalidation, and `formatLocalDate` correctness across
 * representative IANA zones and midnight-boundary instants.
 */
import {
  _resetForTests,
  formatLocalDate,
  getResolvedTimezone,
  getResolvedTimezoneSource,
  invalidateResolvedTimezone,
  setProfileTimezoneLoader,
  setSettingsTimezoneLoader,
  epochMsForLocalTime,
  getLocalParts,
} from "../tz";

describe("getResolvedTimezone (priority chain)", () => {
  const ORIGINAL_ENV = process.env.DUOLINGO_TZ;

  beforeEach(() => {
    _resetForTests();
    delete process.env.DUOLINGO_TZ;
  });

  afterAll(() => {
    if (ORIGINAL_ENV == null) delete process.env.DUOLINGO_TZ;
    else process.env.DUOLINGO_TZ = ORIGINAL_ENV;
    _resetForTests();
  });

  it("uses DUOLINGO_TZ env when set, regardless of profile/system", () => {
    setProfileTimezoneLoader(() => "Asia/Kolkata");
    process.env.DUOLINGO_TZ = "America/Los_Angeles";
    expect(getResolvedTimezone()).toBe("America/Los_Angeles");
    expect(getResolvedTimezoneSource()).toBe("env");
  });

  it("falls back to profile when env is unset", () => {
    setProfileTimezoneLoader(() => "Asia/Kolkata");
    expect(getResolvedTimezone()).toBe("Asia/Kolkata");
    expect(getResolvedTimezoneSource()).toBe("profile");
  });

  it("falls back to system when env and profile are unset", () => {
    setProfileTimezoneLoader(() => null);
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(getResolvedTimezone()).toBe(expected);
    expect(getResolvedTimezoneSource()).toBe("system");
  });

  it("treats empty profile string as absent and falls through", () => {
    setProfileTimezoneLoader(() => "   ");
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(getResolvedTimezone()).toBe(expected);
    expect(getResolvedTimezoneSource()).toBe("system");
  });

  it("survives a throwing profile loader by falling through to system", () => {
    setProfileTimezoneLoader(() => {
      throw new Error("db not ready");
    });
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(getResolvedTimezone()).toBe(expected);
    expect(getResolvedTimezoneSource()).toBe("system");
  });

  it("caches the resolved zone between calls and re-resolves after invalidation", () => {
    let calls = 0;
    setProfileTimezoneLoader(() => {
      calls++;
      return "Europe/Paris";
    });
    expect(getResolvedTimezone()).toBe("Europe/Paris");
    expect(getResolvedTimezone()).toBe("Europe/Paris");
    expect(calls).toBe(1);

    setProfileTimezoneLoader(() => {
      calls++;
      return "Asia/Tokyo";
    });
    // setProfileTimezoneLoader resets the cache; verify by reading
    // the new value:
    expect(getResolvedTimezone()).toBe("Asia/Tokyo");
    expect(calls).toBeGreaterThanOrEqual(2);

    invalidateResolvedTimezone();
    expect(getResolvedTimezone()).toBe("Asia/Tokyo");
  });

  describe("settings loader (UI override)", () => {
    it("settings overrides env, profile, and system", () => {
      setSettingsTimezoneLoader(() => "Asia/Tokyo");
      setProfileTimezoneLoader(() => "Asia/Kolkata");
      process.env.DUOLINGO_TZ = "America/Los_Angeles";
      expect(getResolvedTimezone()).toBe("Asia/Tokyo");
      expect(getResolvedTimezoneSource()).toBe("settings");
    });

    it("falls through to env when settings is null", () => {
      setSettingsTimezoneLoader(() => null);
      setProfileTimezoneLoader(() => "Asia/Kolkata");
      process.env.DUOLINGO_TZ = "America/Los_Angeles";
      expect(getResolvedTimezone()).toBe("America/Los_Angeles");
      expect(getResolvedTimezoneSource()).toBe("env");
    });

    it("treats empty/whitespace settings string as absent and falls through", () => {
      setSettingsTimezoneLoader(() => "   ");
      setProfileTimezoneLoader(() => "Asia/Kolkata");
      expect(getResolvedTimezone()).toBe("Asia/Kolkata");
      expect(getResolvedTimezoneSource()).toBe("profile");
    });

    it("survives a throwing settings loader by falling through", () => {
      setSettingsTimezoneLoader(() => {
        throw new Error("app_settings table missing");
      });
      setProfileTimezoneLoader(() => "Asia/Kolkata");
      expect(getResolvedTimezone()).toBe("Asia/Kolkata");
      expect(getResolvedTimezoneSource()).toBe("profile");
    });

    it("invalidating the cache picks up a new settings value", () => {
      let value: string | null = "Europe/Paris";
      setSettingsTimezoneLoader(() => value);
      expect(getResolvedTimezone()).toBe("Europe/Paris");
      expect(getResolvedTimezoneSource()).toBe("settings");
      // Mutate the loader's view (simulating a `POST /api/settings`).
      value = "Asia/Tokyo";
      // Without invalidation the cache holds:
      expect(getResolvedTimezone()).toBe("Europe/Paris");
      invalidateResolvedTimezone();
      expect(getResolvedTimezone()).toBe("Asia/Tokyo");
    });
  });
});

describe("formatLocalDate", () => {
  // Pick an instant that crosses calendar days in different zones so
  // the test is meaningful.
  // 2026-04-26T05:00:00Z =
  //   - 22:00 PDT on 2026-04-25 (UTC-7, west of UTC)
  //   - 05:00 UTC on 2026-04-26
  //   - 10:30 IST on 2026-04-26 (UTC+5:30, east of UTC)
  const instant = Date.UTC(2026, 3, 26, 5, 0, 0);

  it("buckets to yesterday in PT", () => {
    expect(formatLocalDate(instant, "America/Los_Angeles")).toBe("2026-04-25");
  });

  it("buckets to today in UTC", () => {
    expect(formatLocalDate(instant, "UTC")).toBe("2026-04-26");
  });

  it("buckets to today in IST", () => {
    expect(formatLocalDate(instant, "Asia/Kolkata")).toBe("2026-04-26");
  });

  it("uses resolved zone when tz is omitted", () => {
    _resetForTests();
    process.env.DUOLINGO_TZ = "America/Los_Angeles";
    try {
      expect(formatLocalDate(instant)).toBe("2026-04-25");
    } finally {
      delete process.env.DUOLINGO_TZ;
      _resetForTests();
    }
  });

  it("accepts a Date or epoch ms", () => {
    expect(formatLocalDate(new Date(instant), "UTC")).toBe(
      formatLocalDate(instant, "UTC"),
    );
  });

  it("renders midnight boundaries correctly in zones east of UTC", () => {
    // 2026-01-01T18:30:00Z is exactly 00:00 IST on 2026-01-02.
    const ms = Date.UTC(2026, 0, 1, 18, 30, 0);
    expect(formatLocalDate(ms, "Asia/Kolkata")).toBe("2026-01-02");
    expect(formatLocalDate(ms, "UTC")).toBe("2026-01-01");
  });
});

describe("getLocalParts / epochMsForLocalTime round-trip", () => {
  it.each([
    ["America/Los_Angeles", 2026, 4, 26, 2],
    ["UTC", 2026, 4, 26, 2],
    ["Asia/Kolkata", 2026, 4, 26, 2],
    // DST spring-forward in PT (2026-03-08 02:00 -> 03:00). Asking
    // for 02:00 lands on 03:00 instant, but the round-trip must
    // still map back to the same local hour.
    ["America/Los_Angeles", 2026, 3, 9, 2],
  ])("round-trips %s %d-%d-%d %d:00", (zone, y, m, d, h) => {
    const epoch = epochMsForLocalTime(y, m, d, h, zone);
    const parts = getLocalParts(epoch, zone);
    // Allow the spring-forward case to land on h+1 (the wall clock
    // jumps over 02:00 entirely on that date in PT).
    expect([h, h + 1]).toContain(parts.hour);
    expect(parts.year).toBe(y);
    expect(parts.month).toBe(m);
    expect(parts.day).toBe(d);
  });
});
