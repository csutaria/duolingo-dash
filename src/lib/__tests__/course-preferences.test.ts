import { choosePreferredCourseId } from "../course-preferences";

describe("choosePreferredCourseId", () => {
  const courses = ["DUOLINGO_UK_EN", "DUOLINGO_ZH-CN_EN", "DUOLINGO_KO_EN"];

  it("prefers a stored course when it still exists", () => {
    expect(choosePreferredCourseId(courses, "DUOLINGO_KO_EN", "DUOLINGO_ZH-CN_EN")).toBe("DUOLINGO_KO_EN");
  });

  it("falls back to the active profile course when no stored course exists", () => {
    expect(choosePreferredCourseId(courses, null, "DUOLINGO_ZH-CN_EN")).toBe("DUOLINGO_ZH-CN_EN");
  });

  it("ignores stale stored and active course ids", () => {
    expect(choosePreferredCourseId(courses, "DUOLINGO_FR_EN", "DUOLINGO_ES_EN")).toBe("DUOLINGO_UK_EN");
  });

  it("returns null when there are no local courses", () => {
    expect(choosePreferredCourseId([], null, "DUOLINGO_ZH-CN_EN")).toBeNull();
  });
});
