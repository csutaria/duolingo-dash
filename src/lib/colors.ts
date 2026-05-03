// Color palette — dark mode. Centralize here when adding light mode.
// Palette assumes dark backgrounds; revisit assignments when light mode lands.
const COURSE_PALETTE = [
  "#58cc02", "#1cb0f6", "#ff9600", "#ce82ff", "#ff4b4b",
  "#00cd9c", "#ffd900", "#ff86d0", "#64d8cb", "#ffb347",
  "#7ec8e3", "#c5e384", "#e8a838", "#ff6b6b", "#4ecdc4",
  "#95e1d3", "#f38181", "#aa96da", "#fcbad3", "#dfe6e9",
];

export const CHART_TOTAL_COLOR = "#e4e4e7";  // zinc-200 — measured stack-top line
export const CHART_CEILING_COLOR = "#52525b"; // zinc-600 — Duolingo-reported ceiling

export interface CourseColorInput {
  course_id: string;
  learning_language?: string;
  xp?: number;
}

const RED_TONES = ["#ff4b4b", "#ff6b6b", "#f38181"];
const BLUE_TONES = ["#1cb0f6", "#7ec8e3"];
const GREEN_TONES = ["#58cc02", "#00cd9c", "#4ecdc4", "#95e1d3"];
const YELLOW_TONES = ["#ffd900", "#e8a838"];
const ORANGE_TONES = ["#ff9600", "#ffb347"];
const PINK_TONES = ["#ff86d0", "#fcbad3"];
const PURPLE_TONES = ["#ce82ff", "#aa96da"];

const COLOR_FAMILIES: Record<string, string> = {
  ...Object.fromEntries(RED_TONES.map((color) => [color, "red"])),
  ...Object.fromEntries(BLUE_TONES.map((color) => [color, "blue"])),
  ...Object.fromEntries(GREEN_TONES.map((color) => [color, "green"])),
  ...Object.fromEntries(YELLOW_TONES.map((color) => [color, "yellow"])),
  ...Object.fromEntries(ORANGE_TONES.map((color) => [color, "orange"])),
  ...Object.fromEntries(PINK_TONES.map((color) => [color, "pink"])),
  ...Object.fromEntries(PURPLE_TONES.map((color) => [color, "purple"])),
  "#dfe6e9": "neutral",
};

const ICONIC_PRIMARY_TONE_COUNT: Record<string, number> = {
  ar: 1,
  da: 1,
  es: 1,
  id: 1,
  ja: 1,
  ka: 1,
  pl: 1,
  tr: 1,
  vi: 1,
  zh: 1,
};

const LANGUAGE_FLAG_TONES: Record<string, string[]> = {
  ar: [...GREEN_TONES],
  cs: [...BLUE_TONES, ...RED_TONES],
  da: [...RED_TONES],
  de: [...YELLOW_TONES, ...RED_TONES, ...ORANGE_TONES],
  el: [...BLUE_TONES],
  en: [...RED_TONES, ...BLUE_TONES],
  es: [...RED_TONES, ...YELLOW_TONES, ...ORANGE_TONES],
  fi: [...BLUE_TONES],
  fr: [...BLUE_TONES, ...RED_TONES],
  ga: [...GREEN_TONES, ...ORANGE_TONES],
  gd: [...BLUE_TONES],
  he: [...BLUE_TONES],
  hi: [...ORANGE_TONES, ...GREEN_TONES, ...BLUE_TONES],
  hu: [...RED_TONES, ...GREEN_TONES],
  id: [...RED_TONES],
  it: [...GREEN_TONES, ...RED_TONES],
  ja: [...RED_TONES],
  ka: [...RED_TONES],
  ko: [...RED_TONES, ...BLUE_TONES],
  nb: [...RED_TONES, ...BLUE_TONES],
  nl: [...ORANGE_TONES, ...RED_TONES, ...BLUE_TONES],
  pl: [...RED_TONES],
  pt: [...GREEN_TONES, ...YELLOW_TONES, ...BLUE_TONES],
  ro: [...BLUE_TONES, ...YELLOW_TONES, ...RED_TONES],
  ru: [...RED_TONES, ...BLUE_TONES],
  sv: [...BLUE_TONES, ...YELLOW_TONES],
  sw: [...RED_TONES, ...GREEN_TONES],
  th: [...RED_TONES, ...BLUE_TONES],
  tr: [...RED_TONES],
  uk: [...BLUE_TONES, ...YELLOW_TONES],
  vi: [...RED_TONES, ...YELLOW_TONES],
  xh: [...GREEN_TONES, ...YELLOW_TONES, ...RED_TONES],
  zh: [...RED_TONES, ...YELLOW_TONES],
  zu: [...GREEN_TONES, ...YELLOW_TONES, ...RED_TONES],
};

