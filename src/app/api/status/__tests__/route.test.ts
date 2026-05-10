/**
 * Handler tests for GET /api/status.
 *
 * The status payload is the UI contract for polling/sync state, so these
 * tests keep the newer account-quiet and course-conflict fields wired through
 * without touching SQLite, timers, or a real Duolingo client.
 */

type StatusMocks = {
  getClientOrNull: jest.Mock;
  isUserPaused: jest.Mock;
  getLastSyncResult: jest.Mock;
  isPolling: jest.Mock;
  isCurrentlyRunning: jest.Mock;
  getSyncTimingStatus: jest.Mock;
  effectiveNightlyHour: jest.Mock;
  getSyncStatus: jest.Mock;
  getCurrentSync: jest.Mock;
  getMedianDurationMs: jest.Mock;
  getResolvedTimezone: jest.Mock;
  getResolvedTimezoneSource: jest.Mock;
  getAppSettings: jest.Mock;
  isReadOnlyMode: jest.Mock;
  getInstanceRole: jest.Mock;
  isExternalSyncLockConfigured: jest.Mock;
};

function setupMocks(overrides: Partial<StatusMocks> = {}): StatusMocks {
  const mocks: StatusMocks = {
    getClientOrNull: jest.fn(() => ({ __fake: true })),
    isUserPaused: jest.fn(() => false),
    getLastSyncResult: jest.fn(() => ({
      type: "full",
      changed: true,
      totalXp: 1234,
      timestamp: "2026-01-01T00:00:00.000Z",
    })),
    isPolling: jest.fn(() => true),
    isCurrentlyRunning: jest.fn(() => false),
    getSyncTimingStatus: jest.fn(() => ({
      msUntilNextXpCheck: 12_000,
      msUntilNextNightlySync: 3_600_000,
      syncMode: "course_conflict",
      fastIdleTicks: 2,
      fastIdleTicksRequired: 5,
      courseConflict: {
        active: true,
        lastObservedCourseId: "course-a",
        jitterUntilMs: 1_700_000_000_000,
        msUntilJitterRetry: 45_000,
      },
      accountQuiet: {
        active: true,
        reason: "active_course_conflict",
        lastObservedCourseId: "course-a",
        jitterUntilMs: 1_700_000_000_000,
        msUntilJitterRetry: 45_000,
      },
    })),
    effectiveNightlyHour: jest.fn(() => 23),
    getSyncStatus: jest.fn(() => ({ lastSync: "2026-01-01T00:00:00.000Z" })),
    getCurrentSync: jest.fn(() => null),
    getMedianDurationMs: jest.fn((cycleAll: boolean) => (cycleAll ? 20_000 : 5_000)),
    getResolvedTimezone: jest.fn(() => "America/Los_Angeles"),
    getResolvedTimezoneSource: jest.fn(() => "settings"),
    getAppSettings: jest.fn(() => ({ timezone_override: "America/Los_Angeles" })),
    isReadOnlyMode: jest.fn(() => false),
    getInstanceRole: jest.fn(() => "writer"),
    isExternalSyncLockConfigured: jest.fn(() => true),
    ...overrides,
  };

  jest.doMock("@/lib/server-state", () => ({
    getClientOrNull: mocks.getClientOrNull,
    isUserPaused: mocks.isUserPaused,
  }));
  jest.doMock("@/lib/polling", () => ({
    getLastSyncResult: mocks.getLastSyncResult,
    isPolling: mocks.isPolling,
    isCurrentlyRunning: mocks.isCurrentlyRunning,
    getSyncTimingStatus: mocks.getSyncTimingStatus,
    effectiveNightlyHour: mocks.effectiveNightlyHour,
  }));
  jest.doMock("@/lib/queries", () => ({
    getSyncStatus: mocks.getSyncStatus,
  }));
  jest.doMock("@/lib/sync-state", () => ({
    getCurrentSync: mocks.getCurrentSync,
  }));
  jest.doMock("@/lib/db", () => ({
    getMedianDurationMs: mocks.getMedianDurationMs,
  }));
  jest.doMock("@/lib/tz", () => ({
    getResolvedTimezone: mocks.getResolvedTimezone,
    getResolvedTimezoneSource: mocks.getResolvedTimezoneSource,
  }));
  jest.doMock("@/lib/app-settings", () => ({
    getAppSettings: mocks.getAppSettings,
  }));
  jest.doMock("@/lib/read-only", () => ({
    isReadOnlyMode: mocks.isReadOnlyMode,
  }));
  jest.doMock("@/lib/instance-role", () => ({
    getInstanceRole: mocks.getInstanceRole,
  }));
  jest.doMock("@/lib/external-sync-lock", () => ({
    isExternalSyncLockConfigured: mocks.isExternalSyncLockConfigured,
  }));

  return mocks;
}

