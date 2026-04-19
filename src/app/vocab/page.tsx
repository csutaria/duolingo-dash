"use client";

import { useState } from "react";
import { useData } from "@/lib/hooks";
import { StrengthBar } from "@/components/StrengthBar";
import { getLanguageName, getLanguageFlag } from "@/lib/language-names";

export default function VocabPage() {
  const { data: courses } = useData<Array<Record<string, unknown>>>("courses");
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

  const courseId = selectedCourse ?? (courses?.[0]?.course_id as string | undefined) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Vocabulary</h2>
        {courses && courses.length > 1 && (
          <div className="flex gap-1">
            {courses.map((c) => {
              const lang = String(c.learning_language);
              const flag = getLanguageFlag(lang);
              const isActive = String(c.course_id) === courseId;
              return (
                <button
                  key={String(c.course_id)}
                  onClick={() => setSelectedCourse(String(c.course_id))}
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

      {courseId ? <VocabContent courseId={courseId} /> : (
        <p className="text-zinc-500">No courses found. Sync data first.</p>
      )}
    </div>
  );
}

function VocabContent({ courseId }: { courseId: string }) {
  const { data: vocab, loading } = useData<Array<Record<string, unknown>>>("vocab", { courseId });
  const { data: decay } = useData<Array<Record<string, unknown>>>("vocab-decay", { courseId });
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<"strength" | "word" | "recent" | "skill">("strength");
  const [showOnly, setShowOnly] = useState<"all" | "weak" | "strong">("all");

  if (loading) return <div className="text-zinc-500">Loading...</div>;
  if (!vocab || vocab.length === 0) {
    return (
      <div className="text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
        <p>No vocabulary data for this course.</p>
        <p className="text-xs mt-1">Vocabulary is only available for your currently active Duolingo language.</p>
      </div>
    );
  }

  const weakWords = vocab.filter((w) => Number(w.strength_bars) <= 1);
  const decayingWords = decay?.filter((d) => Number(d.decay || 0) < 0) ?? [];

  let filtered = vocab.filter((w) =>
    !filter ||
    String(w.word).toLowerCase().includes(filter.toLowerCase()) ||
    String(w.skill || "").toLowerCase().includes(filter.toLowerCase()) ||
    String(w.pos || "").toLowerCase().includes(filter.toLowerCase()),
  );

  if (showOnly === "weak") filtered = filtered.filter((w) => Number(w.strength_bars) <= 1);
  else if (showOnly === "strong") filtered = filtered.filter((w) => Number(w.strength_bars) >= 3);

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "strength") return Number(a.strength_bars || 0) - Number(b.strength_bars || 0);
    if (sortBy === "word") return String(a.word).localeCompare(String(b.word));
    if (sortBy === "skill") return String(a.skill || "").localeCompare(String(b.skill || ""));
    return new Date(String(b.last_practiced || 0)).getTime() - new Date(String(a.last_practiced || 0)).getTime();
  });

  const skillGroups = new Map<string, number>();
  for (const w of vocab) {
    const skill = String(w.skill || "Unknown");
    skillGroups.set(skill, (skillGroups.get(skill) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Total Words</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{vocab.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Weak Words</div>
          <div className="text-2xl font-bold text-red-400 mt-1">{weakWords.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Decaying</div>
          <div className="text-2xl font-bold text-orange-400 mt-1">{decayingWords.length}</div>
          <div className="text-xs text-zinc-500 mt-1">since last sync</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wide">Skills</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{skillGroups.size}</div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 flex-wrap">
          <input
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-zinc-800 text-zinc-200 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-zinc-500 outline-none w-48"
          />
          <div className="flex gap-1">
            {(["all", "weak", "strong"] as const).map((f) => (
              <button key={f} onClick={() => setShowOnly(f)} className={`text-xs px-2 py-1 rounded ${showOnly === f ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}>
                {f}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">Sort:</span>
          {(["strength", "word", "skill", "recent"] as const).map((s) => (
            <button key={s} onClick={() => setSortBy(s)} className={`text-xs ${sortBy === s ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}>
              {s}
            </button>
          ))}
          <span className="text-xs text-zinc-500 ml-auto">{sorted.length} words</span>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
              <tr className="text-zinc-500 text-left">
                <th className="px-4 py-2">Word</th>
                <th className="px-4 py-2">Strength</th>
                <th className="px-4 py-2">Skill</th>
                <th className="px-4 py-2">POS</th>
                <th className="px-4 py-2">Gender</th>
                <th className="px-4 py-2">Last Practiced</th>
                <th className="px-4 py-2">First Seen</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((w, i) => (
                <tr key={`${w.lexeme_id}-${i}`} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-2 text-zinc-200 font-medium">{String(w.word)}</td>
                  <td className="px-4 py-2"><StrengthBar value={Number(w.strength_bars || 0)} /></td>
                  <td className="px-4 py-2 text-zinc-400">{String(w.skill || "—")}</td>
                  <td className="px-4 py-2 text-zinc-500 text-xs">{String(w.pos || "—")}</td>
                  <td className="px-4 py-2 text-zinc-500 text-xs">{String(w.gender || "—")}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {w.last_practiced ? new Date(String(w.last_practiced)).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {w.first_seen ? new Date(String(w.first_seen)).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
