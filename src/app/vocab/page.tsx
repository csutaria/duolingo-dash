"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/hooks";
import { getLanguageName, getLanguageFlag } from "@/lib/language-names";
import { choosePreferredCourseId, readLastCourseId, writeLastCourseId } from "@/lib/course-preferences";
import {
  buildVocabBundles,
  buildVocabWordRows,
  sortBundlesByCourseOrder,
  sortBundlesByStatus,
  type VocabBundle,
  type VocabBundleStatus,
  type VocabWordRow,
} from "@/lib/vocab-bundles";

type VocabView = "study" | "skills" | "words";
type StatusFilter = "all" | VocabBundleStatus;

const STATUS_ORDER: VocabBundleStatus[] = ["in-progress", "complete-plus", "complete", "untouched"];

export default function VocabPage() {
  const { data: courses } = useData<Array<Record<string, unknown>>>("courses");
  const { data: profile, loading: profileLoading } = useData<Record<string, unknown>>("profile");
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectionReady, setSelectionReady] = useState(false);

  useEffect(() => {
    if (!courses || profileLoading) return;
    const courseIds = courses.map((c) => String(c.course_id));
    const storedCourse = readLastCourseId(courseIds);
    const activeCourse =
      typeof profile?.current_course_id === "string" && courseIds.includes(profile.current_course_id)
        ? profile.current_course_id
        : null;
    setSelectedCourse((current) => (
      current && courseIds.includes(current)
        ? current
        : choosePreferredCourseId(courseIds, storedCourse, activeCourse)
    ));
    setSelectionReady(true);
  }, [courses, profile, profileLoading]);

  const courseId = selectionReady ? selectedCourse : null;

  const selectCourse = (nextCourseId: string) => {
    setSelectedCourse(nextCourseId);
    writeLastCourseId(nextCourseId);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Vocabulary</h2>
          <p className="text-sm text-zinc-500 mt-1">Study words through the skills Duolingo already tracks.</p>
        </div>
        {courses && courses.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
            {courses.map((c) => {
              const lang = String(c.learning_language);
              const flag = getLanguageFlag(lang);
              const isActive = String(c.course_id) === courseId;
              return (
                <button
                  key={String(c.course_id)}
                  onClick={() => selectCourse(String(c.course_id))}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    isActive ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {flag} {getLanguageName(lang)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!courses || !selectionReady ? (
        <p className="text-zinc-500">Loading...</p>
      ) : courseId ? <VocabContent courseId={courseId} /> : (
        <p className="text-zinc-500">No courses found. Sync data first.</p>
      )}
    </div>
  );
}

function VocabContent({ courseId }: { courseId: string }) {
  const { data: skills, loading } = useData<Array<Record<string, unknown>>>("skills", { courseId });
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<VocabView>("study");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const bundles = useMemo(
    () => sortBundlesByCourseOrder(buildVocabBundles(skills ?? [])),
    [skills],
  );
  const wordRows = useMemo(() => buildVocabWordRows(bundles), [bundles]);
  const filteredBundles = useMemo(
    () => filterBundles(bundles, filter, statusFilter),
    [bundles, filter, statusFilter],
  );
  const filteredWords = useMemo(
    () => filterWordRows(wordRows, filter, statusFilter),
    [wordRows, filter, statusFilter],
  );

  if (loading) return <div className="text-zinc-500">Loading...</div>;
  if (bundles.length === 0) {
    return (
      <div className="text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
        <p>No skill vocabulary map for this course yet.</p>
        <p className="text-xs mt-1">Sync this course to fetch its skill list and words.</p>
      </div>
    );
  }

  const inProgress = bundles.filter((bundle) => bundle.status === "in-progress");
  const complete = bundles.filter((bundle) => bundle.status === "complete" || bundle.status === "complete-plus");
  const untouched = bundles.filter((bundle) => bundle.status === "untouched");
  const totalSkillWords = bundles.reduce((sum, bundle) => sum + bundle.wordCount, 0);

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3 md:grid-cols-4">
        <MetricCard label="Unique Words" value={wordRows.length} />
        <MetricCard label="Skill Words" value={totalSkillWords} />
        <MetricCard label="In Progress" value={inProgress.length} />
        <MetricCard label="Completed" value={complete.length} />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-wrap">
          <input
            type="text"
            placeholder="Search words or skills..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-zinc-800 text-zinc-200 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-zinc-500 outline-none w-full sm:w-64"
          />
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
            {(["study", "skills", "words"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs px-2.5 py-1 rounded ${view === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {viewLabel(v)}
              </button>
            ))}
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {(["all", ...STATUS_ORDER] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`text-xs px-2.5 py-1 rounded ${statusFilter === status ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {status === "all" ? "All" : statusText(status)}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500 ml-auto">
            {view === "words" ? `${filteredWords.length} words` : `${filteredBundles.length} skills`}
          </span>
        </div>

        <div className="p-4">
          {view === "study" && (
            <StudyQueue bundles={filteredBundles} />
          )}
          {view === "skills" && (
            <BundleList bundles={sortBundlesByCourseOrder(filteredBundles)} />
          )}
          {view === "words" && (
            <AllWordsTable rows={filteredWords} />
          )}
        </div>
      </div>
    </div>
  );
}

function StudyQueue({ bundles }: { bundles: VocabBundle[] }) {
  const byStatus = {
    "in-progress": bundles.filter((bundle) => bundle.status === "in-progress"),
    "complete-plus": bundles.filter((bundle) => bundle.status === "complete-plus"),
    complete: bundles.filter((bundle) => bundle.status === "complete"),
    untouched: bundles.filter((bundle) => bundle.status === "untouched"),
  };

  return (
    <div className="space-y-6">
      <BundleSection title="In Progress" bundles={sortBundlesByStatus(byStatus["in-progress"])} empty="No in-progress skill bundles." />
      <BundleSection title="Legendary" bundles={sortBundlesByCourseOrder(byStatus["complete-plus"])} empty="No legendary bundles yet." />
      <BundleSection title="Completed" bundles={sortBundlesByCourseOrder(byStatus.complete)} empty="No completed bundles yet." />
      <BundleSection title="Not started" bundles={sortBundlesByCourseOrder(byStatus.untouched)} empty="No not started bundles." compact />
    </div>
  );
}

function BundleSection({
  title,
  bundles,
  empty,
  compact = false,
}: {
  title: string;
  bundles: VocabBundle[];
  empty: string;
  compact?: boolean;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
        <span className="text-xs text-zinc-500">{bundles.length} skills</span>
      </div>
      {bundles.length > 0 ? <BundleList bundles={bundles} compact={compact} /> : <p className="text-sm text-zinc-500">{empty}</p>}
    </section>
  );
}

function BundleList({ bundles, compact = false }: { bundles: VocabBundle[]; compact?: boolean }) {
  return (
    <div className="grid gap-2">
      {bundles.map((bundle) => (
        <div key={bundle.skillId} className="border border-zinc-800 rounded-lg bg-zinc-950/40 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-medium text-zinc-100">{bundle.skillName}</h4>
                <StatusBadge status={bundle.status} label={bundle.statusLabel} />
              </div>
              <p className="text-xs text-zinc-500 mt-1">{bundle.levelsFinished}/5 status · {bundle.wordCount} words</p>
            </div>
          </div>
          {!compact && (
            <p className="text-sm text-zinc-300 mt-3 leading-7 break-words">
              {bundle.words.length > 0 ? bundle.words.join(" · ") : "No words stored for this skill."}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function AllWordsTable({ rows }: { rows: VocabWordRow[] }) {
  return (
    <div className="max-h-[620px] overflow-auto">
      <table className="w-full min-w-[38rem] text-sm">
        <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
          <tr className="text-zinc-500 text-left">
            <th className="px-3 py-2">Word</th>
            <th className="px-3 py-2">Skills</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.word} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
              <td className="px-3 py-2 text-zinc-100 font-medium">{row.word}</td>
              <td className="px-3 py-2 text-zinc-400">
                {row.skills.map((skill) => skill.skillName).join(", ")}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.strongestStatus} label={row.strongestStatusLabel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2 sm:rounded-lg sm:p-4">
      <div className="text-[8px] uppercase leading-tight tracking-wide text-zinc-500 sm:text-xs">{label}</div>
      <div className="mt-0.5 text-base font-bold leading-tight text-zinc-100 sm:mt-1 sm:text-2xl">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: VocabBundleStatus; label: string }) {
  const classes =
    status === "complete-plus" ? "border border-yellow-200 bg-yellow-50 text-yellow-800" :
    status === "complete" ? "border border-green-200 bg-green-50 text-green-700" :
    status === "in-progress" ? "border border-blue-200 bg-blue-50 text-blue-700" :
    "border border-zinc-800 bg-zinc-950 text-zinc-500";

  return <span className={`text-xs px-2 py-0.5 rounded ${classes}`}>{label}</span>;
}

function filterBundles(bundles: VocabBundle[], filter: string, status: StatusFilter): VocabBundle[] {
  const q = filter.trim().toLowerCase();
  return bundles.filter((bundle) => {
    if (status !== "all" && bundle.status !== status) return false;
    if (!q) return true;
    return (
      bundle.skillName.toLowerCase().includes(q) ||
      bundle.words.some((word) => word.toLowerCase().includes(q))
    );
  });
}

function filterWordRows(rows: VocabWordRow[], filter: string, status: StatusFilter): VocabWordRow[] {
  const q = filter.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== "all" && !row.skills.some((skill) => skill.status === status)) return false;
    if (!q) return true;
    return (
      row.word.toLowerCase().includes(q) ||
      row.skills.some((skill) => skill.skillName.toLowerCase().includes(q))
    );
  });
}

function statusText(status: VocabBundleStatus): string {
  if (status === "complete-plus") return "Legendary";
  if (status === "complete") return "Completed";
  if (status === "in-progress") return "In Progress";
  return "Not started";
}

function viewLabel(view: VocabView): string {
  if (view === "study") return "Study Queue";
  if (view === "skills") return "Skills";
  return "All Words";
}
