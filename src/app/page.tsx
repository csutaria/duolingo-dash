"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { CourseCard } from "@/components/CourseCard";
import { DailyXpBarChart } from "@/components/DailyXpBarChart";
import { assignCourseColors } from "@/lib/colors";

const XP_RANGES = [
  { label: "1d", days: "1" },
  { label: "7d", days: "7" },
  { label: "30d", days: "30" },
  { label: "90d", days: "90" },
  { label: "All", days: "" },
];

export default function Overview() {
  const { data: profile, loading: pLoading } = useData<Record<string, unknown>>("profile");
  const { data: courses } = useData<Array<Record<string, unknown>>>("course-comparison");
  const { data: xpStats } = useData<Record<string, unknown>>("xp-stats");
  const [xpRange, setXpRange] = useState("30");
  const { data: dailyData } = useData<Array<Record<string, unknown>>>(
    "course-xp-daily-history",
    xpRange ? { days: xpRange } : undefined
  );

  // Stable color assignment from full course list — shared with XP history page
  const allCourseIds = useMemo(() => {
    if (!courses) return [];
    return courses.map((c) => String(c.course_id)).sort();
  }, [courses]);

  const colorMap = useMemo(() => assignCourseColors(allCourseIds), [allCourseIds.join(",")]);

  // Course IDs present in the daily data (keys other than date/meta)
  const courseIds = useMemo(() => {
    if (!dailyData?.length) return [];
    return Object.keys(dailyData[0]).filter(
      (k) => k !== "date" && k !== "_untracked" && k !== "_total"
    );
  }, [dailyData]);

  // Courses with any non-zero delta in the selected window
  const activeInWindow = useMemo(() => {
    if (!dailyData) return new Set<string>();
    return new Set(courseIds.filter((id) => dailyData.some((d) => Number(d[id] ?? 0) > 0)));
  }, [dailyData, courseIds]);

  const courseNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of courses ?? []) {
      map[String(c.course_id)] = String(c.title || c.learning_language);
    }
    return map;
  }, [courses]);

  // XP gained per course in the selected window (sum of daily deltas)
  const windowXp = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of dailyData ?? []) {
      for (const id of courseIds) {
        map[id] = (map[id] ?? 0) + Number(d[id] ?? 0);
      }
    }
    return map;
  }, [dailyData, courseIds]);

  // Active-in-window first sorted by window XP desc, then inactive by total XP desc
  const sortedCourses = useMemo(() => {
    if (!courses) return [];
    return [...courses].sort((a, b) => {
      const aId = String(a.course_id);
      const bId = String(b.course_id);
      const aActive = activeInWindow.has(aId) ? 0 : 1;
      const bActive = activeInWindow.has(bId) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      if (aActive === 0) return (windowXp[bId] ?? 0) - (windowXp[aId] ?? 0);
      return Number(b.xp) - Number(a.xp);
    });
  }, [courses, activeInWindow, windowXp]);

  if (pLoading && !profile) {
    return <div className="text-zinc-500">Loading...</div>;
  }

  if (!profile) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold text-zinc-300">Not Connected</h2>
        <p className="text-zinc-500 mt-2">
          Set the <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-sm">DUOLINGO_JWT</code> environment variable and restart the server.
        </p>
        <div className="mt-6 text-left max-w-lg mx-auto bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400">
          <p className="font-medium text-zinc-300 mb-2">To get your JWT:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Log into duolingo.com in your browser</li>
            <li>Open Developer Tools (F12)</li>
            <li>Go to Application &gt; Cookies &gt; duolingo.com</li>
            <li>Copy the value of <code className="bg-zinc-800 px-1 rounded">jwt_token</code></li>
          </ol>
          <div className="mt-4 bg-zinc-800 rounded p-3 font-mono text-xs">
            <p className="text-zinc-500 mb-1"># With 1Password:</p>
            <p>op run --env-file=.env.tpl -- npm run dev</p>
            <p className="text-zinc-500 mt-2 mb-1"># Or manually (no echo):</p>
            <p>read -s DUOLINGO_JWT && export DUOLINGO_JWT</p>
            <p>npm run dev</p>
          </div>
        </div>
      </div>
    );
  }

  const memberSince = profile.creation_date
    ? new Date(Number(profile.creation_date) * 1000).toLocaleDateString()
    : "Unknown";

  const totalTimeHrs = xpStats?.total_time_seconds
    ? Math.round(Number(xpStats.total_time_seconds) / 3600)
    : 0;

  return (
    <div className="space-y-8">
      <section className="flex items-center gap-4">
        {profile.picture != null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${String(profile.picture).replace(/^\/\//, "https://")}/xlarge`}
            alt=""
            className="w-16 h-16 rounded-full border-2 border-zinc-700"
          />
        )}
        <div>
          <h2 className="text-2xl font-bold">{String(profile.name || profile.username)}</h2>
          <p className="text-sm text-zinc-500">
            @{String(profile.username)} · Member since {memberSince}
            {profile.has_plus ? " · Plus" : ""}
          </p>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          <StatCard
            compact
            label="Streak"
            value={`${profile.streak} days`}
            sub={
              profile.current_streak_length ? `Started ${profile.current_streak_start}` : undefined
            }
          />
          <StatCard compact label="Total XP" value={Number(profile.total_xp).toLocaleString()} />
          <StatCard compact label="Daily Goal" value={`${profile.xp_goal} XP`} />
          <StatCard compact label="Gems" value={Number(profile.gems).toLocaleString()} />
          <StatCard compact label="Languages" value={courses?.length ?? 0} />
          <StatCard
            compact
            label="Study Time"
            value={totalTimeHrs > 0 ? `${totalTimeHrs}h` : "—"}
            sub={
              xpStats?.total_sessions
                ? `${Number(xpStats.total_sessions).toLocaleString()} sessions`
                : undefined
            }
          />
          {xpStats && (
            <>
              <StatCard
                compact
                label="Avg Daily XP"
                value={Math.round(Number(xpStats.avg_daily_xp || 0))}
              />
              <StatCard
                compact
                label="Best Day"
                value={Number(xpStats.best_day_xp || 0).toLocaleString()}
                sub="XP in one day"
              />
              <StatCard compact label="Active Days" value={Number(xpStats.total_days || 0)} />
              <StatCard compact label="Streak Freezes" value={Number(xpStats.freeze_days || 0)} />
            </>
          )}
        </div>
      </section>

      {dailyData && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Daily XP</h3>
            <div className="flex gap-1">
              {XP_RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setXpRange(r.days)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    xpRange === r.days
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <DailyXpBarChart
              data={dailyData}
              courseIds={courseIds}
              colors={colorMap}
              courseNames={courseNames}
            />
            <p className="text-xs text-zinc-600 mt-1">Daily XP gained per language</p>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-lg font-semibold mb-3">Languages</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedCourses.map((c) => {
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
      </section>
    </div>
  );
}
