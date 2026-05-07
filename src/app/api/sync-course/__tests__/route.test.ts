/**
 * Handler tests for POST /api/sync-course — main goal is the read-only
 * guard (503 without touching the writer path).
 */

import { __resetPollingStateForTests, getPollingState } from "@/lib/polling-state";
import { clearCurrentSync } from "@/lib/sync-state";

const originalReadOnly = process.env.DUOLINGO_READ_ONLY;

type Mocks = {
  ensureClient: jest.Mock;
  syncCourseDetails: jest.Mock;
};

function setupMocks(): Mocks {
  const mocks: Mocks = {
    ensureClient: jest.fn(() => ({ __fake: true })),
    syncCourseDetails: jest.fn(async () => ({ ok: true })),
  };
  jest.doMock("@/lib/server-state", () => ({ ensureClient: mocks.ensureClient }));
  jest.doMock("@/lib/sync", () => ({ syncCourseDetails: mocks.syncCourseDetails }));
  return mocks;
}

function loadRoute() {
  return require("../route") as typeof import("../route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync-course", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/server-state");
  jest.dontMock("@/lib/sync");
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
  jest.dontMock("@/lib/sync-lock");
  jest.dontMock("@/lib/external-sync-lock");
  __resetPollingStateForTests();
  clearCurrentSync();
});

describe("POST /api/sync-course", () => {
  it("returns 503 in read-only mode without touching the writer path", async () => {
    process.env.DUOLINGO_READ_ONLY = "1";
    const mocks = setupMocks();
    const { POST } = loadRoute();

    const res = await POST(
      postRequest({ courseId: "X", learningLanguage: "es", fromLanguage: "en" }),
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "read-only" });
    expect(mocks.ensureClient).not.toHaveBeenCalled();
    expect(mocks.syncCourseDetails).not.toHaveBeenCalled();
  });

  it("returns 400 when required params are missing (normal mode)", async () => {
    delete process.env.DUOLINGO_READ_ONLY;
    const mocks = setupMocks();
    const { POST } = loadRoute();

    const res = await POST(postRequest({ courseId: "X" }));

    expect(res.status).toBe(400);
    expect(mocks.syncCourseDetails).not.toHaveBeenCalled();
  });

  it("returns skipped/error shape when another sync is running", async () => {
    delete process.env.DUOLINGO_READ_ONLY;
    const mocks = setupMocks();
    getPollingState().isRunning = true;
    const { POST } = loadRoute();

    const res = await POST(
      postRequest({ courseId: "X", learningLanguage: "es", fromLanguage: "en" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: false,
      switchedBack: true,
      error: "Sync already running",
      details: ["Sync already running"],
    });
    expect(mocks.ensureClient).toHaveBeenCalledTimes(1);
    expect(mocks.syncCourseDetails).not.toHaveBeenCalled();
  });

  it("returns skipped/error shape when the external account lock is busy", async () => {
    delete process.env.DUOLINGO_READ_ONLY;
    const mocks = setupMocks();
    jest.doMock("@/lib/external-sync-lock", () => ({
      tryAcquireExternalSyncLock: jest.fn(async () => ({
        acquired: false,
        reason: "Sync already running",
      })),
    }));
    const { POST } = loadRoute();

    const res = await POST(
      postRequest({ courseId: "X", learningLanguage: "es", fromLanguage: "en" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: false,
      switchedBack: true,
      error: "Sync already running",
      details: ["Sync already running"],
    });
    expect(getPollingState().isRunning).toBe(false);
    expect(mocks.syncCourseDetails).not.toHaveBeenCalled();
  });
});
