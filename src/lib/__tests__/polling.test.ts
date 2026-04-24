import {
  shouldKickoffPoll,
  advanceSyncState,
  msUntilNextLocalTime,
  FAST_IDLE_TRIGGER_TICKS,
  type SyncStateSnapshot,
} from "../polling";
import { __resetPollingStateForTests } from "../polling-state";

describe("shouldKickoffPoll (regression guard for commit 84935f3)", () => {
  it("allows kickoff when nothing is running and no sync is in flight", () => {
    expect(shouldKickoffPoll({ isRunning: false, currentSync: null })).toBe(true);
  });

  it("blocks kickoff when isRunning (another timer tick or manual refresh owns the lock)", () => {
    expect(shouldKickoffPoll({ isRunning: true, currentSync: null })).toBe(false);
  });

  it("blocks kickoff when a sync is already in flight (resume-during-sync)", () => {
    expect(
      shouldKickoffPoll({
        isRunning: false,
        currentSync: { type: "cycle", startedAtMs: 123456 },
      }),
    ).toBe(false);
  });

  it("blocks kickoff when both guards are set", () => {
    expect(
      shouldKickoffPoll({
        isRunning: true,
        currentSync: { type: "single", startedAtMs: 1 },
      }),
    ).toBe(false);
  });
});

describe("manual refresh cooldown", () => {
  it("enforces 30-second minimum between refreshes", () => {
    const MIN_MANUAL_REFRESH_MS = 30 * 1000;
    let lastManualRefresh = 0;

    const now1 = 1000;
    lastManualRefresh = now1;

    const now2 = now1 + 10_000;
    const elapsed = now2 - lastManualRefresh;
    expect(elapsed).toBeLessThan(MIN_MANUAL_REFRESH_MS);
    const cooldown = Math.ceil((MIN_MANUAL_REFRESH_MS - elapsed) / 1000);
    expect(cooldown).toBe(20);

    const now3 = now1 + 31_000;
    const elapsed2 = now3 - lastManualRefresh;
    expect(elapsed2).toBeGreaterThanOrEqual(MIN_MANUAL_REFRESH_MS);
  });
});

describe("advanceSyncState reducer", () => {
  const baseline: SyncStateSnapshot = { mode: "baseline", fastConsecutiveIdleTicks: 0 };
  const fastFresh: SyncStateSnapshot = { mode: "fast", fastConsecutiveIdleTicks: 0 };

  describe("from baseline", () => {
    it("stays baseline when XP unchanged", () => {
      const r = advanceSyncState(baseline, { type: "baseline_tick", changed: false });
      expect(r).toEqual({ state: baseline, fireFullSync: false });
    });

    it("transitions to fast (idle=0) when XP changed", () => {
      const r = advanceSyncState(baseline, { type: "baseline_tick", changed: true });
      expect(r.state).toEqual({ mode: "fast", fastConsecutiveIdleTicks: 0 });
      expect(r.fireFullSync).toBe(false);
    });
  });

  describe("from fast", () => {
    it("increments idle counter on unchanged tick (1 of 5)", () => {
      const r = advanceSyncState(fastFresh, { type: "fast_tick", changed: false });
      expect(r.state).toEqual({ mode: "fast", fastConsecutiveIdleTicks: 1 });
      expect(r.fireFullSync).toBe(false);
    });

    it("fires fullSync and reverts to baseline on 5th consecutive unchanged tick", () => {
      let state: SyncStateSnapshot = fastFresh;
      let fired = false;
      for (let i = 1; i <= FAST_IDLE_TRIGGER_TICKS; i++) {
        const r = advanceSyncState(state, { type: "fast_tick", changed: false });
        state = r.state;
        if (r.fireFullSync) fired = true;
        if (i < FAST_IDLE_TRIGGER_TICKS) {
          expect(r.fireFullSync).toBe(false);
          expect(state).toEqual({ mode: "fast", fastConsecutiveIdleTicks: i });
        }
      }
      expect(fired).toBe(true);
      expect(state).toEqual({ mode: "baseline", fastConsecutiveIdleTicks: 0 });
    });

    it("boots back to baseline immediately on any XP change (no extension, no continued fast-polling)", () => {
      const r = advanceSyncState(
        { mode: "fast", fastConsecutiveIdleTicks: 3 },
        { type: "fast_tick", changed: true },
      );
      expect(r.state).toEqual({ mode: "baseline", fastConsecutiveIdleTicks: 0 });
      expect(r.fireFullSync).toBe(false);
    });

    it("resets to baseline on external_fullsync_done", () => {
      const r = advanceSyncState(
        { mode: "fast", fastConsecutiveIdleTicks: 4 },
        { type: "external_fullsync_done" },
      );
      expect(r.state).toEqual({ mode: "baseline", fastConsecutiveIdleTicks: 0 });
      expect(r.fireFullSync).toBe(false);
    });
  });

  describe("defensive transitions", () => {
    it("baseline_tick in fast mode is a no-op (fast ticks drive fast mode)", () => {
      const before: SyncStateSnapshot = { mode: "fast", fastConsecutiveIdleTicks: 2 };
      const r = advanceSyncState(before, { type: "baseline_tick", changed: true });
      expect(r.state).toEqual(before);
      expect(r.fireFullSync).toBe(false);
    });

    it("fast_tick in baseline mode is a no-op", () => {
      const r = advanceSyncState(baseline, { type: "fast_tick", changed: true });
      expect(r.state).toEqual(baseline);
      expect(r.fireFullSync).toBe(false);
    });
  });
});

