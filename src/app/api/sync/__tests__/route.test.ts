/**
 * Handler tests for POST /api/sync — main goal is the read-only guard
 * (returns 503 without touching `ensureClient`/`fullSync`/`manualRefresh`).
 *
 * Next.js App Router handlers are plain async functions over Request /
 * Response, so we mock the underlying modules and call POST() directly.
 */

import { __resetPollingStateForTests, getPollingState } from "@/lib/polling-state";
import { clearCurrentSync } from "@/lib/sync-state";

const originalReadOnly = process.env.DUOLINGO_READ_ONLY;

type SyncMocks = {
  ensureClient: jest.Mock;
  fullSync: jest.Mock;
  manualRefresh: jest.Mock;
  notifyAllCourseSyncComplete: jest.Mock;
};

function setupMocks(): SyncMocks {
  const mocks: SyncMocks = {
    ensureClient: jest.fn(() => ({ __fake: true })),
    fullSync: jest.fn(async () => ({ ok: true, type: "full" })),
    manualRefresh: jest.fn(async () => ({ ok: true, type: "full" })),
    notifyAllCourseSyncComplete: jest.fn(),
  };

  jest.doMock("@/lib/server-state", () => ({
    ensureClient: mocks.ensureClient,
  }));
  jest.doMock("@/lib/sync", () => ({
    fullSync: mocks.fullSync,
  }));
  jest.doMock("@/lib/polling", () => ({
    manualRefresh: mocks.manualRefresh,
    notifyAllCourseSyncComplete: mocks.notifyAllCourseSyncComplete,
  }));

  return mocks;
}

function loadRoute() {
  return require("../route") as typeof import("../route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/server-state");
  jest.dontMock("@/lib/sync");
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/sync-lock");
  jest.dontMock("@/lib/external-sync-lock");
  __resetPollingStateForTests();
  clearCurrentSync();
});

afterEach(() => {
  if (originalReadOnly === undefined) {
    delete process.env.DUOLINGO_READ_ONLY;
  } else {
    process.env.DUOLINGO_READ_ONLY = originalReadOnly;
  }
  jest.resetModules();
  jest.dontMock("@/lib/server-state");
  jest.dontMock("@/lib/sync");
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/sync-lock");
  jest.dontMock("@/lib/external-sync-lock");
  __resetPollingStateForTests();
  clearCurrentSync();
});

describe("POST /api/sync", () => {
  describe("read-only mode", () => {
    it.each([["1"], ["true"], ["yes"]])(
      "returns 503 { error: 'read-only' } when DUOLINGO_READ_ONLY=%s and never touches the writer path",
      async (flag) => {
        process.env.DUOLINGO_READ_ONLY = flag;
        const mocks = setupMocks();
        const { POST } = loadRoute();

        const res = await POST(postRequest({ force: true, cycleAll: true }));
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body).toEqual({ error: "read-only" });
        expect(mocks.ensureClient).not.toHaveBeenCalled();
        expect(mocks.fullSync).not.toHaveBeenCalled();
        expect(mocks.manualRefresh).not.toHaveBeenCalled();
        expect(mocks.notifyAllCourseSyncComplete).not.toHaveBeenCalled();
      },
    );
  });

  describe("normal mode", () => {
    beforeEach(() => {
      delete process.env.DUOLINGO_READ_ONLY;
    });

    it("calls manualRefresh when force is not set", async () => {
      const mocks = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({}));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, type: "full" });
      expect(mocks.ensureClient).toHaveBeenCalledTimes(1);
      expect(mocks.manualRefresh).toHaveBeenCalledTimes(1);
      expect(mocks.fullSync).not.toHaveBeenCalled();
      expect(mocks.notifyAllCourseSyncComplete).toHaveBeenCalledTimes(1);
    });

    it("calls fullSync(client, cycleAll) when force=true", async () => {
      const mocks = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ force: true, cycleAll: true }));

      expect(res.status).toBe(200);
      expect(mocks.fullSync).toHaveBeenCalledTimes(1);
      expect(mocks.fullSync.mock.calls[0][1]).toBe(true);
      expect(mocks.manualRefresh).not.toHaveBeenCalled();
    });

    it("returns a skipped response for force=true when another sync is running", async () => {
      const mocks = setupMocks();
      getPollingState().isRunning = true;
      const { POST } = loadRoute();

      const res = await POST(postRequest({ force: true, cycleAll: true }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        type: "skipped",
        changed: false,
        totalXp: 0,
        error: "Sync already running",
      });
      expect(mocks.ensureClient).toHaveBeenCalledTimes(1);
      expect(mocks.fullSync).not.toHaveBeenCalled();
      expect(mocks.notifyAllCourseSyncComplete).not.toHaveBeenCalled();
    });

    it("returns skipped for force=true when the external account lock is busy", async () => {
      const mocks = setupMocks();
      jest.doMock("@/lib/external-sync-lock", () => ({
        tryAcquireExternalSyncLock: jest.fn(async () => ({
          acquired: false,
          reason: "Sync already running",
        })),
      }));
      const { POST } = loadRoute();

      const res = await POST(postRequest({ force: true, cycleAll: true }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        type: "skipped",
        changed: false,
        totalXp: 0,
        error: "Sync already running",
      });
      expect(getPollingState().isRunning).toBe(false);
      expect(mocks.fullSync).not.toHaveBeenCalled();
    });

    it("returns active-course conflict results from forced sync without completion notification", async () => {
      const mocks = setupMocks();
      mocks.fullSync.mockResolvedValueOnce({
        type: "skipped",
        changed: false,
        totalXp: 100,
        error: "Active course changed outside this sync",
        warnings: ["Active course changed outside this sync after switching to B: expected B, saw C"],
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      const { POST } = loadRoute();

      const res = await POST(postRequest({ force: true, cycleAll: true }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        type: "skipped",
        changed: false,
        error: "Active course changed outside this sync",
      });
      expect(mocks.fullSync).toHaveBeenCalledWith(expect.anything(), true);
      expect(mocks.notifyAllCourseSyncComplete).not.toHaveBeenCalled();
    });

    it("does not send a completion notification when manualRefresh skips", async () => {
      const mocks = setupMocks();
      mocks.manualRefresh.mockResolvedValueOnce({
        type: "skipped",
        changed: false,
        totalXp: 123,
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      const { POST } = loadRoute();

      const res = await POST(postRequest({}));

      expect(res.status).toBe(200);
      expect(mocks.manualRefresh).toHaveBeenCalledTimes(1);
      expect(mocks.notifyAllCourseSyncComplete).not.toHaveBeenCalled();
    });
  });
});
