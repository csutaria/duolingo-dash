import {
  buildVocabBundles,
  buildVocabWordRows,
  parseSkillWords,
  sortBundlesByCourseOrder,
  vocabBundleStatus,
} from "../vocab-bundles";

describe("vocab bundle helpers", () => {
  it("classifies levels_finished into study statuses", () => {
    expect(vocabBundleStatus(0)).toEqual({ status: "untouched", label: "Untouched" });
    expect(vocabBundleStatus(2)).toEqual({ status: "in-progress", label: "In progress" });
    expect(vocabBundleStatus(4)).toEqual({ status: "complete", label: "Complete" });
    expect(vocabBundleStatus(5)).toEqual({ status: "complete-plus", label: "Complete+" });
  });

  it("parses skill words defensively", () => {
    expect(parseSkillWords('[" 안녕하세요 ","",7,"커피"]')).toEqual(["안녕하세요", "커피"]);
    expect(parseSkillWords("not json")).toEqual([]);
    expect(parseSkillWords(null)).toEqual([]);
  });

  it("builds skill bundles from snapshot rows", () => {
    const bundles = buildVocabBundles([
      {
        skill_id: "s1",
        skill_name: "Cafe",
        levels_finished: 5,
        words_json: '["차","커피"]',
        coords_x: 1,
        coords_y: 2,
      },
    ]);

    expect(bundles).toEqual([
      {
        skillId: "s1",
        skillName: "Cafe",
        levelsFinished: 5,
        status: "complete-plus",
        statusLabel: "Complete+",
        words: ["차", "커피"],
        wordCount: 2,
        coordsX: 1,
        coordsY: 2,
      },
    ]);
  });

  it("creates unique all-word rows with skill context", () => {
    const bundles = buildVocabBundles([
      {
        skill_id: "s1",
        skill_name: "Cafe",
        levels_finished: 5,
        words_json: '["차","커피"]',
        coords_x: 1,
        coords_y: 1,
      },
      {
        skill_id: "s2",
        skill_name: "Restaurant",
        levels_finished: 4,
        words_json: '["커피","김치"]',
        coords_x: 1,
        coords_y: 2,
      },
    ]);

    const rows = buildVocabWordRows(bundles);
    expect(rows.map((row) => row.word)).toEqual(["김치", "차", "커피"]);

    const coffee = rows.find((row) => row.word === "커피");
    expect(coffee?.skills.map((skill) => skill.skillName)).toEqual(["Cafe", "Restaurant"]);
    expect(coffee?.strongestStatusLabel).toBe("Complete+");
  });

  it("sorts bundles by course coordinates", () => {
    const bundles = buildVocabBundles([
      { skill_id: "later", skill_name: "Later", levels_finished: 0, words_json: "[]", coords_x: 2, coords_y: 2 },
      { skill_id: "first", skill_name: "First", levels_finished: 0, words_json: "[]", coords_x: 1, coords_y: 1 },
      { skill_id: "second", skill_name: "Second", levels_finished: 0, words_json: "[]", coords_x: 2, coords_y: 1 },
    ]);

    expect(sortBundlesByCourseOrder(bundles).map((bundle) => bundle.skillId)).toEqual(["first", "second", "later"]);
  });
});
