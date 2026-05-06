export interface CourseSortInput {
  course_id?: unknown;
  xp?: unknown;
}

export function sortCoursesByTotalXp<T extends CourseSortInput>(courses: T[]): T[] {
  return [...courses].sort((a, b) => Number(b.xp ?? 0) - Number(a.xp ?? 0));
}

export function sortCoursesForXpGainView<T extends CourseSortInput>(
  courses: T[],
  activeInWindow: Set<string>,
  windowXp: Record<string, number>,
): T[] {
  return [...courses].sort((a, b) => {
    const aId = String(a.course_id);
    const bId = String(b.course_id);
    const aActive = activeInWindow.has(aId) ? 0 : 1;
    const bActive = activeInWindow.has(bId) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (aActive === 0) return (windowXp[bId] ?? 0) - (windowXp[aId] ?? 0);
    return Number(b.xp ?? 0) - Number(a.xp ?? 0);
  });
}