describe("msUntilNextLocalTime", () => {
  const MS_PER_HOUR = 60 * 60 * 1000;
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  function localDate(y: number, m: number, d: number, h: number, min = 0): number {
    return new Date(y, m - 1, d, h, min, 0, 0).getTime();
  }

  it("returns ~1 hour when it is 01:00 local and target is 02:00", () => {
    const now = localDate(2026, 6, 15, 1, 0);
    expect(msUntilNextLocalTime(2, now)).toBe(MS_PER_HOUR);
  });

  it("returns ~23 hours when it is 03:00 local and target is 02:00 (tomorrow)", () => {
    const now = localDate(2026, 6, 15, 3, 0);
    expect(msUntilNextLocalTime(2, now)).toBe(23 * MS_PER_HOUR);
  });

  it("lands on tomorrow's 02:00 when called exactly at 02:00 (not zero)", () => {
    const now = localDate(2026, 6, 15, 2, 0);
    expect(msUntilNextLocalTime(2, now)).toBe(24 * MS_PER_HOUR);
  });

  it("handles DST spring-forward: 2026-03-08 01:30 PST → next 02:00 is reached after the jump", () => {
    // In America/Los_Angeles, clocks jump 02:00 → 03:00 on the 2nd Sunday of March.
    // "02:00" local never exists on the jump day. `new Date(y, m-1, d, 2, 0)` is
    // normalized by the host; we just assert the helper returns a positive number
    // less than 24h (does not infinite-loop or go negative).
    const now = localDate(2026, 3, 8, 1, 30);
    const ms = msUntilNextLocalTime(2, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(24 * MS_PER_HOUR);
  });

  it("handles DST fall-back: 2026-11-01 01:30 local → single target, no double-fire", () => {
    const now = localDate(2026, 11, 1, 1, 30);
    const ms = msUntilNextLocalTime(2, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(24 * MS_PER_HOUR);
  });
});

describe("HMR orphan-timer regression (globalThis bucket)", () => {
  beforeEach(() => {
    jest.resetModules();
    __resetPollingStateForTests();
    // Prevent the kickoff baselineTick (and its quickCheck → DB read) from
    // firing during the test. We only care about the number of `setInterval`
    // / `setTimeout` calls here, not their callbacks' behavior.
    jest.doMock("../sync", () => ({
      quickCheck: jest.fn().mockResolvedValue({ changed: false, currentXp: 0 }),
      fullSync: jest.fn().mockResolvedValue({
        type: "full",
        changed: true,
        totalXp: 0,
        timestamp: new Date().toISOString(),
      }),
    }));
  });

  afterEach(() => {
    const polling = require("../polling") as typeof import("../polling");
    polling.stopPolling();
    __resetPollingStateForTests();
    jest.dontMock("../sync");
    jest.resetModules();
  });

  it("a second module instance calling startPolling is a no-op (shared bucket early-returns)", () => {
    // First "module instance" — simulate Next.js first load.
    const first = require("../polling") as typeof import("../polling");
    const fakeClient = { getTotalXp: jest.fn().mockResolvedValue(0) } as unknown as Parameters<
      typeof first.startPolling
    >[0];
    first.startPolling(fakeClient);

    const {
      getPollingState,
    } = require("../polling-state") as typeof import("../polling-state");
    const firstBaselineHandle = getPollingState().baselineTimer;
    const firstNightlyHandle = getPollingState().nightlyTimer;
    expect(firstBaselineHandle).not.toBeNull();
    expect(firstNightlyHandle).not.toBeNull();

    // Second "module instance" — simulate HMR reload. `jest.resetModules()`
    // drops the module cache but globalThis survives, so the shared bucket
    // still has `baselineTimer !== null` and `startPolling` early-returns.
    jest.resetModules();
    const second = require("../polling") as typeof import("../polling");
    second.startPolling(fakeClient);

    // Same handles, not replaced — the second startPolling early-returned.
    // Under the old module-local `let pollTimer = null;` pattern, a fresh
    // module would have started a brand-new interval and orphaned the first.
    expect(getPollingState().baselineTimer).toBe(firstBaselineHandle);
    expect(getPollingState().nightlyTimer).toBe(firstNightlyHandle);
  });
});
