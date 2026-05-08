import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import type { DuolingoClient } from "./duolingo";

export const SYNC_LOCK_UNAVAILABLE = "Sync lock unavailable";

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;
const MIN_LOCK_TTL_MS = 5 * 1000;
const CONNECT_TIMEOUT_MS = 5 * 1000;

const HEARTBEAT_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type ExternalSyncLockBusy = {
  acquired: false;
  reason: string;
};

export type ExternalSyncLockAcquired = {
  acquired: true;
  release: () => Promise<void>;
};

export type ExternalSyncLock = ExternalSyncLockBusy | ExternalSyncLockAcquired;

export type RedisLockClient = {
  setNxPx: (key: string, token: string, ttlMs: number) => Promise<boolean>;
  heartbeat: (key: string, token: string, ttlMs: number) => Promise<boolean>;
  release: (key: string, token: string) => Promise<boolean>;
};

type RedisLockClientFactory = (url: string) => RedisLockClient;

let redisLockClientFactory: RedisLockClientFactory = (url) => new RespRedisLockClient(url);

export function __setRedisLockClientFactoryForTests(factory: RedisLockClientFactory | null): void {
  redisLockClientFactory = factory ?? ((url) => new RespRedisLockClient(url));
}

export function isExternalSyncLockConfigured(): boolean {
  return getRedisUrl() !== null;
}

export async function tryAcquireExternalSyncLock(client: DuolingoClient): Promise<ExternalSyncLock> {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return { acquired: true, release: async () => {} };
  }

  const key = syncLockKey(client);
  const token = randomUUID();
  const ttlMs = getLockTtlMs();
  const redis = redisLockClientFactory(redisUrl);

  let acquired: boolean;
  try {
    acquired = await redis.setNxPx(key, token, ttlMs);
  } catch {
    return { acquired: false, reason: SYNC_LOCK_UNAVAILABLE };
  }

  if (!acquired) {
    return { acquired: false, reason: "Sync already running" };
  }

  const heartbeatMs = Math.max(1000, Math.floor(ttlMs / 3));
  const heartbeat = setInterval(() => {
    void redis.heartbeat(key, token, ttlMs).catch(() => {
      // The TTL still fails closed for new contenders. Keep the current sync
      // moving and let release best-effort clean up if connectivity returns.
    });
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    acquired: true,
    release: async () => {
      clearInterval(heartbeat);
      try {
        await redis.release(key, token);
      } catch {
        // Do not mask the sync result because cleanup lost the Redis connection.
      }
    },
  };
}

function getRedisUrl(): string | null {
  const value = process.env.DUOLINGO_SYNC_LOCK_REDIS_URL?.trim();
  return value ? value : null;
}

function getLockTtlMs(): number {
  const raw = process.env.DUOLINGO_SYNC_LOCK_TTL_MS;
  const parsed = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_LOCK_TTL_MS) return DEFAULT_LOCK_TTL_MS;
  return Math.floor(parsed);
}

function syncLockKey(client: DuolingoClient): string {
  const namespace = process.env.DUOLINGO_SYNC_LOCK_NAMESPACE?.trim()
    || `user:${client.getUserId()}`;
  return `duolingo-dash:sync:${namespace}`;
}

class RespRedisLockClient implements RedisLockClient {
  constructor(private readonly url: string) {}

  async setNxPx(key: string, token: string, ttlMs: number): Promise<boolean> {
    const reply = await this.command(["SET", key, token, "NX", "PX", String(ttlMs)]);
    return reply === "OK";
  }

  async heartbeat(key: string, token: string, ttlMs: number): Promise<boolean> {
    const reply = await this.command(["EVAL", HEARTBEAT_SCRIPT, "1", key, token, String(ttlMs)]);
    return reply === 1;
  }

  async release(key: string, token: string): Promise<boolean> {
    const reply = await this.command(["EVAL", RELEASE_SCRIPT, "1", key, token]);
    return reply === 1;
  }

  private async command(args: string[]): Promise<RespValue> {
    const url = new URL(this.url);
    const connection = await RespConnection.connect(url);
    try {
      if (url.username || url.password) {
        if (url.username) {
          await connection.command(["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)]);
        } else {
          await connection.command(["AUTH", decodeURIComponent(url.password)]);
        }
      }
      const db = url.pathname.replace("/", "");
      if (db) {
        await connection.command(["SELECT", db]);
      }
      return await connection.command(args);
    } finally {
      connection.close();
    }
  }
}

type RespValue = string | number | null | RespValue[];

class RespConnection {
  private buffer = Buffer.alloc(0);
  private pending: {
    resolve: (value: RespValue) => void;
    reject: (err: Error) => void;
  } | null = null;

  private constructor(private readonly socket: net.Socket | tls.TLSSocket) {
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("error", (err) => {
      if (this.pending) {
        this.pending.reject(err);
        this.pending = null;
      }
    });
  }

  static connect(url: URL): Promise<RespConnection> {
    return new Promise((resolve, reject) => {
      const secure = url.protocol === "rediss:";
      const port = Number(url.port || (secure ? 6380 : 6379));
      const options = { host: url.hostname, port };
      const socket = secure ? tls.connect(options) : net.connect(options);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Redis connection timed out"));
      }, CONNECT_TIMEOUT_MS);
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      socket.once("connect", () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve(new RespConnection(socket));
      });
      socket.once("error", onError);
    });
  }

  command(args: string[]): Promise<RespValue> {
    if (this.pending) throw new Error("Redis command already pending");
    this.socket.write(encodeCommand(args));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.drain();
    });
  }

  close(): void {
    this.socket.end();
  }

  private drain(): void {
    if (!this.pending || this.buffer.length === 0) return;
    let parsed: { value: RespValue; next: number } | null;
    try {
      parsed = parseResp(this.buffer, 0);
    } catch (err) {
      const pending = this.pending;
      this.pending = null;
      pending.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!parsed) return;
    this.buffer = this.buffer.subarray(parsed.next);
    const pending = this.pending;
    this.pending = null;
    pending.resolve(parsed.value);
  }
}

function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    out += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
  }
  return out;
}

function parseResp(buffer: Buffer, offset: number): { value: RespValue; next: number } | null {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) return null;
  const line = buffer.subarray(offset + 1, lineEnd).toString("utf8");
  const dataStart = lineEnd + 2;

  if (prefix === "+") return { value: line, next: dataStart };
  if (prefix === ":") return { value: Number(line), next: dataStart };
  if (prefix === "-") throw new Error(line);
  if (prefix === "_") return { value: null, next: dataStart };

  if (prefix === "$") {
    const length = Number(line);
    if (length === -1) return { value: null, next: dataStart };
    const dataEnd = dataStart + length;
    if (buffer.length < dataEnd + 2) return null;
    return {
      value: buffer.subarray(dataStart, dataEnd).toString("utf8"),
      next: dataEnd + 2,
    };
  }

  if (prefix === "*") {
    const count = Number(line);
    if (count === -1) return { value: null, next: dataStart };
    const values: RespValue[] = [];
    let next = dataStart;
    for (let i = 0; i < count; i++) {
      const parsed = parseResp(buffer, next);
      if (!parsed) return null;
      values.push(parsed.value);
      next = parsed.next;
    }
    return { value: values, next };
  }

  throw new Error(`Unsupported Redis RESP prefix: ${prefix}`);
}
