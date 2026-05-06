import { __resetPollingStateForTests, getPollingState } from "../polling-state";
import { clearCurrentSync, setCurrentSync } from "../sync-state";
import { SYNC_ALREADY_RUNNING, tryAcquireSyncGate, withSyncGate } from "../sync-lock";

describe("sync single-flight gate", () => {
  beforeEach(() => {
    __resetPollingStateForTests();
    clearCurrentSync();
  });

  afterEach(() => {
    __resetPollingStateForTests();
    clearCurrentSync();
  });

  it("acquires when no sync is running", () => {
    const gate = tryAcquireSyncGate();

    expect(gate.acquired).toBe(true);
    expect(getPollingState().isRunning).toBe(true);

    if (gate.acquired) gate.release();
    expect(getPollingState().isRunning).toBe(false);
  });

  it("rejects while state.isRunning is already true", () => {
    getPollingState().isRunning = true;

    expect(tryAcquireSyncGate()).toEqual({
      acquired: false,
      reason: SYNC_ALREADY_RUNNING,
    });
  });

  it("rejects while currentSync is already published", () => {
    setCurrentSync("cycle");

    expect(tryAcquireSyncGate()).toEqual({
      acquired: false,
      reason: SYNC_ALREADY_RUNNING,
    });
    expect(getPollingState().isRunning).toBe(false);
  });

  it("withSyncGate clears the gate after success", async () => {
    const result = await withSyncGate(async () => "ok");

    expect(result).toBe("ok");
    expect(getPollingState().isRunning).toBe(false);
  });

  it("withSyncGate clears the gate after throw", async () => {
    await expect(
      withSyncGate(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(getPollingState().isRunning).toBe(false);
  });
});
