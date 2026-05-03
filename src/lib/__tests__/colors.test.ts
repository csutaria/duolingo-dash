import { assignCourseColors, type CourseColorInput } from "../colors";

describe("assignCourseColors", () => {
  it("uses the primary rendered-flag tone for the highest-priority course", () => {
    const colors = assignCourseColors([
      course("pt-top", "pt", 20_000),
      course("es-second", "es", 10_000),
    ]);

    expect(colors["pt-top"]).toBe("#58cc02");
    expect(colors["es-second"]).toBe("#ff4b4b");
  });

  it("uses later flag tones before duplicating a color", () => {
    const colors = assignCourseColors([
      course("ja-top", "ja", 20_000),
      course("es-second", "es", 10_000),
    ]);

    expect(colors["ja-top"]).toBe("#ff4b4b");
    expect(colors["es-second"]).toBe("#ffd900");
  });

  it("lets flexible flags move aside for an iconic primary color", () => {
    const colors = assignCourseColors([
      course("ukrainian", "uk", 65_000),
      course("korean", "ko", 33_000),
      course("chinese", "zh", 12_000),
    ]);

    expect(colors.chinese).toBe("#ff4b4b");
    expect(colors.korean).toBe("#1cb0f6");
    expect(colors.ukrainian).toBe("#ffd900");
  });

  it("avoids same-family colors when another flag tone family is available", () => {
    const colors = assignCourseColors([
      course("chinese", "zh", 40_000),
      course("korean", "ko", 30_000),
    ]);

    expect(colors.chinese).toBe("#ff4b4b");
    expect(colors.korean).toBe("#1cb0f6");
  });

  it("does not let a low-priority constrained course take the better top-course color", () => {
    const colors = assignCourseColors([
      course("ukrainian", "uk", 65_000),
      course("korean", "ko", 33_000),
      course("chinese", "zh", 12_000),
      course("vietnamese", "vi", 265),
    ]);

    expect(colors.chinese).toBe("#ff4b4b");
    expect(colors.korean).toBe("#1cb0f6");
    expect(colors.ukrainian).toBe("#ffd900");
  });

  it("uses another warm flag family before falling back to an unrelated color", () => {
    const colors = assignCourseColors([
      course("japanese", "ja", 50_000),
      course("spanish", "es", 10_000),
    ]);

    expect(["#ffd900", "#e8a838", "#ff9600", "#ffb347"]).toContain(colors.spanish);
  });

  it("is deterministic regardless of input order", () => {
    const courses = [
      course("spanish", "es", 30_000),
      course("portuguese", "pt", 20_000),
      course("ukrainian", "uk", 10_000),
    ];

    expect(assignCourseColors(courses)).toEqual(assignCourseColors([...courses].reverse()));
  });

  it("falls back to the base palette for unknown language codes", () => {
    const colors = assignCourseColors([
      course("unknown", "xx", 20_000),
      course("spanish", "es", 10_000),
    ]);

    expect(colors.unknown).toBe("#58cc02");
    expect(colors.spanish).toBe("#ff4b4b");
  });

  it("only reuses colors after the palette is exhausted", () => {
    const colors = assignCourseColors(
      Array.from({ length: 21 }, (_, i) => course(`unknown-${i}`, "xx", 100 - i)),
    );

    expect(new Set(Object.values(colors)).size).toBe(20);
    expect(colors["unknown-20"]).toBe("#58cc02");
  });
});

function course(course_id: string, learning_language: string, xp: number): CourseColorInput {
  return { course_id, learning_language, xp };
}
