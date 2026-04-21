"use client";

import { use, useState, useCallback } from "react";
import { useData } from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { StrengthBar } from "@/components/StrengthBar";
import { XpChart } from "@/components/XpChart";
import { getScriptInfo, isScriptSkill } from "@/lib/scripts";
import { getLanguageName, getLanguageFlag } from "@/lib/language-names";
import { parseUtcDate } from "@/lib/utils";

export default function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  const decodedCourseId = decodeURIComponent(courseId);
  const [tab, setTab] = useState<"skills" | "vocab" | "decay">("skills");

  const { data: skills, refetch: refetchSkills } = useData<Array<Record<string, unknown>>>("skills", { courseId: decodedCourseId });
  const { data: vocab, refetch: refetchVocab } = useData<Array<Record<string, unknown>>>("vocab", { courseId: decodedCourseId });
  const { data: skillDecay, refetch: refetchSkillDecay } = useData<Array<Record<string, unknown>>>("skill-decay", { courseId: decodedCourseId });
  const { data: vocabDecay, refetch: refetchVocabDecay } = useData<Array<Record<string, unknown>>>("vocab-decay", { courseId: decodedCourseId });
  const { data: courseHistory } = useData<Array<Record<string, unknown>>>("course-history", { courseId: decodedCourseId });
  const { data: courses } = useData<Array<Record<string, unknown>>>("courses");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncDone, setSyncDone] = useState(false);

  const langCode = decodedCourseId.match(/DUOLINGO_(\w+)_/)?.[1]?.toLowerCase() ?? "";
  const courseInfo = courses?.find((c) => String(c.course_id) === decodedCourseId);
  const courseLang = courseInfo ? String(courseInfo.learning_language) : langCode;
  const courseTitle = courseInfo ? String(courseInfo.title) : getLanguageName(langCode);
  const courseFlag = getLanguageFlag(courseLang);
  const courseFrom = courseInfo ? String(courseInfo.from_language) : "en";
  const scriptInfo = getScriptInfo(courseLang);

  const hasDetailData = (skills && skills.length > 0) || (vocab && vocab.length > 0);

  const syncThisCourse = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sync-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: decodedCourseId,
          learningLanguage: courseLang,
          fromLanguage: courseFrom,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncError(data.error);
      } else {
        setSyncDone(true);
        refetchSkills();
        refetchVocab();
        refetchSkillDecay();
        refetchVocabDecay();
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [decodedCourseId, courseLang, courseFrom, refetchSkills, refetchVocab, refetchSkillDecay, refetchVocabDecay]);

  const completedSkills = skills?.filter((s) => Number(s.levels_finished || 0) >= 5) ?? [];
  const inProgressSkills = skills?.filter((s) => {
    const lf = Number(s.levels_finished || 0);
    return lf >= 1 && lf < 5;
  }) ?? [];

  const scriptSkills = skills?.filter((s) => isScriptSkill(String(s.skill_name), langCode)) ?? [];
  const contentSkills = skills?.filter((s) => !isScriptSkill(String(s.skill_name), langCode)) ?? [];

  const [xpRange, setXpRange] = useState("30");
  const xpCutoff = xpRange ? Date.now() - Number(xpRange) * 86_400_000 : undefined;
  const xpDomainStart = xpRange ? (() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(xpRange));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  })() : undefined;
  const xpHistory = (() => {
    const all = courseHistory?.map((h) => ({
      date: String(h.snapshot_time),
      xp: Number(h.xp),
    })) ?? [];
    if (!xpCutoff) return all;
    return all.filter((h) => new Date(h.date).getTime() >= xpCutoff);
  })();

  const tabs = [
    { id: "skills" as const, label: "Skills" },
    { id: "vocab" as const, label: "Vocabulary" },
    { id: "decay" as const, label: "Decay" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{courseFlag} {courseTitle}</h2>
          {scriptInfo && (
            <p className="text-sm text-zinc-500 mt-1">
              Writing system: {scriptInfo.scripts.map((s) => `${s.name} (${s.type})`).join(", ")}
            </p>
          )}
        </div>
      </div>

      {!hasDetailData && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <p className="text-zinc-400 mb-3">
            No skill or vocabulary data for this course yet. Detailed data is only available for your currently active Duolingo language.
            Syncing will temporarily switch your active course on Duolingo, fetch the data, and switch back.
          </p>
          <button
            onClick={syncThisCourse}
            disabled={syncing}
            className="px-4 py-2 rounded bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm transition-colors"
          >
            {syncing ? "Syncing... (switching course)" : `Sync ${courseTitle} details`}
          </button>
          {syncError && <p className="text-red-400 text-sm mt-2">{syncError}</p>}
          {syncDone && <p className="text-green-400 text-sm mt-2">Sync complete. Data should appear below.</p>}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Completed" value={`${completedSkills.length}/${skills?.length ?? 0}`} />
        <StatCard label="In Progress" value={inProgressSkills.length} />
        <StatCard label="Words" value={vocab?.length ?? 0} />
        {scriptSkills.length > 0 && (
          <StatCard
            label="Script Skills"
            value={`${scriptSkills.filter((s) => Number(s.levels_finished || 0) >= 5).length}/${scriptSkills.length}`}
          />
        )}
      </div>

      {xpHistory.length > 1 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">XP Over Time</h3>
            <div className="flex gap-1">
              {[{label:"1d",days:"1"},{label:"7d",days:"7"},{label:"30d",days:"30"},{label:"90d",days:"90"},{label:"All",days:""}].map((r) => (
                <button key={r.days} onClick={() => setXpRange(r.days)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${xpRange === r.days ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <XpChart data={xpHistory} dataKey="xp" height={200} domainStart={xpDomainStart} />
          </div>
        </section>
      )}

      <div className="flex gap-1 border-b border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              tab === t.id
                ? "border-green-500 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "skills" && (
        <div className="space-y-6">
          {scriptSkills.length > 0 && (
            <div>
              <h4 className="text-md font-semibold mb-2 text-zinc-300">Script / Character Skills</h4>
              <SkillTable skills={scriptSkills} />
            </div>
          )}
          <div>
            {scriptSkills.length > 0 && (
              <h4 className="text-md font-semibold mb-2 text-zinc-300">Content Skills</h4>
            )}
            <SkillTable skills={contentSkills.length > 0 ? contentSkills : (skills ?? [])} />
          </div>
        </div>
      )}

      {tab === "vocab" && <VocabTable vocab={vocab ?? []} />}

      {tab === "decay" && (
        <div className="space-y-6">
          <DecaySection title="Skill Decay" data={skillDecay ?? []} nameKey="skill_name" strengthKey="current_strength" />
          <DecaySection title="Vocabulary Decay" data={vocabDecay ?? []} nameKey="word" strengthKey="current_strength" />
        </div>
      )}
    </div>
  );
}

function crownStatus(levelsFinished: number): { label: string; classes: string } {
  if (levelsFinished >= 5) return { label: "Legendary", classes: "bg-yellow-900/50 text-yellow-300" };
  if (levelsFinished >= 4) return { label: "Completed", classes: "bg-green-900/50 text-green-400" };
  if (levelsFinished >= 1) return { label: "In Progress", classes: "bg-blue-900/40 text-blue-400" };
  return { label: "Not started", classes: "bg-zinc-800 text-zinc-500" };
}

function SkillTable({ skills }: { skills: Array<Record<string, unknown>> }) {
  const [sortBy, setSortBy] = useState<"position" | "crowns" | "name">("position");
  const sorted = [...skills].sort((a, b) => {
    if (sortBy === "crowns") return Number(b.levels_finished || 0) - Number(a.levels_finished || 0);
    if (sortBy === "name") return String(a.skill_name).localeCompare(String(b.skill_name));
    return Number(a.coords_y || 0) - Number(b.coords_y || 0) || Number(a.coords_x || 0) - Number(b.coords_x || 0);
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex gap-2 px-4 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-500">Sort:</span>
        {(["position", "crowns", "name"] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)} className={`text-xs ${sortBy === s ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
            <tr className="text-zinc-500 text-left">
              <th className="px-4 py-2">Skill</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Words</th>
              <th className="px-4 py-2">First Tracked</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const lf = Number(s.levels_finished || 0);
              const { label, classes } = crownStatus(lf);
              const words = s.words_json ? JSON.parse(String(s.words_json)) : [];
              return (
                <tr key={String(s.skill_id)} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-2 text-zinc-200 font-medium">{String(s.skill_name)}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${classes}`}>{label}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">{words.length}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {s.first_seen ? parseUtcDate(String(s.first_seen)).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VocabTable({ vocab }: { vocab: Array<Record<string, unknown>> }) {
  const [sortBy, setSortBy] = useState<"strength" | "word">("strength");
  const [filter, setFilter] = useState("");

  const filtered = vocab.filter((w) =>
    !filter || String(w.word).toLowerCase().includes(filter.toLowerCase()) || String(w.skill || "").toLowerCase().includes(filter.toLowerCase()),
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "strength") return Number(a.strength_bars || 0) - Number(b.strength_bars || 0);
    return String(a.word).localeCompare(String(b.word));
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800">
        <input
          type="text"
          placeholder="Filter words or skills..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-zinc-800 text-zinc-200 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-zinc-500 outline-none w-64"
        />
        <span className="text-xs text-zinc-500">Sort:</span>
        {(["strength", "word"] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)} className={`text-xs ${sortBy === s ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}>
            {s}
          </button>
        ))}
        <span className="text-xs text-zinc-500 ml-auto">{sorted.length} words</span>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
            <tr className="text-zinc-500 text-left">
              <th className="px-4 py-2">Word</th>
              <th className="px-4 py-2">Strength</th>
              <th className="px-4 py-2">Skill</th>
              <th className="px-4 py-2">First Tracked</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((w, i) => (
              <tr key={`${w.lexeme_id}-${i}`} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-2 text-zinc-200 font-medium">{String(w.word)}</td>
                <td className="px-4 py-2"><StrengthBar value={Number(w.strength_bars || 0)} /></td>
                <td className="px-4 py-2 text-zinc-400">{String(w.skill || "—")}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">
                  {w.first_seen ? parseUtcDate(String(w.first_seen)).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DecaySection({
  title,
  data,
  nameKey,
  strengthKey,
}: {
  title: string;
  data: Array<Record<string, unknown>>;
  nameKey: string;
  strengthKey: string;
}) {
  const decaying = data.filter((d) => Number(d.decay || 0) < 0);
  const improving = data.filter((d) => Number(d.decay || 0) > 0);
  const stable = data.filter((d) => Number(d.decay || 0) === 0);

  return (
    <div>
      <h4 className="text-md font-semibold mb-2">{title}</h4>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Decaying" value={decaying.length} />
        <StatCard label="Improving" value={improving.length} />
        <StatCard label="Stable" value={stable.length} />
      </div>
      {decaying.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-zinc-800 text-xs text-red-400 font-medium">
            Needs Practice ({decaying.length})
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {decaying.map((d, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="px-4 py-1.5 text-zinc-200">{String(d[nameKey])}</td>
                    <td className="px-4 py-1.5">
                      <StrengthBar value={Number(d[strengthKey] || 0)} />
                    </td>
                    <td className="px-4 py-1.5 text-xs text-red-400">
                      {Number(d.decay) < 0 ? String(Number(d.decay).toFixed(0)) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
