export type VocabBundleStatus = "complete-plus" | "complete" | "in-progress" | "untouched";

export interface VocabBundle {
  skillId: string;
  skillName: string;
  levelsFinished: number;
  status: VocabBundleStatus;
  statusLabel: string;
  words: string[];
  wordCount: number;
  coordsX: number;
  coordsY: number;
}

export interface VocabWordRow {
  word: string;
  skills: Array<{
    skillId: string;
    skillName: string;
    levelsFinished: number;
    status: VocabBundleStatus;
    statusLabel: string;
    coordsX: number;
    coordsY: number;
  }>;
  strongestStatus: VocabBundleStatus;
  strongestStatusLabel: string;
}

export function vocabBundleStatus(levelsFinished: number): {
  status: VocabBundleStatus;
  label: string;
} {
  if (levelsFinished >= 5) return { status: "complete-plus", label: "Legendary" };
  if (levelsFinished >= 4) return { status: "complete", label: "Completed" };
  if (levelsFinished >= 1) return { status: "in-progress", label: "In Progress" };
  return { status: "untouched", label: "Not started" };
}

export function parseSkillWords(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((word): word is string => typeof word === "string")
      .map((word) => word.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function buildVocabBundles(skills: Array<Record<string, unknown>>): VocabBundle[] {
  return skills.map((skill) => {
    const levelsFinished = Number(skill.levels_finished || 0);
    const { status, label } = vocabBundleStatus(levelsFinished);
    const words = parseSkillWords(skill.words_json);

    return {
      skillId: String(skill.skill_id),
      skillName: String(skill.skill_name || "Unknown"),
      levelsFinished,
      status,
      statusLabel: label,
      words,
      wordCount: words.length,
      coordsX: Number(skill.coords_x || 0),
      coordsY: Number(skill.coords_y || 0),
    };
  });
}

export function sortBundlesByCourseOrder(bundles: VocabBundle[]): VocabBundle[] {
  return [...bundles].sort(
    (a, b) => a.coordsY - b.coordsY || a.coordsX - b.coordsX || a.skillName.localeCompare(b.skillName),
  );
}

export function sortBundlesByStatus(bundles: VocabBundle[]): VocabBundle[] {
  return [...bundles].sort(
    (a, b) =>
      statusRank(b.status) - statusRank(a.status) ||
      a.coordsY - b.coordsY ||
      a.coordsX - b.coordsX ||
      a.skillName.localeCompare(b.skillName),
  );
}

export function buildVocabWordRows(bundles: VocabBundle[]): VocabWordRow[] {
  const byWord = new Map<string, VocabWordRow>();

  for (const bundle of bundles) {
    for (const word of bundle.words) {
      const row = byWord.get(word) ?? {
        word,
        skills: [],
        strongestStatus: bundle.status,
        strongestStatusLabel: bundle.statusLabel,
      };

      row.skills.push({
        skillId: bundle.skillId,
        skillName: bundle.skillName,
        levelsFinished: bundle.levelsFinished,
        status: bundle.status,
        statusLabel: bundle.statusLabel,
        coordsX: bundle.coordsX,
        coordsY: bundle.coordsY,
      });

      if (statusRank(bundle.status) > statusRank(row.strongestStatus)) {
        row.strongestStatus = bundle.status;
        row.strongestStatusLabel = bundle.statusLabel;
      }
      byWord.set(word, row);
    }
  }

  return [...byWord.values()].sort((a, b) => a.word.localeCompare(b.word));
}

export function statusRank(status: VocabBundleStatus): number {
  if (status === "complete-plus") return 3;
  if (status === "complete") return 2;
  if (status === "in-progress") return 1;
  return 0;
}
