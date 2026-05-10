const LAST_COURSE_STORAGE_KEY = "duolingo-dash:last-course-id";

export function choosePreferredCourseId(
  courseIds: string[],
  storedCourseId: string | null,
  activeCourseId: string | null,
): string | null {
  if (storedCourseId && courseIds.includes(storedCourseId)) return storedCourseId;
  if (activeCourseId && courseIds.includes(activeCourseId)) return activeCourseId;
  return courseIds[0] ?? null;
}

export function readLastCourseId(allowedCourseIds?: string[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LAST_COURSE_STORAGE_KEY);
    if (!stored) return null;
    if (allowedCourseIds && !allowedCourseIds.includes(stored)) return null;
    return stored;
  } catch {
    return null;
  }
}

export function writeLastCourseId(courseId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_COURSE_STORAGE_KEY, courseId);
  } catch {
    // localStorage can be unavailable in private or constrained contexts.
  }
}
