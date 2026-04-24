import type { DuolingoClient } from "../duolingo";
import type { DuolingoCourse, DuolingoUser } from "../types";

/**
 * Regression test for Duolingo course-selector ordering preservation.
 *
 * `client.switchCourse(id, ...)` moves the target course to the top of
 * the account's course-selector (a recency stack). The API-returned
 * `user.courses` array mirrors that selector order, so a naive forward
 * cycle leaves the selector reversed (and with non-active courses
 * outranking the previously top-ranked active one).
 *
 * The fix in `syncAllCourseDetails` visits non-active courses in
 * **reverse** of `user.courses`, then restores the original active
 * course last. Applied to a stack equal to `user.courses`, this is the
 * identity permutation: post-sync selector === pre-sync selector.
 *
 * These tests model "switch = move to front" and assert that invariant.
 */

/** Model "switch to front" semantics over an initial selector order. */
function simulateSelector(initial: string[], switchCalls: string[]): string[] {
  let stack = [...initial];
  for (const id of switchCalls) {
    stack = [id, ...stack.filter((x) => x !== id)];
  }
  return stack;
}

function course(id: string, xp: number): DuolingoCourse {
  return {
    id,
    title: `Course ${id}`,
    learningLanguage: `ll-${id}`,
    fromLanguage: `fl-${id}`,
    xp,
    crowns: 0,
    healthEnabled: false,
    preload: false,
  };
}

function makeUser(courses: Array<{ id: string; xp: number }>, activeId: string): DuolingoUser {
  return {
    id: 1,
    username: "tester",
    name: "Tester",
    picture: "",
    bio: "",
    streak: 0,
    streakData: { currentStreak: null, previousStreak: null },
    totalXp: 0,
    xpGoal: 0,
    xpGoalMetToday: false,
    weeklyXp: 0,
    monthlyXp: 0,
    gems: 0,
    lingots: 0,
    hasPlus: false,
    creationDate: 0,
    currentCourseId: activeId,
    learningLanguage: `ll-${activeId}`,
    fromLanguage: `fl-${activeId}`,
    motivation: "",
    courses: courses.map((c) => course(c.id, c.xp)),
    _achievements: [],
  };
}

type SyncModule = typeof import("../sync");

describe("syncAllCourseDetails course-selector ordering", () => {
  let mod: SyncModule;
  let switchCalls: string[];

  beforeEach(() => {
    jest.resetModules();
    switchCalls = [];

    jest.doMock("../db", () => ({
      getDb: jest.fn(() => ({
        prepare: jest.fn(() => ({ run: jest.fn(), get: jest.fn() })),
      })),
      getLastSyncXp: jest.fn(() => null),
      logSync: jest.fn(),
      upsertProfile: jest.fn(),
      insertCourseSnapshot: jest.fn(),
      upsertXpDaily: jest.fn(),
      snapshotVocab: jest.fn(),
      snapshotSkills: jest.fn(),
      upsertAchievements: jest.fn(),
      updateStreakEpochs: jest.fn(),
      backfillImpliedFreeze: jest.fn(),
    }));

    mod = require("../sync") as SyncModule;
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../db");
  });

  function makeClient(user: DuolingoUser): DuolingoClient {
    return {
      getUser: jest.fn(() => Promise.resolve(user)),
      getXpSummaries: jest.fn(() => Promise.resolve({ summaries: [] })),
      getVocabulary: jest.fn(() => Promise.resolve({ vocab_overview: [] })),
      getLegacyUser: jest.fn(() => Promise.resolve({ language_data: {} })),
      getPathSectioned: jest.fn(() => Promise.resolve([])),
      getMistakeCount: jest.fn(() => Promise.resolve(0)),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;
  }

  it("preserves user.courses ordering when active is at index 0 (the common case)", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 500 },
      { id: "C", xp: 200 },
      { id: "D", xp: 1000 },
      { id: "E", xp: 50 },
    ];
    const user = makeUser(courses, "A");
    const client = makeClient(user);

    await mod.fullSync(client, true);

    // Reverse visit of non-active (E, D, C, B), then restore A.
    expect(switchCalls).toEqual(["E", "D", "C", "B", "A"]);

    const initial = courses.map((c) => c.id);
    const finalOrder = simulateSelector(initial, switchCalls);
    expect(finalOrder).toEqual(initial);
  });

  it("lands at [active, ...rest-in-user.courses-order] when active starts mid-array", async () => {
    // Contrived case: in practice Duolingo returns the active course at
    // index 0 of `user.courses` (mirroring the app's "active on top"
    // selector). Even if it doesn't, the cycle still ends with active
    // on top and the rest in their `user.courses` relative order.
    const courses = [
      { id: "B", xp: 500 },
      { id: "C", xp: 200 },
      { id: "A", xp: 100 },
      { id: "D", xp: 1000 },
      { id: "E", xp: 50 },
    ];
    const user = makeUser(courses, "A");
    const client = makeClient(user);

    await mod.fullSync(client, true);

    // Reverse iteration skips A at index 2: E, D, C, B, then restore A.
    expect(switchCalls).toEqual(["E", "D", "C", "B", "A"]);

    const initial = courses.map((c) => c.id);
    const finalOrder = simulateSelector(initial, switchCalls);
    const nonActiveInOrder = initial.filter((id) => id !== "A");
    expect(finalOrder).toEqual(["A", ...nonActiveInOrder]);
  });

  it("makes no switchCourse calls when only one course exists", async () => {
    const user = makeUser([{ id: "A", xp: 100 }], "A");
    const client = makeClient(user);

    await mod.fullSync(client, true);

    expect(switchCalls).toHaveLength(0);
  });

  it("does not switch or restore for a non-cycle fullSync", async () => {
    const user = makeUser(
      [
        { id: "A", xp: 100 },
        { id: "B", xp: 200 },
        { id: "C", xp: 300 },
      ],
      "A",
    );
    const client = makeClient(user);

    await mod.fullSync(client, false);

    expect(switchCalls).toHaveLength(0);
  });
});
