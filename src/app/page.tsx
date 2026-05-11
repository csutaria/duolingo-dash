"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { CourseCard } from "@/components/CourseCard";
import { MetaSeriesCard } from "@/components/MetaSeriesCard";
import { DailyXpBarChart } from "@/components/DailyXpBarChart";
import { assignCourseColors, type CourseColorInput } from "@/lib/colors";
import { sortCoursesForXpGainView } from "@/lib/course-sort";
import { getXpWindowOption, useSharedXpWindow, XP_WINDOW_OPTIONS } from "@/lib/xp-window";

// Up to two uppercase initials drawn from `name` (preferred) or `username`.
// Falls back to "?" when neither is available.
function initialsFor(name: unknown, username: unknown): string {
  const source = String((name ?? username ?? "") || "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2
    ? parts[0][0] + parts[1][0]
    : source.slice(0, 2);
  return letters.toUpperCase();
}

function Avatar({ picture, name, username }: { picture: unknown; name: unknown; username: unknown }) {
  // Duolingo CDN sometimes 403s without `/xlarge`, sometimes regardless. We
  // start by trying the image; if it errors, swap to an initials chip so the
  // header never shows a broken-image icon. Same path serves the demo seed,
  // which sets picture = NULL.
  const [errored, setErrored] = useState(false);
  const src = picture != null && !errored
    ? `${String(picture).replace(/^\/\//, "https://")}/xlarge`
    : null;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setErrored(true)}
        className="h-12 w-12 rounded-full border-2 border-zinc-700 bg-zinc-800 object-cover sm:h-16 sm:w-16"
      />
    );
  }
  return (
    <div
      className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-700 bg-zinc-800 text-lg font-semibold text-zinc-200 sm:h-16 sm:w-16 sm:text-xl"
      aria-hidden
    >
      {initialsFor(name, username)}
    </div>
  );
}

export default function Overview() {
  const { data: profile, loading: pLoading } = useData<Record<string, unknown>>("profile");
  const { data: courses } = useData<Array<Record<string, unknown>>>("course-comparison");
  const { data: xpStats } = useData<Record<string, unknown>>("xp-stats");
  const [xpRange, setXpRange] = useSharedXpWindow("30");
  const { data: dailyData } = useData<Array<Record<string, unknown>>>(
    "course-xp-daily-history",
    xpRange !== "all" ? { days: xpRange } : undefined
  );

  const courseColorInputs = useMemo<CourseColorInput[]>(() => {
    return (courses ?? []).map((c) => ({
      course_id: String(c.course_id),
      learning_language: c.learning_language != null ? String(c.learning_language) : undefined,
      xp: Number(c.xp ?? 0),
    }));
  }, [courses]);

  const colorMap = useMemo(() => assignCourseColors(courseColorInputs), [courseColorInputs]);

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

  const untrackedXp = useMemo(
    () =>
      (dailyData ?? []).reduce(
        (sum, d) => sum + Number(d._untracked ?? 0),
        0,
      ),
    [dailyData],
  );

  const windowXpLabel = getXpWindowOption(xpRange)?.cardLabel ?? "selected period";

  // Active-in-window first sorted by window XP desc, then inactive by total XP desc.
  const sortedCourses = useMemo(() => {
    if (!courses) return [];
    return sortCoursesForXpGainView(courses, activeInWindow, windowXp);
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
    <div className="space-y-5 sm:space-y-8">
      <section className="flex items-center gap-3 sm:gap-4">
        <Avatar
          picture={profile.picture}
          name={profile.name}
          username={profile.username}
        />
        <div className="min-w-0">
          <h2 className="break-words text-xl font-bold sm:text-2xl">{String(profile.name || profile.username)}</h2>
          <p className="text-xs text-zinc-500 sm:text-sm">
            @{String(profile.username)} · Member since {memberSince}
            {profile.has_plus ? " · Plus" : ""}
          </p>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 lg:grid-cols-6">
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
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold">Daily XP</h3>
            <div className="flex gap-1 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
              {XP_WINDOW_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setXpRange(r.value)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    xpRange === r.value
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
            const isActive = activeInWindow.has(cId);
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
                indicatorColor={isActive ? colorMap[cId] : undefined}
                windowXp={windowXp[cId] ?? 0}
                windowXpLabel={windowXpLabel}
                dimmed={!isActive}
              />
            );
          })}
          <MetaSeriesCard
            title="Untracked"
            value={untrackedXp}
            label="Window XP"
            subtitle="XP not attributable to a specific language snapshot in this window."
            indicatorColor="#3f3f46"
            dimmed={untrackedXp <= 0}
          />
        </div>
      </section>
    </div>
  );
}
