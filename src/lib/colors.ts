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

/** Stable alphabetical assignment so colors don't shift when XP order changes. */
export function assignCourseColors(courseIds: string[]): Record<string, string> {
  const sorted = [...courseIds].sort();
  return Object.fromEntries(
    sorted.map((id, i) => [id, COURSE_PALETTE[i % COURSE_PALETTE.length]])
  );
}
