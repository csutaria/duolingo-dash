import { __resetPollingStateForTests, getPollingState } from "../polling-state";
import { clearCurrentSync, setCurrentSync } from "../sync-state";
import type { DuolingoClient } from "../duolingo";
import {
  SYNC_ALREADY_RUNNING,
  tryAcquireAccountSyncGate,
  tryAcquireSyncGate,
  withSyncGate,
} from "../sync-lock";
import { __setRedisLockClientFactoryForTests, type RedisLockClient } from "../external-sync-lock";

const originalRedisUrl = process.env.DUOLINGO_SYNC_LOCK_REDIS_URL;

describe("sync single-flight gate", () => {
  beforeEach(() => {
    __resetPollingStateForTests();
    clearCurrentSync();
  });

  afterEach(() => {
    __setRedisLockClientFactoryForTests(null);
    if (originalRedisUrl === undefined) delete process.env.DUOLINGO_SYNC_LOCK_REDIS_URL;
    else process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = originalRedisUrl;
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

  it("account gate releases the local gate when the external lock is busy", async () => {
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379";
    const redis: RedisLockClient = {
      setNxPx: jest.fn(async () => false),
      heartbeat: jest.fn(async () => true),
      release: jest.fn(async () => true),
    };
    __setRedisLockClientFactoryForTests(() => redis);
    const client = { getUserId: () => 123 } as unknown as DuolingoClient;

    const gate = await tryAcquireAccountSyncGate(client);

    expect(gate).toEqual({ acquired: false, reason: SYNC_ALREADY_RUNNING });
    expect(getPollingState().isRunning).toBe(false);
    expect(redis.release).not.toHaveBeenCalled();
  });

  it("account gate releases local and external gates after acquire", async () => {
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379";
    const redis: RedisLockClient = {
      setNxPx: jest.fn(async () => true),
      heartbeat: jest.fn(async () => true),
      release: jest.fn(async () => true),
    };
    __setRedisLockClientFactoryForTests(() => redis);
    const client = { getUserId: () => 123 } as unknown as DuolingoClient;

    const gate = await tryAcquireAccountSyncGate(client);

    expect(gate.acquired).toBe(true);
    expect(getPollingState().isRunning).toBe(true);
    if (gate.acquired) await gate.release();
    expect(redis.release).toHaveBeenCalledTimes(1);
    expect(getPollingState().isRunning).toBe(false);
  });

  it("account gate fails closed and releases the local gate when external acquire throws", async () => {
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379";
    const redis: RedisLockClient = {
      setNxPx: jest.fn(async () => {
        throw new Error("offline");
      }),
      heartbeat: jest.fn(async () => true),
      release: jest.fn(async () => true),
    };
    __setRedisLockClientFactoryForTests(() => redis);
    const client = { getUserId: () => 123 } as unknown as DuolingoClient;

    const gate = await tryAcquireAccountSyncGate(client);

    expect(gate.acquired).toBe(false);
    expect(getPollingState().isRunning).toBe(false);
    expect(redis.release).not.toHaveBeenCalled();
  });
});
