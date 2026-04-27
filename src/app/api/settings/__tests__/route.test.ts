/**
 * Route handler test for GET / POST /api/settings.
 *
 * The handler delegates to `getAppSettings` / `updateAppSettings` from
 * `@/lib/app-settings` and re-arms the nightly timer via
 * `rescheduleNightly` from `@/lib/polling`. We mock both modules so no
 * real DB or timer work happens here; the validation/wiring is what
 * this test pins.
 */

type AppSettingsMock = {
  stored: { nightly_hour: number | null; timezone_override: string | null };
  getAppSettings: jest.Mock;
  updateAppSettings: jest.Mock;
};

type PollingMock = {
  effectiveNightlyHour: jest.Mock<number, []>;
  rescheduleNightly: jest.Mock<void, []>;
};

type TzMock = {
  invalidateResolvedTimezone: jest.Mock<void, []>;
};

function setupMocks() {
  const settings: AppSettingsMock = {
    stored: { nightly_hour: null, timezone_override: null },
    getAppSettings: jest.fn(),
    updateAppSettings: jest.fn(),
  };
  settings.getAppSettings.mockImplementation(() => ({ ...settings.stored }));
  settings.updateAppSettings.mockImplementation(
    (patch: { nightly_hour?: number | null; timezone_override?: string | null }) => {
      if ("nightly_hour" in patch) settings.stored.nightly_hour = patch.nightly_hour ?? null;
      if ("timezone_override" in patch)
        settings.stored.timezone_override = patch.timezone_override ?? null;
    },
  );

  const polling: PollingMock = {
    effectiveNightlyHour: jest.fn(),
    rescheduleNightly: jest.fn(),
  };
  polling.effectiveNightlyHour.mockImplementation(() => settings.stored.nightly_hour ?? 2);

  const tz: TzMock = {
    invalidateResolvedTimezone: jest.fn(),
  };

  jest.doMock("@/lib/app-settings", () => ({
    getAppSettings: settings.getAppSettings,
    updateAppSettings: settings.updateAppSettings,
  }));
  jest.doMock("@/lib/polling", () => ({
    effectiveNightlyHour: polling.effectiveNightlyHour,
    rescheduleNightly: polling.rescheduleNightly,
  }));
  jest.doMock("@/lib/tz", () => ({
    invalidateResolvedTimezone: tz.invalidateResolvedTimezone,
  }));

  return { settings, polling, tz };
}

function loadRoute() {
  return require("../route") as typeof import("../route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const originalReadOnly = process.env.DUOLINGO_READ_ONLY;

beforeEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/app-settings");
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/tz");
});

afterEach(() => {
  if (originalReadOnly === undefined) delete process.env.DUOLINGO_READ_ONLY;
  else process.env.DUOLINGO_READ_ONLY = originalReadOnly;
  jest.resetModules();
  jest.dontMock("@/lib/app-settings");
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/tz");
});

describe("GET /api/settings", () => {
  it("returns the effective nightlyHour and stored timezoneOverride", async () => {
    const { settings } = setupMocks();
    settings.stored.nightly_hour = 5;
    settings.stored.timezone_override = "America/Los_Angeles";
    const { GET } = loadRoute();

    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      nightlyHour: 5,
      timezoneOverride: "America/Los_Angeles",
    });
  });

  it("returns the default nightlyHour (2) when nothing is stored", async () => {
    setupMocks();
    const { GET } = loadRoute();

    const body = await GET().json();

    expect(body).toEqual({ nightlyHour: 2, timezoneOverride: null });
  });
});

