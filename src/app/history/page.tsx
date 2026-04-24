"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { CourseCard } from "@/components/CourseCard";
import { StackedXpChart } from "@/components/StackedXpChart";
import { DailyMetricChart } from "@/components/DailyMetricChart";
import { assignCourseColors } from "@/lib/colors";

const RANGES = [
  { label: "1 day", days: "1" },
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
  { label: "90 days", days: "90" },
  { label: "All time", days: "" },
];

const METRICS = [
  { label: "Time", value: "time" as const },
  { label: "Sessions", value: "sessions" as const },
];

export default function HistoryPage() {
  const [range, setRange] = useState("30");
  const [metric, setMetric] = useState<"time" | "sessions">("time");
  const params = range ? { days: range } : undefined;

  const { data: xpDaily, loading } = useData<Array<Record<string, unknown>>>("xp-daily", params);
  const { data: xpStats } = useData<Record<string, unknown>>("xp-stats");
  const { data: stackData } = useData<Array<Record<string, unknown>>>(
    "course-xp-history",
    params
  );
  const { data: courses } = useData<Array<Record<string, unknown>>>("course-comparison");
  const { data: streakEpochs } = useData<Array<Record<string, unknown>>>("streak-epochs");

  const xpDomainStart = range ? (() => {
    const d = new Date();
    d.setDate(d.getDate() - (Number(range) - 1));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  })() : undefined;

  const allCourseIds = useMemo(() => {
    if (!courses) return [];
    return courses.map((c) => String(c.course_id)).sort();
  }, [courses]);

  const colorMap = useMemo(() => assignCourseColors(allCourseIds), [allCourseIds.join(",")]);

  const courseIds = useMemo(() => {
    if (!stackData?.length) return [];
    return Object.keys(stackData[0]).filter((k) => k !== "date" && k !== "_total");
  }, [stackData]);

  const activeInWindow = useMemo(() => {
    if (!stackData || stackData.length < 2) return new Set<string>();
    const first = stackData[0];
    const last = stackData[stackData.length - 1];
    return new Set(courseIds.filter((id) => Number(last[id] ?? 0) > Number(first[id] ?? 0)));
  }, [stackData, courseIds]);

  const courseNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of courses ?? []) {
      map[String(c.course_id)] = String(c.title || c.learning_language);
    }
    return map;
  }, [courses]);

  const rangeLabel = RANGES.find((r) => r.days === range)?.label ?? "Selected period";

  const profileTotalXp = useMemo(() => {
    if (!stackData?.length) return 0;
    return Number(stackData[stackData.length - 1]._total ?? 0);
  }, [stackData]);

  const filteredStats = xpDaily
    ? {
        total: xpDaily.reduce((s, d) => s + Number(d.gained_xp || 0), 0),
        avg: Math.round(
          xpDaily.reduce((s, d) => s + Number(d.gained_xp || 0), 0) /
            Math.max(xpDaily.filter((d) => Number(d.gained_xp) > 0).length, 1),
        ),
        sessions: xpDaily.reduce((s, d) => s + Number(d.num_sessions || 0), 0),
        timeHrs: Math.round(
          xpDaily.reduce((s, d) => s + Number(d.total_session_time || 0), 0) / 3600,
        ),
        goalDays: xpDaily.filter(
          (d) => Number(d.gained_xp) >= Number(d.daily_goal_xp) && Number(d.daily_goal_xp) > 0,
        ).length,
        freezeDays: xpDaily.filter((d) => d.frozen).length,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">History</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                range === r.days
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-zinc-500">Loading...</div>}

      {filteredStats && (
        <section>
          <p className="text-xs text-zinc-500 mb-2">
            Stats · {rangeLabel}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total XP" value={filteredStats.total.toLocaleString()} />
            <StatCard label="Avg Daily" value={filteredStats.avg} sub="XP on active days" />
            <StatCard label="Sessions" value={filteredStats.sessions.toLocaleString()} />
            <StatCard label="Study Time" value={filteredStats.timeHrs > 0 ? `${filteredStats.timeHrs}h` : "—"} />
            <StatCard label="Goal Met" value={filteredStats.goalDays} sub="days" />
            <StatCard label="Freezes Used" value={filteredStats.freezeDays} />
          </div>
        </section>
      )}

      {stackData && stackData.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <StackedXpChart
            data={stackData}
            courseIds={courseIds}
            colors={colorMap}
            courseNames={courseNames}
            profileTotalXp={profileTotalXp}
            domainStart={xpDomainStart}
          />
          <p className="text-xs text-zinc-600 mt-1">Cumulative XP per language</p>
        </div>
      )}

      {courses && courses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => {
            const cId = String(c.course_id);
            return (
              <CourseCard
                key={cId}
                courseId={cId}
                learningLanguage={String(c.learning_language)}
                fromLanguage={String(c.from_language)}
                title={String(c.title)}
                xp={Number(c.xp)}
                totalCrowns={c.total_crowns != null ? Number(c.total_crowns) : undefined}
                wordCount={c.word_count != null ? Number(c.word_count) : undefined}
                totalSkills={c.total_skills != null ? Number(c.total_skills) : undefined}
                completedSkills={c.completed_skills != null ? Number(c.completed_skills) : undefined}
                inProgressSkills={c.in_progress_skills != null ? Number(c.in_progress_skills) : undefined}
                indicatorColor={activeInWindow.has(cId) ? colorMap[cId] : undefined}
              />
            );
          })}
        </div>
      )}

      {xpDaily && xpDaily.length > 0 && (
        <>
          <div className="border-t border-zinc-800 pt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Streak Details · {rangeLabel}</h3>
              <div className="flex gap-1">
                {METRICS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMetric(m.value)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                      metric === m.value
                        ? "bg-zinc-700 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <DailyMetricChart
                data={xpDaily}
                metric={metric}
                domainStart={xpDomainStart}
                streakEpochs={streakEpochs as Array<{ streak_start_date: string; streak_end_date: string | null }> | undefined}
              />
            </div>
          </div>

          <section>
            <h3 className="text-lg font-semibold mb-3">Daily Breakdown · {rangeLabel}</h3>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                    <tr className="text-zinc-500 text-left">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2 text-right">XP</th>
                      <th className="px-4 py-2 text-right">Sessions</th>
                      <th className="px-4 py-2 text-right">Time</th>
                      <th className="px-4 py-2 text-center">Goal</th>
                      <th className="px-4 py-2 text-center">Streak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...xpDaily].reverse().map((d) => {
                      const mins = Math.round(Number(d.total_session_time || 0) / 60);
                      const metGoal = Number(d.gained_xp) >= Number(d.daily_goal_xp) && Number(d.daily_goal_xp) > 0;
                      return (
                        <tr key={String(d.date)} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-2 text-zinc-300">{String(d.date)}</td>
                          <td className="px-4 py-2 text-right font-medium text-zinc-200">{Number(d.gained_xp)}</td>
                          <td className="px-4 py-2 text-right text-zinc-400">{Number(d.num_sessions)}</td>
                          <td className="px-4 py-2 text-right text-zinc-400">{mins > 0 ? `${mins}m` : "—"}</td>
                          <td className="px-4 py-2 text-center">{metGoal ? "✓" : d.frozen ? "❄" : "—"}</td>
                          <td className="px-4 py-2 text-center">{d.streak_extended ? "🔥" : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {xpStats && (
        <section>
          <h3 className="text-lg font-semibold mb-3">All-Time Stats</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total XP" value={Number(xpStats.total_xp || 0).toLocaleString()} />
            <StatCard label="Best Day" value={Number(xpStats.best_day_xp || 0).toLocaleString()} />
            <StatCard label="Active Days" value={Number(xpStats.total_days || 0)} />
            <StatCard label="Streak Days" value={Number(xpStats.streak_days || 0)} />
          </div>
        </section>
      )}
    </div>
  );
}
