import type { DuolingoClient } from "../duolingo";
import type { LegacyUserData, PathSection } from "../types";

describe("sync skill progress", () => {
  let snapshotSkills: jest.Mock;
  let getLatestStoredSkillSnapshots: jest.Mock;
  let mod: typeof import("../sync");

  beforeEach(() => {
    jest.resetModules();

    snapshotSkills = jest.fn();
    getLatestStoredSkillSnapshots = jest.fn(() => []);
    jest.doMock("../db", () => ({
      getDb: jest.fn(),
      getLastSyncXp: jest.fn(() => null),
      logSync: jest.fn(),
      upsertProfile: jest.fn(),
      insertCourseSnapshot: jest.fn(),
      upsertXpDaily: jest.fn(),
      snapshotVocab: jest.fn(),
      snapshotSkills,
      getLatestStoredSkillSnapshots,
      upsertAchievements: jest.fn(),
      updateStreakEpochs: jest.fn(),
      backfillImpliedFreeze: jest.fn(),
    }));

    mod = require("../sync") as typeof import("../sync");
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../db");
  });

  it("overlays pathSectioned progress when manual course sync snapshots legacy skills", async () => {
    const client = {
      getUser: jest.fn().mockResolvedValue({
        currentCourseId: "DUOLINGO_ZH-CN_EN",
        learningLanguage: "zh",
        fromLanguage: "en",
      }),
      switchCourse: jest.fn(),
      getVocabulary: jest.fn().mockRejectedValue(new Error("vocab endpoint is dead")),
      getLegacyUser: jest.fn().mockResolvedValue(legacyUser()),
      getPathSectioned: jest.fn().mockResolvedValue(pathSections()),
      getMistakeCount: jest.fn().mockResolvedValue(0),
    } as unknown as DuolingoClient;

    const result = await mod.syncCourseDetails(
      client,
      "DUOLINGO_ZH-CN_EN",
      "zh",
      "en",
    );

    expect(result.success).toBe(true);
    expect(client.switchCourse).not.toHaveBeenCalled();
    expect(snapshotSkills).toHaveBeenCalledTimes(1);
    expect(snapshotSkills.mock.calls[0][0]).toBe("DUOLINGO_ZH-CN_EN");

    const skills = snapshotSkills.mock.calls[0][1] as Array<{ skill_id: string; levels_finished: number }>;
    expect(skills.find((s) => s.skill_id === "sports")?.levels_finished).toBe(5);
    expect(skills.find((s) => s.skill_id === "food")?.levels_finished).toBe(2);
  });

  it("refreshes path status over the latest stored word map when legacy skills are empty", async () => {
    getLatestStoredSkillSnapshots.mockReturnValue([
      {
        skill_id: "sports",
        skill_name: "Sports",
        learned: 0,
        strength: 0,
        words_json: JSON.stringify(["球", "运动"]),
        levels_finished: 0,
        coords_x: 1,
        coords_y: 10,
        dependencies_json: "[]",
      },
    ]);

    const client = {
      getUser: jest.fn().mockResolvedValue({
        currentCourseId: "DUOLINGO_ZH-CN_EN",
        learningLanguage: "zh",
        fromLanguage: "en",
      }),
      switchCourse: jest.fn(),
      getVocabulary: jest.fn().mockRejectedValue(new Error("vocab endpoint is dead")),
      getLegacyUser: jest.fn().mockResolvedValue(legacyUser([])),
      getPathSectioned: jest.fn().mockResolvedValue(pathSections()),
      getMistakeCount: jest.fn().mockResolvedValue(0),
    } as unknown as DuolingoClient;

    const result = await mod.syncCourseDetails(
      client,
      "DUOLINGO_ZH-CN_EN",
      "zh",
      "en",
    );

    expect(result.success).toBe(true);
    expect(getLatestStoredSkillSnapshots).toHaveBeenCalledWith("DUOLINGO_ZH-CN_EN");
    expect(snapshotSkills).toHaveBeenCalledTimes(1);
    expect(result.details).toContain("Saved 1 skills for zh (stored word map + path status)");

    const skills = snapshotSkills.mock.calls[0][1] as Array<{
      skill_id: string;
      words: string[];
      learned: boolean;
      levels_finished: number;
    }>;
    expect(skills).toEqual([
      expect.objectContaining({
        skill_id: "sports",
        words: ["球", "运动"],
        learned: true,
        levels_finished: 5,
      }),
    ]);
  });
});

function legacyUser(skills = legacySkills()): LegacyUserData {
  return {
    username: "tester",
    languages: [
      {
        language: "zh",
        language_string: "Chinese",
        current_learning: true,
        learning: true,
      },
    ],
    language_data: {
      zh: {
        language: "zh",
        language_string: "Chinese",
        current_learning: true,
        level: 1,
        points: 0,
        streak: 0,
        to_next_level: 0,
        calendar: [],
        skills,
      },
    },
  };
}

function legacySkills() {
  return [
    {
      id: "sports",
      name: "Sports",
      title: "Sports",
      short_name: "Sports",
      url_title: "sports",
      learned: false,
      strength: 0,
      words: ["球", "运动"],
      levels_finished: 0,
      finishedLevels: 0,
      progress_percent: 0,
      accessible: true,
      num_lexemes: 2,
      dependencies: [],
      coords_x: 1,
      coords_y: 10,
    },
    {
      id: "food",
      name: "Food",
      title: "Food",
      short_name: "Food",
      url_title: "food",
      learned: false,
      strength: 0,
      words: ["饭"],
      levels_finished: 2,
      finishedLevels: 2,
      progress_percent: 40,
      accessible: true,
      num_lexemes: 1,
      dependencies: [],
      coords_x: 1,
      coords_y: 11,
    },
  ];
}

function pathSections(): PathSection[] {
  return [
    {
      id: "section-1",
      units: [
        {
          unitIndex: 1,
          levels: [
            {
              id: "sports-0",
              type: "skill",
              state: "legendary",
              finishedSessions: 5,
              totalSessions: 5,
              pathLevelClientData: { skillId: "sports" },
            },
            {
              id: "sports-1",
              type: "skill",
              state: "legendary",
              finishedSessions: 5,
              totalSessions: 5,
              pathLevelClientData: { skillId: "sports" },
            },
          ],
        },
      ],
    },
  ];
}