/** Stable full-list assignment with flag-matched first choices for top courses. */
export function assignCourseColors(courses: CourseColorInput[]): Record<string, string> {
  const sorted = [...courses].sort(compareCoursePriority);
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  const usedFamilies = new Set<string>();

  for (const course of sorted) {
    const primaryColor = pickUnusedPrimaryTone(course, used);
    if (primaryColor) {
      assigned.set(course.course_id, primaryColor);
      used.add(primaryColor);
      usedFamilies.add(colorFamily(primaryColor));
    }
  }

  const remaining = sorted.filter((course) => !assigned.has(course.course_id));

  for (const course of remaining) {
    if (assigned.has(course.course_id)) continue;
    const unassigned = remaining.filter((other) => other.course_id !== course.course_id && !assigned.has(other.course_id));
    const color = pickBestColor(course, unassigned, used, usedFamilies, assigned.size);

    assigned.set(course.course_id, color);
    used.add(color);
    usedFamilies.add(colorFamily(color));
  }

  return Object.fromEntries(assigned);
}

function colorFamily(color: string): string {
  return COLOR_FAMILIES[color] ?? color;
}

function pickBestColor(
  course: CourseColorInput,
  unassigned: CourseColorInput[],
  used: Set<string>,
  usedFamilies: Set<string>,
  assignedCount: number,
): string {
  const preferred = LANGUAGE_FLAG_TONES[course.learning_language ?? ""] ?? [];
  return pickBestFrom(preferred, unassigned, used, usedFamilies) ??
    pickBestFrom(COURSE_PALETTE, unassigned, used, usedFamilies) ??
    preferred.find((candidate) => !used.has(candidate)) ??
    COURSE_PALETTE.find((candidate) => !used.has(candidate)) ??
    COURSE_PALETTE[assignedCount % COURSE_PALETTE.length];
}

function pickBestFrom(
  colors: string[],
  unassigned: CourseColorInput[],
  used: Set<string>,
  usedFamilies: Set<string>,
): string | undefined {
  return colors
    .map((color, index) => ({ color, score: colorScore(color, index, unassigned, used, usedFamilies) }))
    .filter((entry): entry is { color: string; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score)[0]?.color;
}

function colorScore(
  color: string,
  index: number,
  unassigned: CourseColorInput[],
  used: Set<string>,
  usedFamilies: Set<string>,
): number | null {
  if (used.has(color)) return null;

  const family = colorFamily(color);
  const familyPenalty = usedFamilies.has(family) ? 1_000_000_000 : 0;
  const blockingPenalty = maxXpBlockedByTakingFamily(family, unassigned, usedFamilies);
  return familyPenalty + blockingPenalty + index;
}

function maxXpBlockedByTakingFamily(
  family: string,
  unassigned: CourseColorInput[],
  usedFamilies: Set<string>,
): number {
  let max = 0;
  for (const course of unassigned) {
    const available = availablePreferredFamilies(course, usedFamilies);
    if (available.size === 1 && available.has(family)) {
      max = Math.max(max, course.xp ?? 0);
    }
  }
  return max;
}

function availablePreferredFamilies(course: CourseColorInput, usedFamilies: Set<string>): Set<string> {
  const preferred = LANGUAGE_FLAG_TONES[course.learning_language ?? ""] ?? [];
  return new Set(preferred.map(colorFamily).filter((family) => !usedFamilies.has(family)));
}

function pickUnusedPrimaryTone(course: CourseColorInput, used: Set<string>): string | undefined {
  const language = course.learning_language ?? "";
  const primaryCount = ICONIC_PRIMARY_TONE_COUNT[language] ?? 0;
  if (primaryCount === 0) return undefined;

  return (LANGUAGE_FLAG_TONES[language] ?? [])
    .slice(0, primaryCount)
    .find((candidate) => !used.has(candidate));
}

function compareCoursePriority(a: CourseColorInput, b: CourseColorInput): number {
  const xpDiff = (b.xp ?? 0) - (a.xp ?? 0);
  if (xpDiff !== 0) return xpDiff;
  return a.course_id.localeCompare(b.course_id);
}
