import type { DuolingoClient } from "../duolingo";

/**
 * Regression test: fullSync must clear currentSync even when it throws.
 *
 * The risk we're pinning: someone refactors fullSync and moves
 * `setCurrentSync` out of the try block, removes the `finally { clearCurrentSync() }`,
 * or wraps the return path in a way that skips the finally. This test fires
 * if any of those happens.
 *
 * Scope note: we only exercise the error path. The success path would
 * require a full DuolingoUser fixture + stubbed DB writers + stubbed
 * client pagination/legacy calls — mostly rediscovering fixture work
 * planned for the path-based skill progress tests. JS guarantees `finally`
 * runs on normal return; breaking that structurally also breaks this test.
 */

describe("fullSync instrumentation (error path)", () => {
  let mod: typeof import("../sync");
  let syncState: typeof import("../sync-state");
  let logSync: jest.Mock;

  beforeEach(() => {
    jest.resetModules();

    logSync = jest.fn();
    jest.doMock("../db", () => ({
      logSync,
      // Stub the other db helpers in case anything imports them at module
      // load time. The error path throws before any of these are called.
      getDb: jest.fn(),
      getLastSyncXp: jest.fn(() => null),
      upsertProfile: jest.fn(),
      insertCourseSnapshot: jest.fn(),
      upsertXpDaily: jest.fn(),
      snapshotVocab: jest.fn(),
      snapshotSkills: jest.fn(),
      upsertAchievements: jest.fn(),
    }));

    mod = require("../sync") as typeof import("../sync");
    syncState = require("../sync-state") as typeof import("../sync-state");
    syncState.clearCurrentSync();
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../db");
  });

  function throwingClient(error: Error): DuolingoClient {
    return {
      getUser: jest.fn(() => Promise.reject(error)),
    } as unknown as DuolingoClient;
  }

  it("sets currentSync.type=single for a non-cycle call, then clears on error", async () => {
    const client = throwingClient(new Error("boom"));

    // Peek at currentSync right after fullSync starts but before it throws.
    // We do this by wrapping getUser — by the time it's called, setCurrentSync
    // has already run.
    let typeDuringCall: string | undefined;
    (client.getUser as jest.Mock).mockImplementation(() => {
      typeDuringCall = syncState.getCurrentSync()?.type;
      return Promise.reject(new Error("boom"));
    });

    const result = await mod.fullSync(client, false);

    expect(typeDuringCall).toBe("single");
    expect(result.error).toBe("boom");
    expect(result.type).toBe("full");
    expect(syncState.getCurrentSync()).toBeNull();
  });

  it("sets currentSync.type=cycle for a cycle-all call, then clears on error", async () => {
    const client = throwingClient(new Error("nope"));

    let typeDuringCall: string | undefined;
    (client.getUser as jest.Mock).mockImplementation(() => {
      typeDuringCall = syncState.getCurrentSync()?.type;
      return Promise.reject(new Error("nope"));
    });

    await mod.fullSync(client, true);

    expect(typeDuringCall).toBe("cycle");
    expect(syncState.getCurrentSync()).toBeNull();
  });

  it("still logs the failed sync with duration and cycleAll metadata", async () => {
    const client = throwingClient(new Error("kaboom"));

    await mod.fullSync(client, true);

    expect(logSync).toHaveBeenCalledTimes(1);
    const args = logSync.mock.calls[0][0];
    expect(args.syncType).toBe("full");
    expect(args.success).toBe(false);
    expect(args.errorMessage).toBe("kaboom");
    expect(args.cycleAll).toBe(true);
    expect(typeof args.durationMs).toBe("number");
    expect(args.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("clears currentSync even when a non-Error is thrown", async () => {
    const client = {
      getUser: jest.fn(() => Promise.reject("string rejection")),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, false);

    expect(result.error).toBe("string rejection");
    expect(syncState.getCurrentSync()).toBeNull();
  });
});
