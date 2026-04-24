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
  indicatorColor?: string;
  /**
   * XP gained in the selected window. When provided, the card's headline
   * shows "+{windowXp} XP" with total XP as a muted subtitle — "what have
   * you been practicing lately" framing for the overview page.
   */
  windowXp?: number;
  /**
   * Render the card at reduced visual weight. Used on the overview page
   * for courses that had no XP gain in the selected window.
   */
  dimmed?: boolean;
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
  indicatorColor,
  windowXp,
  dimmed,
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

  const showWindowXp = windowXp != null;

  return (
    <Link
      href={`/course/${encodeURIComponent(courseId)}`}
      className={`relative block rounded-lg p-5 transition-colors ${
        dimmed
          ? "bg-zinc-900/40 border border-zinc-800/60 opacity-60 hover:border-zinc-700/70 hover:opacity-80"
          : "bg-zinc-900 border border-zinc-800 hover:border-zinc-600"
      }`}
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
          {showWindowXp ? (
            <>
              <div className="text-xl font-bold text-zinc-100">
                {windowXp > 0 ? `+${windowXp.toLocaleString()}` : "—"}
              </div>
              <div className="text-xs text-zinc-500">
                {xp.toLocaleString()} XP total
              </div>
            </>
          ) : (
            <>
              <div className="text-xl font-bold text-zinc-100">{xp.toLocaleString()}</div>
              <div className="text-xs text-zinc-500">All-time XP</div>
            </>
          )}
        </div>
      </div>
      {indicatorColor && (
        <span
          className="absolute bottom-3 right-3 w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: indicatorColor }}
        />
      )}
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