function loadRoute() {
  return require("../route") as typeof import("../route");
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/server-state");
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/queries");
  jest.dontMock("@/lib/sync-state");
  jest.dontMock("@/lib/db");
  jest.dontMock("@/lib/tz");
  jest.dontMock("@/lib/app-settings");
  jest.dontMock("@/lib/read-only");
  jest.dontMock("@/lib/instance-role");
  jest.dontMock("@/lib/external-sync-lock");
});

describe("GET /api/status", () => {
  it("returns account-quiet and course-conflict timing state for the writer UI", async () => {
    const mocks = setupMocks();
    const { GET } = loadRoute();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      authenticated: true,
      readOnly: false,
      instanceRole: "writer",
      externalSyncLockConfigured: true,
      polling: true,
      paused: false,
      currentlyRunning: false,
      currentSync: null,
      localSyncState: { isRunning: false, currentSync: null },
      expectedDurationMs: { single: 5_000, cycle: 20_000 },
      msUntilNextXpCheck: 12_000,
      msUntilNextNightlySync: 3_600_000,
      syncMode: "course_conflict",
      fastIdleTicks: 2,
      fastIdleTicksRequired: 5,
      courseConflict: {
        active: true,
        lastObservedCourseId: "course-a",
        jitterUntilMs: 1_700_000_000_000,
        msUntilJitterRetry: 45_000,
      },
      accountQuiet: {
        active: true,
        reason: "active_course_conflict",
        lastObservedCourseId: "course-a",
        jitterUntilMs: 1_700_000_000_000,
        msUntilJitterRetry: 45_000,
      },
      nightlyHour: 23,
      resolvedTimezone: "America/Los_Angeles",
      resolvedTimezoneSource: "settings",
      timezoneOverride: "America/Los_Angeles",
    });
    expect(mocks.getMedianDurationMs).toHaveBeenCalledWith(false, 3);
    expect(mocks.getMedianDurationMs).toHaveBeenCalledWith(true, 3);
  });

  it("returns the full inactive sync-state shape in read-only mode without constructing a client", async () => {
    const mocks = setupMocks({
      isReadOnlyMode: jest.fn(() => true),
      getInstanceRole: jest.fn(() => "read-only"),
      isExternalSyncLockConfigured: jest.fn(() => false),
    });
    const { GET } = loadRoute();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      authenticated: false,
      readOnly: true,
      instanceRole: "read-only",
      externalSyncLockConfigured: false,
      polling: false,
      paused: false,
      currentlyRunning: false,
      currentSync: null,
      localSyncState: { isRunning: false, currentSync: null },
      expectedDurationMs: { single: null, cycle: null },
      lastSyncResult: null,
      msUntilNextXpCheck: null,
      msUntilNextNightlySync: null,
      syncMode: "baseline",
      fastIdleTicks: 0,
      fastIdleTicksRequired: 5,
      courseConflict: {
        active: false,
        lastObservedCourseId: null,
        jitterUntilMs: null,
        msUntilJitterRetry: null,
      },
      accountQuiet: {
        active: false,
        reason: null,
        lastObservedCourseId: null,
        jitterUntilMs: null,
        msUntilJitterRetry: null,
      },
      nightlyHour: 23,
    });
    expect(mocks.getClientOrNull).not.toHaveBeenCalled();
    expect(mocks.getMedianDurationMs).not.toHaveBeenCalled();
    expect(mocks.getSyncTimingStatus).not.toHaveBeenCalled();
    expect(mocks.getSyncStatus).toHaveBeenCalledTimes(1);
  });
});
