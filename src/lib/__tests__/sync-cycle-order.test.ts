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
  let dbMocks: {
    prepareRun: jest.Mock;
    snapshotVocab: jest.Mock;
    snapshotSkills: jest.Mock;
  };

  beforeEach(() => {
    jest.resetModules();
    switchCalls = [];
    dbMocks = {
      prepareRun: jest.fn(),
      snapshotVocab: jest.fn(),
      snapshotSkills: jest.fn(),
    };

    jest.doMock("../db", () => ({
      getDb: jest.fn(() => ({
        prepare: jest.fn(() => ({ run: dbMocks.prepareRun, get: jest.fn() })),
      })),
      getLastSyncXp: jest.fn(() => null),
      logSync: jest.fn(),
      upsertProfile: jest.fn(),
      insertCourseSnapshot: jest.fn(),
      upsertXpDaily: jest.fn(),
      snapshotVocab: dbMocks.snapshotVocab,
      snapshotSkills: dbMocks.snapshotSkills,
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
    let activeId = user.currentCourseId;
    const activeUser = () => ({
      ...user,
      currentCourseId: activeId,
      learningLanguage: `ll-${activeId}`,
      fromLanguage: `fl-${activeId}`,
    });
    return {
      getUser: jest.fn(() => Promise.resolve(activeUser())),
      getXpSummaries: jest.fn(() => Promise.resolve({ summaries: [] })),
      getVocabulary: jest.fn(() => Promise.resolve({ vocab_overview: [] })),
      getLegacyUser: jest.fn(() => Promise.resolve({ language_data: {} })),
      getPathSectioned: jest.fn(() => Promise.resolve([])),
      getMistakeCount: jest.fn(() => Promise.resolve(0)),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
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

  it("returns no course-drift warnings when Dash-owned switches stay active", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    const user = () => makeUser(courses, activeId);
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => Promise.resolve(user())),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, true);

    expect(result.warnings).toBeUndefined();
    expect(activeId).toBe("A");
  });

  it("returns a conflict when the active course changes outside the cycle sync", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    let forceExternalCourse = false;
    const user = (id = activeId) => makeUser(courses, id);
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => {
        if (forceExternalCourse) return Promise.resolve(user("C"));
        return Promise.resolve(user());
      }),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
        forceExternalCourse = id === "B";
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, true);

    expect(result).toMatchObject({
      type: "skipped",
      changed: false,
      error: "Active course changed outside this sync",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected B, saw C"),
      ]),
    );
    expect(switchCalls).toEqual(["B"]);
  });

  it("does not save course-dependent details for a course that drifts mid-fetch", async () => {
    const user = makeUser([{ id: "A", xp: 100 }], "A");
    let activeId = "A";
    const client = {
      ...makeClient(user),
      getUser: jest.fn(() => Promise.resolve(makeUser([{ id: "A", xp: 100 }], activeId))),
      getVocabulary: jest.fn(async () => ({
        vocab_overview: [
          {
            word_string: "hola",
            lexeme_id: "lex-1",
            strength_bars: 4,
            skill: "greetings",
            pos: "noun",
            gender: "",
            last_practiced: "2026-01-01",
          },
        ],
      })),
      getLegacyUser: jest.fn(async () => {
        activeId = "B";
        return {
          language_data: {
            "ll-A": {
              skills: [
                {
                  id: "skill-1",
                  name: "Basics",
                  learned: true,
                  strength: 0.8,
                  words: ["hola"],
                  levels_finished: 1,
                  finishedLevels: 1,
                  coords_x: 0,
                  coords_y: 0,
                  dependencies: [],
                },
              ],
            },
          },
        };
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, false);

    expect(result).toMatchObject({
      type: "skipped",
      changed: false,
      error: "Active course changed outside this sync",
    });
    expect(dbMocks.snapshotVocab).not.toHaveBeenCalled();
    expect(dbMocks.snapshotSkills).not.toHaveBeenCalled();
    expect(dbMocks.prepareRun).not.toHaveBeenCalled();
  });

  it("does not save course-dependent details for a course when XP drifts mid-fetch", async () => {
    const user = makeUser([{ id: "A", xp: 100 }], "A");
    let totalXp = 0;
    const client = {
      ...makeClient(user),
      getUser: jest.fn(() => Promise.resolve({
        ...makeUser([{ id: "A", xp: 100 }], "A"),
        totalXp,
      })),
      getVocabulary: jest.fn(async () => {
        totalXp = 1;
        return {
          vocab_overview: [
            {
              word_string: "hola",
              lexeme_id: "lex-1",
              strength_bars: 4,
              skill: "greetings",
              pos: "noun",
              gender: "",
              last_practiced: "2026-01-01",
            },
          ],
        };
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, false);

    expect(result).toMatchObject({
      type: "skipped",
      changed: false,
      error: "XP changed outside this sync",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("XP changed outside this sync after A vocabulary fetch"),
      ]),
    );
    expect(dbMocks.snapshotVocab).not.toHaveBeenCalled();
    expect(dbMocks.snapshotSkills).not.toHaveBeenCalled();
    expect(dbMocks.prepareRun).not.toHaveBeenCalled();
  });

  it("reports both signals when XP and active course drift in the same guard check", async () => {
    const user = makeUser([{ id: "A", xp: 100 }], "A");
    let activeId = "A";
    let totalXp = 0;
    const client = {
      ...makeClient(user),
      getUser: jest.fn(() => Promise.resolve({
        ...makeUser([{ id: "A", xp: 100 }], activeId),
        totalXp,
      })),
      getVocabulary: jest.fn(async () => {
        activeId = "B";
        totalXp = 1;
        return { vocab_overview: [] };
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, false);

    expect(result).toMatchObject({
      type: "skipped",
      changed: false,
      error: "Active course changed outside this sync",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("XP changed outside this sync after A vocabulary fetch"),
        expect.stringContaining("Active course changed outside this sync after A vocabulary fetch"),
      ]),
    );
    expect(dbMocks.snapshotVocab).not.toHaveBeenCalled();
    expect(dbMocks.snapshotSkills).not.toHaveBeenCalled();
    expect(dbMocks.prepareRun).not.toHaveBeenCalled();
  });

  it("saves clean detail data when one endpoint fails without active-course drift", async () => {
    const user = makeUser([{ id: "A", xp: 100 }], "A");
    const client = {
      ...makeClient(user),
      getVocabulary: jest.fn(async () => {
        throw new Error("vocab unavailable");
      }),
      getLegacyUser: jest.fn(async () => ({
        language_data: {
          "ll-A": {
            skills: [
              {
                id: "skill-1",
                name: "Basics",
                learned: true,
                strength: 0.8,
                words: ["hola"],
                levels_finished: 2,
                finishedLevels: 2,
                coords_x: 1,
                coords_y: 2,
                dependencies: [],
              },
            ],
          },
        },
      })),
      getMistakeCount: jest.fn(async () => 3),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, false);

    expect(result).toMatchObject({ type: "full", changed: true });
    expect(dbMocks.snapshotVocab).not.toHaveBeenCalled();
    expect(dbMocks.snapshotSkills).toHaveBeenCalledWith(
      "A",
      expect.arrayContaining([
        expect.objectContaining({ skill_id: "skill-1", skill_name: "Basics" }),
      ]),
    );
    expect(dbMocks.prepareRun).toHaveBeenCalledWith(3, "A", "A");
  });

  it("keeps a clean course detail save when a later course drifts", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    let forceExternalCourse = false;
    const user = (id = activeId) => makeUser(courses, id);
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => {
        if (forceExternalCourse) return Promise.resolve(user("C"));
        return Promise.resolve(user());
      }),
      getLegacyUser: jest.fn(async () => ({
        language_data: {
          "ll-A": {
            skills: [
              {
                id: "skill-A",
                name: "A Skill",
                learned: true,
                strength: 1,
                words: [],
                levels_finished: 1,
                finishedLevels: 1,
                coords_x: 0,
                coords_y: 0,
                dependencies: [],
              },
            ],
          },
          "ll-B": {
            skills: [
              {
                id: "skill-B",
                name: "B Skill",
                learned: true,
                strength: 1,
                words: [],
                levels_finished: 1,
                finishedLevels: 1,
                coords_x: 0,
                coords_y: 0,
                dependencies: [],
              },
            ],
          },
        },
      })),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
        forceExternalCourse = id === "B";
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.fullSync(client, true);

    expect(result.error).toBe("Active course changed outside this sync");
    expect(dbMocks.snapshotSkills).toHaveBeenCalledTimes(1);
    expect(dbMocks.snapshotSkills).toHaveBeenCalledWith(
      "A",
      expect.arrayContaining([expect.objectContaining({ skill_id: "skill-A" })]),
    );
    expect(switchCalls).toEqual(["B"]);
  });

  it("manual per-course sync aborts on drift without restoring over another actor", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    let forceExternalCourse = false;
    const user = (id = activeId) => makeUser(courses, id);
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => {
        if (forceExternalCourse) return Promise.resolve(user("C"));
        return Promise.resolve(user());
      }),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
        forceExternalCourse = id === "B";
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.syncCourseDetails(client, "B", "ll-B", "fl-B");

    expect(result).toMatchObject({
      success: false,
      switchedBack: false,
      error: "Active course changed outside this sync",
    });
    expect(result.details).toEqual(
      expect.arrayContaining([expect.stringContaining("expected B, saw C")]),
    );
    expect(switchCalls).toEqual(["B"]);
  });

  it("manual per-course sync aborts on XP drift without restoring over another actor", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    let totalXp = 0;
    const user = () => ({
      ...makeUser(courses, activeId),
      totalXp,
    });
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => Promise.resolve(user())),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        activeId = id;
        totalXp = 1;
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.syncCourseDetails(client, "B", "ll-B", "fl-B");

    expect(result).toMatchObject({
      success: false,
      switchedBack: false,
      error: "XP changed outside this sync",
    });
    expect(result.details).toEqual(
      expect.arrayContaining([expect.stringContaining("expected 0, saw 1")]),
    );
    expect(switchCalls).toEqual(["B"]);
  });

  it("manual per-course sync reports restore success accurately", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    const client = makeClient(makeUser(courses, "A"));

    const result = await mod.syncCourseDetails(client, "B", "ll-B", "fl-B");

    expect(result).toMatchObject({ success: true, switchedBack: true });
    expect(switchCalls).toEqual(["B", "A"]);
  });

  it("manual per-course sync reports restore failure accurately", async () => {
    const courses = [
      { id: "A", xp: 100 },
      { id: "B", xp: 200 },
    ];
    let activeId = "A";
    const user = () => makeUser(courses, activeId);
    const client = {
      ...makeClient(user()),
      getUser: jest.fn(() => Promise.resolve(user())),
      switchCourse: jest.fn((id: string) => {
        switchCalls.push(id);
        if (id === "A") return Promise.reject(new Error("restore failed"));
        activeId = id;
        return Promise.resolve();
      }),
    } as unknown as DuolingoClient;

    const result = await mod.syncCourseDetails(client, "B", "ll-B", "fl-B");

    expect(result).toMatchObject({
      success: false,
      switchedBack: false,
      error: "Failed to restore active course",
    });
    expect(switchCalls).toEqual(["B", "A"]);
  });
});
