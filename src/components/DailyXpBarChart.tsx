"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DailyXpBarChartProps {
  data: Array<Record<string, unknown>>;
  courseIds: string[];
  colors: Record<string, string>;
  courseNames?: Record<string, string>;
  height?: number;
}

export function DailyXpBarChart({
  data,
  courseIds,
  colors,
  courseNames = {},
  height = 350,
}: DailyXpBarChartProps) {
  if (!data.length) {
    return <div className="text-zinc-500 text-sm">No XP history yet</div>;
  }

  // Only render bars for courses with any non-zero value in this window
  const activeCourseIds = courseIds.filter((id) =>
    data.some((d) => Number(d[id] ?? 0) > 0)
  );

  // Largest total at bottom of stack
  const sorted = [...activeCourseIds].sort((a, b) => {
    const ta = data.reduce((s, d) => s + Number(d[a] ?? 0), 0);
    const tb = data.reduce((s, d) => s + Number(d[b] ?? 0), 0);
    return tb - ta;
  });

  const hasUntracked = data.some((d) => Number(d._untracked ?? 0) > 0);

  const formatDate = (date: string) => {
    const parts = date.split("-");
    return `${Number(parts[1])}/${Number(parts[2])}`;
  };

  const formatXp = (v: number) =>
    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={formatDate}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 11 }}
            width={45}
            tickFormatter={formatXp}
          />
          <Tooltip
            wrapperStyle={{ zIndex: 50 }}
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "6px",
              color: "#e4e4e7",
              fontSize: 11,
            }}
            labelFormatter={(date) => {
              const parts = String(date).split("-");
              return `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}`;
            }}
            formatter={(value: unknown, key: unknown) => {
              const k = String(key ?? "");
              if (k === "_untracked") return [Number(value).toLocaleString(), "Untracked"];
              return [Number(value).toLocaleString(), courseNames[k] ?? k];
            }}
            itemSorter={(item) => -(Number(item.value) || 0)}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          {sorted.map((id) => (
            <Bar
              key={id}
              dataKey={id}
              stackId="xp"
              fill={colors[id]}
              name={courseNames[id] ?? id}
              isAnimationActive={false}
            />
          ))}
          {hasUntracked && (
            <Bar
              dataKey="_untracked"
              stackId="xp"
              fill="#3f3f46"
              name="Untracked"
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      {hasUntracked && (
        <div className="flex gap-4 mt-1 px-1 text-xs text-zinc-500 justify-end">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#3f3f46" }} />
            Untracked
          </span>
        </div>
      )}
    </div>
  );
}
