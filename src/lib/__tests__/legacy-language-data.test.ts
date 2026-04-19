import {
  resolveLegacyLanguageData,
  resolveLegacyLanguageEntry,
} from "../legacy-language-data";
import type { LegacyLanguageData, LegacyUserData } from "../types";

function skillBlock(language: string): LegacyLanguageData {
  return {
    skills: [{ id: "s1", name: "Basics", learned: true, strength: 1, words: [], levels_finished: 5, finishedLevels: 5, progress_percent: 100, url_title: "basics", title: "Basics", short_name: "B", num_lexemes: 0, dependencies: [], coords_x: 0, coords_y: 0, accessible: true }],
    calendar: [],
    level: 1,
    points: 0,
    streak: 0,
    language_string: "L",
    language,
    to_next_level: 0,
    current_learning: true,
  };
}

describe("resolveLegacyLanguageData", () => {
  it("uses a direct key when it exists", () => {
    const legacy = {
      username: "x",
      language_data: { fr: skillBlock("fr") },
      languages: [],
    } satisfies LegacyUserData;
    expect(resolveLegacyLanguageData(legacy, "fr")?.language).toBe("fr");
  });

  it("maps Norwegian nb to legacy key no", () => {
    const legacy = {
      username: "x",
      language_data: { no: skillBlock("no") },
      languages: [],
    } satisfies LegacyUserData;
    const resolved = resolveLegacyLanguageEntry(legacy, "nb");
    expect(resolved.key).toBe("no");
    expect(resolved.data?.skills).toHaveLength(1);
  });

  it("maps Chinese zh to legacy key zs", () => {
    const legacy = {
      username: "x",
      language_data: { zs: skillBlock("zs") },
      languages: [],
    } satisfies LegacyUserData;
    const resolved = resolveLegacyLanguageEntry(legacy, "zh");
    expect(resolved.key).toBe("zs");
    expect(resolved.data?.skills).toHaveLength(1);
  });

  it("matches inner language code when top-level keys differ", () => {
    const legacy = {
      username: "x",
      language_data: { xyz: skillBlock("nb") },
      languages: [],
    } satisfies LegacyUserData;
    expect(resolveLegacyLanguageData(legacy, "nb")?.skills).toHaveLength(1);
  });

  it("falls back when language_data has a single tree", () => {
    const legacy = {
      username: "x",
      language_data: { onlyKey: skillBlock("xx") },
      languages: [],
    } satisfies LegacyUserData;
    expect(resolveLegacyLanguageData(legacy, "anything")?.skills).toHaveLength(1);
  });

  it("returns undefined when multiple trees and none match", () => {
    const legacy = {
      username: "x",
      language_data: { a: skillBlock("a"), b: skillBlock("b") },
      languages: [],
    } satisfies LegacyUserData;
    expect(resolveLegacyLanguageData(legacy, "missing")).toBeUndefined();
  });
});
