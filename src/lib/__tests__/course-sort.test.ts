import { sortCoursesByTotalXp, sortCoursesForXpGainView } from "../course-sort";

describe("course card sorting", () => {
  const courses = [
    { course_id: "spanish", xp: 50_000 },
    { course_id: "japanese", xp: 90_000 },
    { course_id: "portuguese", xp: 10_000 },
    { course_id: "ukrainian", xp: 40_000 },
  ];

  it("sorts gain views by active window XP before inactive all-time XP", () => {
    const sorted = sortCoursesForXpGainView(
      courses,
      new Set(["spanish", "portuguese"]),
      {
        spanish: 100,
        portuguese: 700,
      },
    );

    expect(sorted.map((course) => course.course_id)).toEqual([
      "portuguese",
      "spanish",
      "japanese",
      "ukrainian",
    ]);
  });

  it("sorts total views by all-time XP only", () => {
    const sorted = sortCoursesByTotalXp(courses);

    expect(sorted.map((course) => course.course_id)).toEqual([
      "japanese",
      "spanish",
      "ukrainian",
      "portuguese",
    ]);
  });
});