describe("POST /api/settings", () => {
  describe("nightlyHour", () => {
    it("accepts an integer 0..23 and re-arms the nightly timer", async () => {
      const { settings, polling } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ nightlyHour: 7 }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ nightlyHour: 7, timezoneOverride: null });
      expect(settings.updateAppSettings).toHaveBeenCalledWith({ nightly_hour: 7 });
      expect(polling.rescheduleNightly).toHaveBeenCalledTimes(1);
    });

    it("accepts the boundary values 0 and 23", async () => {
      const { polling } = setupMocks();
      const { POST } = loadRoute();

      const r0 = await POST(postRequest({ nightlyHour: 0 }));
      expect(r0.status).toBe(200);
      const r23 = await POST(postRequest({ nightlyHour: 23 }));
      expect(r23.status).toBe(200);

      expect(polling.rescheduleNightly).toHaveBeenCalledTimes(2);
    });

    it("accepts null to reset to default and still re-arms the timer", async () => {
      const { settings, polling } = setupMocks();
      settings.stored.nightly_hour = 5;
      const { POST } = loadRoute();

      const res = await POST(postRequest({ nightlyHour: null }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(settings.updateAppSettings).toHaveBeenCalledWith({ nightly_hour: null });
      expect(polling.rescheduleNightly).toHaveBeenCalledTimes(1);
      expect(body.nightlyHour).toBe(2);
    });

    it("rejects non-integer numbers (400, no update, no reschedule)", async () => {
      const { settings, polling } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ nightlyHour: 2.5 }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/0\.\.23|integer/);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
      expect(polling.rescheduleNightly).not.toHaveBeenCalled();
    });

    it("rejects out-of-range values (-1, 24)", async () => {
      const { settings, polling } = setupMocks();
      const { POST } = loadRoute();

      for (const v of [-1, 24, 100]) {
        const res = await POST(postRequest({ nightlyHour: v }));
        expect(res.status).toBe(400);
      }
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
      expect(polling.rescheduleNightly).not.toHaveBeenCalled();
    });

    it("rejects non-numeric values", async () => {
      const { settings } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ nightlyHour: "7" }));
      expect(res.status).toBe(400);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
    });
  });

  describe("timezoneOverride", () => {
    it("stores a valid IANA name, invalidates the resolver cache, and does NOT re-arm the nightly timer", async () => {
      const { settings, polling, tz } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ timezoneOverride: "Asia/Tokyo" }));
      expect(res.status).toBe(200);
      expect(settings.updateAppSettings).toHaveBeenCalledWith({ timezone_override: "Asia/Tokyo" });
      expect(tz.invalidateResolvedTimezone).toHaveBeenCalledTimes(1);
      // Only nightly_hour changes need to re-arm the setTimeout.
      expect(polling.rescheduleNightly).not.toHaveBeenCalled();
    });

    it("trims whitespace before validating and storing", async () => {
      const { settings, tz } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ timezoneOverride: "  America/Los_Angeles  " }));
      expect(res.status).toBe(200);
      expect(settings.updateAppSettings).toHaveBeenCalledWith({
        timezone_override: "America/Los_Angeles",
      });
      expect(tz.invalidateResolvedTimezone).toHaveBeenCalledTimes(1);
    });

    it("treats null and the empty string as 'reset to default' and still invalidates the cache", async () => {
      const { settings, tz } = setupMocks();
      const { POST } = loadRoute();

      await POST(postRequest({ timezoneOverride: null }));
      await POST(postRequest({ timezoneOverride: "" }));
      await POST(postRequest({ timezoneOverride: "   " }));

      for (const call of settings.updateAppSettings.mock.calls) {
        expect(call[0]).toEqual({ timezone_override: null });
      }
      expect(settings.updateAppSettings).toHaveBeenCalledTimes(3);
      // Each reset still clears the resolver cache so the chain
      // re-runs (env → profile → host) on the next read.
      expect(tz.invalidateResolvedTimezone).toHaveBeenCalledTimes(3);
    });

    it("rejects an invalid IANA zone (400, no DB write, no cache invalidate)", async () => {
      const { settings, tz, polling } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ timezoneOverride: "Mars/Olympus_Mons" }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/timezoneOverride must be a valid IANA timezone/);
      expect(body.error).toMatch(/Mars\/Olympus_Mons/);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
      expect(tz.invalidateResolvedTimezone).not.toHaveBeenCalled();
      expect(polling.rescheduleNightly).not.toHaveBeenCalled();
    });

    it("rejects gibberish strings", async () => {
      const { settings, tz } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ timezoneOverride: "not_a_zone" }));
      expect(res.status).toBe(400);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
      expect(tz.invalidateResolvedTimezone).not.toHaveBeenCalled();
    });

    it("rejects non-string non-null values (numbers, booleans)", async () => {
      const { settings } = setupMocks();
      const { POST } = loadRoute();

      const r1 = await POST(postRequest({ timezoneOverride: 7 }));
      expect(r1.status).toBe(400);
      const r2 = await POST(postRequest({ timezoneOverride: true }));
      expect(r2.status).toBe(400);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
    });

    it("does NOT invalidate the cache when only nightlyHour is updated", async () => {
      const { tz } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ nightlyHour: 5 }));
      expect(res.status).toBe(200);
      expect(tz.invalidateResolvedTimezone).not.toHaveBeenCalled();
    });
  });

  describe("body validation", () => {
    it("returns 400 for an empty object (no recognized fields)", async () => {
      const { settings } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({}));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/no recognized fields/);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid JSON", async () => {
      const { settings } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest("not valid json"));
      expect(res.status).toBe(400);
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
    });
  });

  describe("read-only mode", () => {
    it("returns 503 { error: 'read-only' } and never updates settings, reschedules, or invalidates the cache", async () => {
      process.env.DUOLINGO_READ_ONLY = "1";
      const { settings, polling, tz } = setupMocks();
      const { POST } = loadRoute();

      const r1 = await POST(postRequest({ nightlyHour: 5 }));
      const r2 = await POST(postRequest({ timezoneOverride: "Asia/Tokyo" }));
      expect(r1.status).toBe(503);
      expect(r2.status).toBe(503);
      expect(await r1.json()).toEqual({ error: "read-only" });
      expect(await r2.json()).toEqual({ error: "read-only" });
      expect(settings.updateAppSettings).not.toHaveBeenCalled();
      expect(polling.rescheduleNightly).not.toHaveBeenCalled();
      expect(tz.invalidateResolvedTimezone).not.toHaveBeenCalled();
    });
  });
});
