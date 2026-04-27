/**
 * Handler tests for GET /api/data — validates query-string → `queries.ts`
 * dispatch only (no DB). Charts consume this JSON shape; pairing tests here
 * catches routing regressions separate from unit tests inside `queries.ts`.
 */

import { NextRequest } from "next/server";

function mockQueries() {
  const getCourseXpHistory = jest.fn(() => []);
  const getCourseXpDailyHistory = jest.fn(() => []);
  return {
    getProfile: jest.fn(() => null),
    getCourseLatest: jest.fn(() => []),
    getCourseHistory: jest.fn(() => []),
    getCourseComparison: jest.fn(() => []),
    getCourseXpHistory,
    getCourseXpDailyHistory,
    getXpDaily: jest.fn(() => []),
    getXpStats: jest.fn(() => ({})),
    getVocabLatest: jest.fn(() => []),
    getVocabDecay: jest.fn(() => []),
    getVocabHistory: jest.fn(() => []),
    getSkillsLatest: jest.fn(() => []),
    getSkillDecay: jest.fn(() => []),
    getSkillHistory: jest.fn(() => []),
    getAchievements: jest.fn(() => []),
    getStreakEpochs: jest.fn(() => []),
  };
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.dontMock("@/lib/queries");
  jest.dontMock("@/lib/server-state");
});

describe("GET /api/data", () => {
  const originalReadOnly = process.env.DUOLINGO_READ_ONLY;
  afterEach(() => {
    if (originalReadOnly === undefined) {
      delete process.env.DUOLINGO_READ_ONLY;
    } else {
      process.env.DUOLINGO_READ_ONLY = originalReadOnly;
    }
  });

  it("returns 401 when not in DEMO_MODE and JWT client is absent", async () => {
    delete process.env.DUOLINGO_READ_ONLY;
    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => null),
    }));
    jest.doMock("@/lib/queries", () => mockQueries());

    const { GET } = require("../route") as typeof import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/data?q=course-xp-history&days=7"),
    );

    expect(res.status).toBe(401);
  });

  it("bypasses the auth gate in read-only mode (serves DB-backed data without a client)", async () => {
    process.env.DUOLINGO_READ_ONLY = "1";
    const mocks = mockQueries();
    mocks.getCourseXpHistory.mockReturnValue([
      { date: "2026-04-26", _prior: 0, _pretrack: 0, _total: 100, X: 100 },
    ]);
    const getClientOrNull = jest.fn(() => null);
    jest.doMock("@/lib/server-state", () => ({ getClientOrNull }));
    jest.doMock("@/lib/queries", () => mocks);

    const { GET } = require("../route") as typeof import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/data?q=course-xp-history&days=7"),
    );

    expect(res.status).toBe(200);
    // Read-only path doesn't even consult getClientOrNull — no JWT involved.
    expect(getClientOrNull).not.toHaveBeenCalled();
    expect(mocks.getCourseXpHistory).toHaveBeenCalledWith(7, "delta");
  });

  it("course-xp-history: forwards days=N as delta stack", async () => {
    const mocks = mockQueries();
    mocks.getCourseXpHistory.mockReturnValue([
      {
        date: "2026-04-26",
        _prior: 100,
        _pretrack: 0,
        _total: 500,
        X: 400,
      },
    ]);

    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => ({ __fake: true })),
    }));
    jest.doMock("@/lib/queries", () => mocks);

    const { GET } = require("../route") as typeof import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/data?q=course-xp-history&days=7"),
    );

    expect(res.status).toBe(200);
    expect(mocks.getCourseXpHistory).toHaveBeenCalledWith(7, "delta");
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ date: "2026-04-26", _total: 500 });
  });

  it("course-xp-history: days=all requests delta all-time span", async () => {
    const mocks = mockQueries();

    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => ({ __fake: true })),
    }));
    jest.doMock("@/lib/queries", () => mocks);

    const { GET } = require("../route") as typeof import("../route");
    await GET(new NextRequest("http://localhost/api/data?q=course-xp-history&days=all"));

    expect(mocks.getCourseXpHistory).toHaveBeenCalledWith(undefined, "delta");
  });

  it("course-xp-history: invalid days returns 400", async () => {
    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => ({ __fake: true })),
    }));
    jest.doMock("@/lib/queries", () => mockQueries());

    const { GET } = require("../route") as typeof import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/data?q=course-xp-history&days=0"),
    );

    expect(res.status).toBe(400);
  });

  it("course-xp-daily-history: forwards parsed days when present", async () => {
    const mocks = mockQueries();
    mocks.getCourseXpDailyHistory.mockReturnValue([{ date: "2026-04-26", _total: 50, _untracked: 0 }]);

    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => ({ __fake: true })),
    }));
    jest.doMock("@/lib/queries", () => mocks);

    const { GET } = require("../route") as typeof import("../route");
    const res = await GET(
      new NextRequest("http://localhost/api/data?q=course-xp-daily-history&days=30"),
    );

    expect(res.status).toBe(200);
    expect(mocks.getCourseXpDailyHistory).toHaveBeenCalledWith(30);
    const json = await res.json();
    expect(json[0]).toMatchObject({ date: "2026-04-26", _total: 50 });
  });

  it("course-xp-daily-history: omit days → full span", async () => {
    const mocks = mockQueries();

    jest.doMock("@/lib/server-state", () => ({
      getClientOrNull: jest.fn(() => ({ __fake: true })),
    }));
    jest.doMock("@/lib/queries", () => mocks);

    const { GET } = require("../route") as typeof import("../route");
    await GET(new NextRequest("http://localhost/api/data?q=course-xp-daily-history"));

    expect(mocks.getCourseXpDailyHistory).toHaveBeenCalledWith(undefined);
  });
});
