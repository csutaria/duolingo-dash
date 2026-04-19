"use client";

import { useState } from "react";
import { useData } from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { XpChart } from "@/components/XpChart";

const RANGES = [
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
  { label: "90 days", days: "90" },
  { label: "All time", days: "" },
];

export default function XpHistory() {
  const [range, setRange] = useState("30");
  const params = range ? { days: range } : undefined;
  const { data: xpDaily, loading } = useData<Array<Record<string, unknown>>>("xp-daily", params);
  const { data: xpStats } = useData<Record<string, unknown>>("xp-stats");

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
        <h2 className="text-xl font-bold">XP History</h2>
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

      {xpDaily && xpDaily.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <XpChart data={xpDaily} height={400} />
        </div>
      )}

      {filteredStats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total XP" value={filteredStats.total.toLocaleString()} />
          <StatCard label="Avg Daily" value={filteredStats.avg} sub="XP on active days" />
          <StatCard label="Sessions" value={filteredStats.sessions.toLocaleString()} />
          <StatCard label="Study Time" value={filteredStats.timeHrs > 0 ? `${filteredStats.timeHrs}h` : "—"} />
          <StatCard label="Goal Met" value={filteredStats.goalDays} sub="days" />
          <StatCard label="Freezes Used" value={filteredStats.freezeDays} />
        </div>
      )}

      {xpDaily && xpDaily.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-3">Daily Breakdown</h3>
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
