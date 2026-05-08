import type { DuolingoClient } from "../duolingo";
import {
  __setRedisLockClientFactoryForTests,
  isExternalSyncLockConfigured,
  SYNC_LOCK_UNAVAILABLE,
  tryAcquireExternalSyncLock,
  type RedisLockClient,
} from "../external-sync-lock";

const originalUrl = process.env.DUOLINGO_SYNC_LOCK_REDIS_URL;
const originalNamespace = process.env.DUOLINGO_SYNC_LOCK_NAMESPACE;
const originalTtl = process.env.DUOLINGO_SYNC_LOCK_TTL_MS;

const client = { getUserId: () => 123 } as unknown as DuolingoClient;

afterEach(() => {
  __setRedisLockClientFactoryForTests(null);
  jest.useRealTimers();

  if (originalUrl === undefined) delete process.env.DUOLINGO_SYNC_LOCK_REDIS_URL;
  else process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = originalUrl;

  if (originalNamespace === undefined) delete process.env.DUOLINGO_SYNC_LOCK_NAMESPACE;
  else process.env.DUOLINGO_SYNC_LOCK_NAMESPACE = originalNamespace;

  if (originalTtl === undefined) delete process.env.DUOLINGO_SYNC_LOCK_TTL_MS;
  else process.env.DUOLINGO_SYNC_LOCK_TTL_MS = originalTtl;
});

function mockRedis(overrides: Partial<RedisLockClient> = {}): RedisLockClient {
  return {
    setNxPx: jest.fn(async () => true),
    heartbeat: jest.fn(async () => true),
    release: jest.fn(async () => true),
    ...overrides,
  };
}

describe("external Redis sync lock", () => {
  it("is disabled unless DUOLINGO_SYNC_LOCK_REDIS_URL is set", async () => {
    delete process.env.DUOLINGO_SYNC_LOCK_REDIS_URL;

    expect(isExternalSyncLockConfigured()).toBe(false);
    const lock = await tryAcquireExternalSyncLock(client);

    expect(lock.acquired).toBe(true);
    if (lock.acquired) await lock.release();
  });

  it("acquires with SET NX PX, heartbeats, and releases by owner token", async () => {
    jest.useFakeTimers();
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379/2";
    process.env.DUOLINGO_SYNC_LOCK_NAMESPACE = "test-account";
    process.env.DUOLINGO_SYNC_LOCK_TTL_MS = "6000";
    const redis = mockRedis();
    __setRedisLockClientFactoryForTests(() => redis);

    const lock = await tryAcquireExternalSyncLock(client);

    expect(lock.acquired).toBe(true);
    expect(redis.setNxPx).toHaveBeenCalledTimes(1);
    expect(redis.setNxPx).toHaveBeenCalledWith(
      "duolingo-dash:sync:test-account",
      expect.any(String),
      6000,
    );

    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(redis.heartbeat).toHaveBeenCalledTimes(1);

    if (lock.acquired) await lock.release();
    expect(redis.release).toHaveBeenCalledTimes(1);
  });

  it("returns busy when another owner holds the lock", async () => {
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379";
    __setRedisLockClientFactoryForTests(() => mockRedis({ setNxPx: jest.fn(async () => false) }));

    await expect(tryAcquireExternalSyncLock(client)).resolves.toEqual({
      acquired: false,
      reason: "Sync already running",
    });
  });

  it("fails closed when configured Redis is unavailable", async () => {
    process.env.DUOLINGO_SYNC_LOCK_REDIS_URL = "redis://localhost:6379";
    __setRedisLockClientFactoryForTests(() => mockRedis({
      setNxPx: jest.fn(async () => {
        throw new Error("offline");
      }),
    }));

    await expect(tryAcquireExternalSyncLock(client)).resolves.toEqual({
      acquired: false,
      reason: SYNC_LOCK_UNAVAILABLE,
    });
  });
});
