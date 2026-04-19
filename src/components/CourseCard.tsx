import Link from "next/link";
import { getLanguageName, getLanguageFlag } from "@/lib/language-names";
import { getScriptInfo } from "@/lib/scripts";

interface CourseCardProps {
  courseId: string;
  learningLanguage: string;
  fromLanguage: string;
  title: string;
  xp: number;
  totalCrowns?: number;
  wordCount?: number;
  totalSkills?: number;
  completedSkills?: number;
  inProgressSkills?: number;
}

export function CourseCard({
  courseId,
  learningLanguage,
  title,
  xp,
  totalCrowns,
  wordCount,
  totalSkills,
  completedSkills,
  inProgressSkills,
}: CourseCardProps) {
  const flag = getLanguageFlag(learningLanguage);
  const name = title || getLanguageName(learningLanguage);
  const scriptInfo = getScriptInfo(learningLanguage);

  const skillSummary = totalSkills != null && totalSkills > 0
    ? `${completedSkills ?? 0}/${totalSkills} skills`
    : null;

  const inProgressNote = inProgressSkills != null && inProgressSkills > 0
    ? `, ${inProgressSkills} in progress`
    : null;

  return (
    <Link
      href={`/course/${encodeURIComponent(courseId)}`}
      className="block bg-zinc-900 border border-zinc-800 rounded-lg p-5 hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl mb-1">{flag}</div>
          <h3 className="text-lg font-semibold text-zinc-100">{name}</h3>
          {scriptInfo && (
            <div className="text-xs text-zinc-500 mt-0.5">
              {scriptInfo.scripts.map((s) => s.name).join(", ")} ({scriptInfo.scripts.map((s) => s.type).join(", ")})
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-zinc-100">{xp.toLocaleString()}</div>
          <div className="text-xs text-zinc-500">XP</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
        {totalCrowns != null && totalCrowns > 0 && (
          <span>♛ {totalCrowns.toLocaleString()}</span>
        )}
        {wordCount != null && wordCount > 0 && <span>{wordCount} words</span>}
        {skillSummary && (
          <span>{skillSummary}{inProgressNote}</span>
        )}
      </div>
    </Link>
  );
}
