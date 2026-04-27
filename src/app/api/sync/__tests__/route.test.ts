/**
 * Handler tests for POST /api/sync — main goal is the read-only guard
 * (returns 503 without touching `ensureClient`/`fullSync`/`manualRefresh`).
 *
 * Next.js App Router handlers are plain async functions over Request /
 * Response, so we mock the underlying modules and call POST() directly.
 */

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
    manualRefresh: jest.fn(async () => ({ ok: true, type: "quick" })),
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
      expect(body).toEqual({ ok: true, type: "quick" });
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
  });
});
